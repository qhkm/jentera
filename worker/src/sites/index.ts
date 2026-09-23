import { appsEnabledFor } from '../apps/gating';
import type { Lang } from '../apps/bookings/messages';
import { loadOpenTimes, loadPublicPage, resolvePublicSlug, type PublicPage } from '../apps/bookings/public';
import { REFERENCE } from '../apps/bookings/reference';
import { createBookingRequest, findSubmission, parseRequestForm, submissionDigest } from '../apps/bookings/request';
import { isDate, myDate } from '../apps/bookings/time';
import { clientIp } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';
import type { SitesEnv } from './env';
import { donePage, formPage, messagePage, page, redirect, servicesPage, timesPage, SECURITY_HEADERS, type FormError, type MessageKind } from './render';

/* The public booking pages: the whole of the jentera-sites deploy. It never
   reads or sets a cookie and holds no credential; a business is found only
   through bookings_by_slug and everything after runs under withTenant. */

const PATH = /^\/b\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(\/request|\/done)?\/?$/;
const DAYS_SHOWN = 7;
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

/** The booking form's fields, or the refusal. Only a small urlencoded body is
    read at all: FormData would throw on anything else and buffer a multipart
    body of any size first. */
async function readForm(request: Request, lang: Lang): Promise<URLSearchParams | Response> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== FORM_TYPE) return plain('bad_request', lang, 400);
  if (Number(request.headers.get('Content-Length')) > BODY_MAX) return plain('bad_request', lang, 413);
  const text = await request.text();
  if (text.length > BODY_MAX) return plain('bad_request', lang, 413);
  return new URLSearchParams(text);
}

export async function handleSites(request: Request, env: SitesEnv, deps: Deps = {}): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const url = new URL(request.url);
  const match = url.pathname.match(PATH);
  if (!match || (request.method !== 'GET' && request.method !== 'POST')) return notFound('en');
  const [, slug, sub = ''] = match;

  /* Everything before resolvePublicSlug costs no database. The sites deploy
     shares the production Hyperdrive pool with the main API, so the switch,
     the brakes and the body guards all answer from here. */
  const asked = langOf(url, null);
  if (env.APPS_ENABLED !== 'true') return notFound(asked);
  const ip = clientIp(request);
  if (env.SITES_BURST && !(await env.SITES_BURST.limit({ key: `site:${ip}` })).success) return plain('busy', asked, 429);
  let form: URLSearchParams | null = null;
  if (sub === '/request' && request.method === 'POST') {
    const read = await readForm(request, asked);
    if (read instanceof Response) return read;
    form = read;
    if (env.BOOKING_BURST && !(await env.BOOKING_BURST.limit({ key: `book:${ip}` })).success) return plain('busy', asked, 429);
  }

  const found = await resolvePublicSlug(env, slug);
  if (!found || !appsEnabledFor(env, found.businessId)) return notFound(asked);
  if (found.currentSlug !== slug) {
    return redirect(`/b/${found.currentSlug}${sub}${url.search}`, 301);
  }
  const businessId = found.businessId;
  const info = await loadPublicPage(env, businessId);
  if (!info) return notFound(asked);
  const lang = langOf(url, info);
  const base = { slug, lang, businessName: info.businessName };

  if (sub === '/done') {
    const reference = url.searchParams.get('ref') ?? '';
    if (request.method !== 'GET' || !REFERENCE.test(reference)) return notFound(lang);
    return page(donePage({ ...base, reference }));
  }

  if (!info.open) return page(messagePage({ ...base, kind: 'unavailable' }), request.method === 'POST' ? 409 : 200);

  const timesUrl = (serviceId: string, date: string, taken: boolean) =>
    `/b/${slug}?${new URLSearchParams({ service: serviceId, date, lang, ...(taken ? { notice: 'taken' } : {}) })}`;

  if (sub === '' && request.method === 'GET') {
    const serviceId = url.searchParams.get('service');
    if (!serviceId) return page(servicesPage({ ...base, services: info.services }));
    const asked = url.searchParams.get('date');
    const from = asked && isDate(asked) ? asked : myDate(now);
    const times = await loadOpenTimes(env, businessId, serviceId, from, DAYS_SHOWN, now);
    if (!times) return redirect(`/b/${slug}?lang=${lang}`, 303);
    return page(timesPage({
      ...base, service: times.service, days: times.days, selected: times.days[0]?.date ?? from,
      notice: url.searchParams.get('notice') === 'taken' ? 'taken' : null,
    }));
  }

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

  if (sub === '/request' && request.method === 'GET') {
    return showForm(url.searchParams.get('service') ?? '', url.searchParams.get('start') ?? '',
      { name: '', phone: '', note: '', party: '1' }, [], crypto.randomUUID(), 200);
  }

  if (form) {
    const parsed = parseRequestForm(form);
    const values = {
      name: form.get('name') ?? '', phone: form.get('phone') ?? '',
      note: form.get('note') ?? '', party: form.get('party') ?? '1',
    };
    // A malformed key is replaced, so the form shown again can still be sent.
    const key = parsed.ok ? parsed.value.submissionKey
      : parsed.errors.includes('submission') ? crypto.randomUUID() : form.get('submission_key') ?? '';
    const serviceId = form.get('service') ?? '';
    const start = form.get('start') ?? '';
    if (!parsed.ok) return showForm(serviceId, start, values, parsed.errors, key, 400);

    const input = parsed.value;
    const digest = await submissionDigest(input);
    const earlier = await findSubmission(env, businessId, input.submissionKey, digest);
    if (earlier?.kind === 'replayed') return redirect(`/b/${slug}/done?ref=${earlier.reference}&lang=${lang}`, 303);
    if (earlier?.kind === 'changed') return page(messagePage({ ...base, kind: 'changed' }), 409);

    const verdict = await verifyTurnstile(env, form.get('cf-turnstile-response'), ip, deps.fetchImpl ?? fetch,
      { action: 'booking', hostnames: new Set([new URL(env.SITES_ORIGIN ?? 'https://invalid.invalid').hostname]) });
    if (verdict === 'missing' || verdict === 'rejected') return showForm(serviceId, start, values, ['turnstile'], key, 400);

    const result = await createBookingRequest(env, businessId, input, digest, now);
    switch (result.kind) {
      case 'created':
      case 'replayed':
        return redirect(`/b/${slug}/done?ref=${result.reference}&lang=${lang}`, 303);
      case 'changed':
        return page(messagePage({ ...base, kind: 'changed' }), 409);
      case 'unavailable':
        return page(messagePage({ ...base, kind: 'unavailable' }), 409);
      case 'daily_cap':
        return showForm(serviceId, start, values, ['daily_cap'], key, 429);
      case 'service_gone':
        return redirect(`/b/${slug}?lang=${lang}`, 303);
      case 'taken':
        return redirect(timesUrl(input.serviceId, myDate(input.startsAt), true), 303);
    }
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
