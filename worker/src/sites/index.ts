import { appsEnabledFor } from '../apps/gating';
import type { Lang } from '../apps/bookings/messages';
import { loadOpenTimes, loadPublicLogo, loadPublicPage, resolvePublicSlug, type PublicPage } from '../apps/bookings/public';
import { REFERENCE } from '../apps/bookings/reference';
import { createBookingRequest, findSubmission, parseRequestForm, submissionDigest } from '../apps/bookings/request';
import {
  beginCustomerSession, cancelByCustomer, loadManagedBooking, rescheduleByCustomer, validCustomerToken,
} from '../apps/bookings/customer';
import { isDate, myDate } from '../apps/bookings/time';
import { clientIp } from '../ratelimit';
import { turnstileIdempotencyKey, verifyTurnstile } from '../turnstile';
import type { SitesEnv } from './env';
import {
  calendarFile, customerMessagePage, donePage, formPage, manageLoginPage, managePage, messagePage, page, redirect,
  reschedulePage, servicesPage, timesPage, SECURITY_HEADERS, type FormError, type MessageKind,
} from './render';

/* The public booking pages: the whole of the jentera-sites deploy. It never
   reads or sets a cookie and holds no credential; a business is found only
   through bookings_by_slug and everything after runs under withTenant. */

/* Case-insensitive on purpose: a customer typing the link, or a phone
   capitalising its first letter, still reaches the page. Names are stored
   lower-case, so a capital is answered with a redirect before any lookup. */
const PATH = /^\/b\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(\/.*)?$/i;
const DAYS_SHOWN = 7;
/** At most today plus the longest allowed horizon. Only used when the first
    seven days contain no opening, or an explicitly selected date is full. */
const LOOKAHEAD_DAYS = 91;
/** A booking form is a few hundred bytes; a body past this is not one. */
const BODY_MAX = 8192;
const FORM_TYPE = 'application/x-www-form-urlencoded';

interface Deps { now?: () => Date; fetchImpl?: typeof fetch }

function langOf(url: URL, info: PublicPage | null): Lang {
  const asked = url.searchParams.get('lang');
  return asked === 'en' || asked === 'bm' ? asked : info?.lang ?? 'en';
}

/** A page for a business not yet known: no name, no way back. */
function plain(kind: MessageKind, lang: Lang, status: number): Response {
  return page(messagePage({ slug: null, lang, businessName: null, kind }), status);
}

function notFound(lang: Lang): Response {
  return plain('not_found', lang, 404);
}

/** The body as UTF-8, or null once more than BODY_MAX bytes have arrived.
    A body with no Content-Length (a chunked upload) is never buffered past
    the limit: the reader is cancelled on the chunk that crosses it. */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The booking form's fields, or the refusal. Only a small urlencoded body is
    read at all: FormData would throw on anything else and buffer a multipart
    body of any size first. */
async function readForm(request: Request, lang: Lang): Promise<URLSearchParams | Response> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== FORM_TYPE) return plain('bad_request', lang, 400);
  if (Number(request.headers.get('Content-Length')) > BODY_MAX) return plain('bad_request', lang, 413);
  const text = await readCapped(request);
  if (text === null) return plain('bad_request', lang, 413);
  return new URLSearchParams(text);
}

function publicOrigin(env: SitesEnv): string | null {
  try {
    return env.SITES_ORIGIN ? new URL(env.SITES_ORIGIN).origin : null;
  } catch {
    return null;
  }
}

export async function handleSites(request: Request, env: SitesEnv, deps: Deps = {}): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const url = new URL(request.url);
  /* One public origin. The first links went out on the workers.dev host;
     every other host answers with a permanent redirect to SITES_ORIGIN,
     308 so a form post stays a post. */
  const origin = publicOrigin(env);
  if (origin && url.origin !== origin) return redirect(`${origin}${url.pathname}${url.search}`, 308);
  const match = url.pathname.match(PATH);
  if (!match || (request.method !== 'GET' && request.method !== 'POST')) return notFound('en');
  const [, typed, typedSub = ''] = match;
  const slug = typed.toLowerCase();
  const sub = typedSub.endsWith('/') && typedSub !== '/' ? typedSub.slice(0, -1) : typedSub;
  const earlyLang = langOf(url, null);
  const knownSub = sub === '' || sub === '/request' || sub === '/done' || sub === '/manage' || sub === '/logo'
    || /^\/manage\/[A-Za-z0-9_-]{43}(?:\/(?:cancel|reschedule|calendar\.ics))?$/.test(sub);
  if (!knownSub) return notFound(earlyLang);

  /* Everything before resolvePublicSlug costs no database. The sites deploy
     shares the production Hyperdrive pool with the main API, so the switch,
     the brakes and the body guards all answer from here. */
  if (env.APPS_ENABLED !== 'true') return notFound(earlyLang);
  // 307 like an old name's redirect, so a form post stays a post.
  if (typed !== slug || typedSub !== sub) return redirect(`/b/${slug}${sub}${url.search}`, 307);
  const ip = clientIp(request);
  if (env.SITES_BURST && !(await env.SITES_BURST.limit({ key: `site:${ip}` })).success) return plain('busy', earlyLang, 429);
  let form: URLSearchParams | null = null;
  if (request.method === 'POST') {
    const read = await readForm(request, earlyLang);
    if (read instanceof Response) return read;
    form = read;
    if (env.BOOKING_BURST && !(await env.BOOKING_BURST.limit({ key: `book:${ip}` })).success) return plain('busy', earlyLang, 429);
  }

  const found = await resolvePublicSlug(env, slug);
  if (!found || !appsEnabledFor(env, found.businessId)) return notFound(earlyLang);
  // Not permanent: the business may take this name up again. 307 keeps a POST a POST.
  if (found.currentSlug !== slug) return redirect(`/b/${found.currentSlug}${sub}${url.search}`, 307);
  const businessId = found.businessId;
  if (sub === '/logo') {
    if (request.method !== 'GET' || !env.ARTIFACTS) return notFound(earlyLang);
    const logo = await loadPublicLogo(env, businessId);
    if (!logo) return notFound(earlyLang);
    const object = await env.ARTIFACTS.get(logo.key);
    if (!object) return notFound(earlyLang);
    const etag = object.httpEtag;
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
    }
    return new Response(object.body, { headers: {
      'Content-Type': logo.contentType, 'Content-Length': String(object.size), ETag: etag,
      'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } });
  }
  const info = await loadPublicPage(env, businessId);
  if (!info) return notFound(earlyLang);
  const lang = langOf(url, info);
  const base = {
    slug, lang, businessName: info.businessName, location: info.settings.location, brandColor: info.settings.brandColor,
    pageTheme: info.settings.pageTheme,
    logoUrl: info.settings.logoVersion ? `/b/${slug}/logo?v=${encodeURIComponent(info.settings.logoVersion)}` : null,
  };

  const manageMatch = sub.match(/^\/manage\/([A-Za-z0-9_-]{43})(?:\/(cancel|reschedule|calendar\.ics))?$/);
  const sameOriginPost = () => request.headers.get('Origin') === origin;

  if (sub === '/manage') {
    const reference = (form?.get('reference') ?? url.searchParams.get('ref') ?? '').trim().toUpperCase();
    if (request.method === 'GET') return page(manageLoginPage({ ...base, reference, error: false }));
    if (!form || !sameOriginPost()) return notFound(lang);
    const session = await beginCustomerSession(env, businessId, reference, form.get('phone') ?? '', now);
    if (!session) return page(manageLoginPage({ ...base, reference, error: true }), 400);
    return redirect(`/b/${slug}/manage/${session.token}?lang=${lang}`, 303);
  }

  if (manageMatch) {
    const [, token, action] = manageMatch;
    if (!validCustomerToken(token)) return notFound(lang);
    const booking = await loadManagedBooking(env, businessId, token, now);
    if (!booking) return page(manageLoginPage({ ...base, reference: '', error: false, expired: true }), 401);
    if (action === 'calendar.ics') {
      if (request.method !== 'GET' || booking.status !== 'confirmed') return notFound(lang);
      return calendarFile({ ...base, booking, generatedAt: now });
    }
    if (!action && request.method === 'GET') {
      const notice = url.searchParams.get('notice');
      return page(managePage({ ...base, token, booking,
        confirmCancel: url.searchParams.get('confirm') === 'cancel',
        notice: notice === 'cancelled' || notice === 'rescheduled' ? notice : undefined,
      }));
    }
    if (action === 'cancel' && request.method === 'POST') {
      if (!form || !sameOriginPost()) return notFound(lang);
      const result = await cancelByCustomer(env, businessId, token, now);
      if (result.kind === 'not_found') return page(customerMessagePage({ ...base, kind: 'expired' }), 401);
      if (result.kind === 'cutoff') return page(customerMessagePage({ ...base, kind: 'cutoff' }), 409);
      if (result.kind === 'not_changeable' || result.kind === 'unavailable' || result.kind === 'taken') {
        return page(customerMessagePage({ ...base, kind: 'unavailable' }), 409);
      }
      return redirect(`/b/${slug}/manage/${token}?notice=cancelled&lang=${lang}`, 303);
    }
    if (action === 'reschedule') {
      if (!booking.canChange) {
        return page(managePage({ ...base, token, booking }));
      }
      if (!info.open) return page(customerMessagePage({ ...base, kind: 'unavailable' }), 409);
      if (request.method === 'POST') {
        if (!form || !sameOriginPost()) return notFound(lang);
        const startsAt = new Date(form.get('start') ?? '');
        const result = await rescheduleByCustomer(env, businessId, token, startsAt, now);
        if (result.kind === 'not_found') return page(customerMessagePage({ ...base, kind: 'expired' }), 401);
        if (result.kind === 'cutoff') return page(customerMessagePage({ ...base, kind: 'cutoff' }), 409);
        if (result.kind === 'not_changeable' || result.kind === 'unavailable') {
          return page(customerMessagePage({ ...base, kind: 'unavailable' }), 409);
        }
        if (result.kind === 'taken') {
          return redirect(`/b/${slug}/manage/${token}/reschedule?notice=taken&lang=${lang}`, 303);
        }
        return redirect(`/b/${slug}/manage/${token}?notice=rescheduled&lang=${lang}`, 303);
      }
      const asked = url.searchParams.get('date');
      const hasAskedDate = Boolean(asked && isDate(asked));
      const from = hasAskedDate ? asked! : myDate(now);
      let times = await loadOpenTimes(env, businessId, booking.serviceId, from, DAYS_SHOWN, now, booking.id);
      if (!times) return page(customerMessagePage({ ...base, kind: 'unavailable' }), 409);
      let selected = hasAskedDate ? from : times.days.find((day) => day.slots.length > 0)?.date ?? from;
      if (times.days.every((day) => day.slots.length === 0) && !hasAskedDate) {
        const horizon = await loadOpenTimes(env, businessId, booking.serviceId, from, LOOKAHEAD_DAYS, now, booking.id);
        const nextIndex = horizon?.days.findIndex((day) => day.slots.length > 0) ?? -1;
        if (horizon && nextIndex >= 0) {
          selected = horizon.days[nextIndex].date;
          times = { ...horizon, days: horizon.days.slice(nextIndex, nextIndex + DAYS_SHOWN) };
        }
      }
      const selectedStart = url.searchParams.get('start');
      const parsedStart = selectedStart ? new Date(selectedStart) : null;
      return page(reschedulePage({ ...base, token, booking, days: times.days, selected,
        selectedStart: parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null,
        notice: url.searchParams.get('notice') === 'taken',
      }));
    }
    return notFound(lang);
  }

  if (sub === '/done') {
    const reference = url.searchParams.get('ref') ?? '';
    if (request.method !== 'GET' || !REFERENCE.test(reference)) return notFound(lang);
    return page(donePage({ ...base, reference }));
  }

  const unavailable = (status: number) => page(messagePage({ ...base, kind: 'unavailable' }), status);
  const timesUrl = (serviceId: string, date: string, taken: boolean) =>
    `/b/${slug}?${new URLSearchParams({ service: serviceId, date, lang, ...(taken ? { notice: 'taken' } : {}) })}`;

  /** The form for one offered start, or a redirect back to the times. */
  async function showForm(serviceId: string, startIso: string, values: { name: string; phone: string; note: string; party: string },
    errors: FormError[], submissionKey: string, status: number): Promise<Response> {
    const startsAt = new Date(startIso);
    if (Number.isNaN(startsAt.getTime())) return redirect(`/b/${slug}?lang=${lang}`, 303);
    const date = myDate(startsAt);
    const times = await loadOpenTimes(env, businessId, serviceId, date, 1, now);
    if (!times) return redirect(`/b/${slug}?lang=${lang}`, 303);
    const slot = times.days[0]?.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
    if (!slot) return redirect(timesUrl(serviceId, date, true), 303);
    return page(formPage({
      ...base, service: times.service, startsAt, remaining: slot.remaining, submissionKey,
      values, errors, siteKey: env.TURNSTILE_SITE_KEY,
    }), status);
  }

  if (form && sub === '/request') {
    const parsed = parseRequestForm(form);
    const values = {
      name: form.get('name') ?? '', phone: form.get('phone') ?? '',
      note: form.get('note') ?? '', party: form.get('party') ?? '1',
    };
    const serviceId = form.get('service') ?? '';
    const start = form.get('start') ?? '';
    if (!parsed.ok) {
      if (!info.open) return unavailable(409);
      // A malformed key is replaced, so the form shown again can still be sent.
      const key = parsed.errors.includes('submission') ? crypto.randomUUID() : form.get('submission_key') ?? '';
      return showForm(serviceId, start, values, parsed.errors, key, 400);
    }

    const input = parsed.value;
    const key = input.submissionKey;
    const digest = await submissionDigest(input);
    /* A form already committed keeps its receipt, even once the owner has
       paused: the customer did send it. So the lookup runs before the open
       gate, and before Turnstile, since the original token may be spent. */
    const earlier = await findSubmission(env, businessId, key, digest);
    if (earlier?.kind === 'replayed') return redirect(`/b/${slug}/done?ref=${earlier.reference}&lang=${lang}`, 303);
    if (earlier?.kind === 'changed') return page(messagePage({ ...base, kind: 'changed' }), 409);
    if (!info.open) return unavailable(409);

    // Both taps of a double-tap carry one token, so one key lets it verify twice.
    const token = form.get('cf-turnstile-response');
    const verdict = await verifyTurnstile(env, token, ip, deps.fetchImpl ?? fetch, {
      action: 'booking', hostnames: new Set([new URL(env.SITES_ORIGIN ?? 'https://invalid.invalid').hostname]),
      idempotencyKey: token ? await turnstileIdempotencyKey(key, token) : undefined,
    });
    if (verdict === 'missing' || verdict === 'rejected') return showForm(serviceId, start, values, ['turnstile'], key, 400);

    const result = await createBookingRequest(env, businessId, input, digest, now);
    switch (result.kind) {
      case 'created':
      case 'replayed':
        return redirect(`/b/${slug}/done?ref=${result.reference}&lang=${lang}`, 303);
      case 'changed':
        return page(messagePage({ ...base, kind: 'changed' }), 409);
      case 'unavailable':
        return unavailable(409);
      case 'daily_cap':
        return showForm(serviceId, start, values, ['daily_cap'], key, 429);
      case 'service_gone':
        return redirect(`/b/${slug}?lang=${lang}`, 303);
      case 'taken':
        return redirect(timesUrl(input.serviceId, myDate(input.startsAt), true), 303);
    }
  }

  if (!info.open) return unavailable(request.method === 'POST' ? 409 : 200);

  if (sub === '' && request.method === 'GET') {
    const serviceId = url.searchParams.get('service');
    if (!serviceId) return page(servicesPage({ ...base, services: info.services }));
    const asked = url.searchParams.get('date');
    const hasAskedDate = Boolean(asked && isDate(asked));
    const from = hasAskedDate ? asked! : myDate(now);
    let times = await loadOpenTimes(env, businessId, serviceId, from, DAYS_SHOWN, now);
    if (!times) return redirect(`/b/${slug}?lang=${lang}`, 303);
    let selected = hasAskedDate ? from : times.days.find((day) => day.slots.length > 0)?.date ?? from;
    let nextAvailable = times.days.find((day) => day.date > selected && day.slots.length > 0)?.date ?? null;
    if (times.days.every((day) => day.slots.length === 0)) {
      const horizon = await loadOpenTimes(env, businessId, serviceId, from, LOOKAHEAD_DAYS, now);
      if (!horizon) return redirect(`/b/${slug}?lang=${lang}`, 303);
      const nextIndex = horizon.days.findIndex((day) => day.date > selected && day.slots.length > 0);
      nextAvailable = nextIndex >= 0 ? horizon.days[nextIndex].date : null;
      // On first arrival, take the customer straight to the earliest useful
      // week. An explicit or bookmarked date stays selected and gets a link.
      if (!hasAskedDate && nextIndex >= 0) {
        selected = horizon.days[nextIndex].date;
        times = { ...horizon, days: horizon.days.slice(nextIndex, nextIndex + DAYS_SHOWN) };
        nextAvailable = null;
      }
    }
    const selectedStartValue = url.searchParams.get('start');
    const selectedStart = selectedStartValue ? new Date(selectedStartValue) : null;
    return page(timesPage({
      ...base, service: times.service, days: times.days, selected, nextAvailable,
      selectedStart: selectedStart && !Number.isNaN(selectedStart.getTime()) ? selectedStart : null,
      notice: url.searchParams.get('notice') === 'taken' ? 'taken' : null,
    }));
  }

  if (sub === '/request' && request.method === 'GET') {
    return showForm(url.searchParams.get('service') ?? '', url.searchParams.get('start') ?? '',
      { name: '', phone: '', note: '', party: '1' }, [], crypto.randomUUID(), 200);
  }

  return notFound(lang);
}

export default {
  async fetch(request: Request, env: SitesEnv): Promise<Response> {
    try {
      return await handleSites(request, env);
    } catch (error) {
      // Name and SQLSTATE only: a message or detail can carry customer values.
      console.error('sites: request failed', error instanceof Error ? error.name : typeof error,
        (error as { code?: unknown } | null)?.code ?? '');
      return new Response('Something went wrong. Please try again.', {
        status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
      });
    }
  },
};
