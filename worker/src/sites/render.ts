import type { DayTimes, PublicService } from '../apps/bookings/public';
import type { RequestField } from '../apps/bookings/request';
import { clockText, dateText, type Lang } from '../apps/bookings/messages';
import { myDate, myInstant } from '../apps/bookings/time';

/* Server-rendered booking pages. Every business- or customer-supplied string
   goes through escapeHtml. No script of ours runs on these pages; the only
   script is Cloudflare's Turnstile widget. */

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'no-store',
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function page(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
}

/** 303 after a POST or to send a customer back a step; 307 for a link name
    the business used before, which it may take up again and which must keep
    a POST a POST. */
export function redirect(location: string, status: 303 | 307 | 308): Response {
  return new Response(null, { status, headers: { Location: location, ...SECURITY_HEADERS } });
}

export type FormError = RequestField | 'turnstile' | 'daily_cap';

/** The whole-page messages. `busy` and `bad_request` are answered before the
    business is known, so they carry no name and no way back. */
export type MessageKind = 'not_found' | 'unavailable' | 'changed' | 'busy' | 'bad_request';

const T = {
  en: {
    chooseService: 'Choose a service', chooseTime: 'Choose a time', noTimes: 'No open times on this day.',
    placesLeft: (n: number) => (n === 1 ? '1 place left' : `${n} places left`), minutes: (n: number) => `${n} min`,
    yourDetails: 'Your details', name: 'Your name', phone: 'Phone number (WhatsApp)', party: 'How many people',
    note: 'Note (optional)', send: 'Send request', back: 'Back', otherLang: 'Bahasa Melayu', poweredBy: 'Bookings by Jentera',
    privacy: (b: string) => `Your name and phone number go to ${b} to handle this booking.`, privacyLink: 'Privacy',
    receivedTitle: 'Request received', received: (b: string) => `${b} will confirm on WhatsApp.`, reference: 'Reference',
    taken: 'That time was just taken. Please choose another.',
    titles: { not_found: 'Page not found', unavailable: 'Not taking bookings right now', changed: 'Please start a fresh request', busy: 'Please try again shortly', bad_request: 'Please start again' },
    bodies: {
      not_found: 'This booking page does not exist.',
      unavailable: 'Please check back later.',
      changed: 'This form was already sent with different details. Start again to send a new request.',
      busy: 'Too many requests from this connection. Wait a minute and try again.',
      bad_request: 'This form could not be read. Go back and try again.',
    },
    errors: {
      service: 'Please choose a service again.', start: 'Please choose a time again.', name: 'Please enter your name.',
      phone: 'Please enter a Malaysian phone number.', partySize: 'Please choose how many people.',
      note: 'Please keep the note under 500 characters.', submission: 'Please reload the page and try again.',
      turnstile: 'Please complete the check before sending.',
      daily_cap: 'This business has received many requests today. Please try again tomorrow.',
    },
  },
  bm: {
    chooseService: 'Pilih perkhidmatan', chooseTime: 'Pilih masa', noTimes: 'Tiada masa kosong pada hari ini.',
    placesLeft: (n: number) => `${n} tempat lagi`, minutes: (n: number) => `${n} min`,
    yourDetails: 'Butiran anda', name: 'Nama anda', phone: 'Nombor telefon (WhatsApp)', party: 'Bilangan orang',
    note: 'Nota (pilihan)', send: 'Hantar permintaan', back: 'Kembali', otherLang: 'English', poweredBy: 'Tempahan oleh Jentera',
    privacy: (b: string) => `Nama dan nombor telefon anda dihantar kepada ${b} untuk menguruskan tempahan ini.`, privacyLink: 'Privasi',
    receivedTitle: 'Permintaan diterima', received: (b: string) => `${b} akan mengesahkan melalui WhatsApp.`, reference: 'Rujukan',
    taken: 'Masa itu baru sahaja diambil. Sila pilih masa lain.',
    titles: { not_found: 'Halaman tidak dijumpai', unavailable: 'Tidak menerima tempahan buat masa ini', changed: 'Sila mulakan permintaan baharu', busy: 'Sila cuba sebentar lagi', bad_request: 'Sila mulakan semula' },
    bodies: {
      not_found: 'Halaman tempahan ini tidak wujud.',
      unavailable: 'Sila cuba lagi kemudian.',
      changed: 'Borang ini sudah dihantar dengan butiran lain. Mulakan semula untuk menghantar permintaan baharu.',
      busy: 'Terlalu banyak permintaan dari sambungan ini. Tunggu seminit dan cuba lagi.',
      bad_request: 'Borang ini tidak dapat dibaca. Kembali dan cuba lagi.',
    },
    errors: {
      service: 'Sila pilih perkhidmatan semula.', start: 'Sila pilih masa semula.', name: 'Sila masukkan nama anda.',
      phone: 'Sila masukkan nombor telefon Malaysia.', partySize: 'Sila pilih bilangan orang.',
      note: 'Sila pastikan nota kurang daripada 500 aksara.', submission: 'Sila muat semula halaman dan cuba lagi.',
      turnstile: 'Sila lengkapkan semakan sebelum menghantar.',
      daily_cap: 'Perniagaan ini telah menerima banyak permintaan hari ini. Sila cuba lagi esok.',
    },
  },
} as const;

const CSS = `body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#faf9f7;color:#1f2328}
main{max-width:34rem;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.4rem;margin:.25rem 0 1rem}h2{font-size:1.05rem;margin:1.25rem 0 .5rem}
a{color:#0b6e4f}.card{display:block;padding:.9rem 1rem;margin:.5rem 0;border:1px solid #e3e1dc;border-radius:.9rem;background:#fff;text-decoration:none;color:inherit}
.muted{color:#5f6368;font-size:.9rem}.days{display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.25rem}.day{flex:0 0 auto;padding:.5rem .7rem;border:1px solid #e3e1dc;border-radius:.7rem;text-decoration:none;color:inherit;background:#fff;text-align:center}
.day[aria-current="date"]{border-color:#0b6e4f;background:#e7f4ee}.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr));gap:.5rem}
label{display:block;font-weight:600;margin:.9rem 0 .3rem}input,select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.65rem .75rem;border:1px solid #cfccc5;border-radius:.6rem;background:#fff}
button{width:100%;margin-top:1.1rem;font:inherit;font-weight:600;padding:.8rem;border:0;border-radius:.7rem;background:#0b6e4f;color:#fff}
.error{color:#b3261e;font-size:.9rem;margin:.25rem 0 0}.notice{padding:.7rem .9rem;border-radius:.7rem;background:#fdecea;color:#7a1d16}
.lang{float:right;font-size:.9rem}footer{margin-top:2rem;font-size:.8rem;color:#80868b;text-align:center}
@media (prefers-color-scheme:dark){body{background:#151515;color:#ececec}.card,.day,input,select,textarea{background:#1f1f1f;border-color:#333;color:inherit}.day[aria-current="date"]{background:#123326}.muted{color:#aaa}a{color:#5fd3a6}.notice{background:#3a1512;color:#f6c8c3}}`;

interface Base { slug: string; lang: Lang; businessName: string }

function href(slug: string, path: '' | '/request' | '/done', params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return escapeHtml(`/b/${slug}${path}${query ? `?${query}` : ''}`);
}

function layout(input: { lang: Lang; title: string; body: string; langSwitch?: string; widget?: boolean }): string {
  const t = T[input.lang];
  return `<!doctype html><html lang="${input.lang === 'bm' ? 'ms' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(input.title)}</title><style>${CSS}</style>${input.widget ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}</head>
<body><main>${input.langSwitch ? `<a class="lang" href="${input.langSwitch}">${t.otherLang}</a>` : ''}${input.body}
<footer>${t.poweredBy}</footer></main></body></html>`;
}

const other = (lang: Lang): Lang => (lang === 'bm' ? 'en' : 'bm');

function dayLabel(date: string, lang: Lang): string {
  return dateText(myInstant(date), lang);
}

export function servicesPage(input: Base & { services: PublicService[] }): string {
  const t = T[input.lang];
  const items = input.services.map((s) => `<a class="card" href="${href(input.slug, '', { service: s.id, lang: input.lang })}">
<strong>${escapeHtml(s.name)}</strong><div class="muted">${t.minutes(s.durationMinutes)}${s.priceLabel ? ` · ${escapeHtml(s.priceLabel)}` : ''}</div></a>`).join('');
  return layout({
    lang: input.lang, title: input.businessName,
    langSwitch: href(input.slug, '', { lang: other(input.lang) }),
    body: `<h1>${escapeHtml(input.businessName)}</h1><h2>${t.chooseService}</h2>${items}`,
  });
}

export function timesPage(input: Base & { service: PublicService; days: DayTimes[]; selected: string; notice: 'taken' | null }): string {
  const t = T[input.lang];
  const chosen = input.days.find((d) => d.date === input.selected) ?? input.days[0];
  const strip = input.days.map((d) => `<a class="day" href="${href(input.slug, '', { service: input.service.id, date: d.date, lang: input.lang })}"${d.date === chosen?.date ? ' aria-current="date"' : ''}>${dayLabel(d.date, input.lang)}</a>`).join('');
  const times = chosen && chosen.slots.length > 0
    ? `<div class="times">${chosen.slots.map((s) => `<a class="card" href="${href(input.slug, '/request', { service: input.service.id, start: s.startsAt.toISOString(), lang: input.lang })}"><strong>${clockText(s.startsAt, input.lang)}</strong><div class="muted">${t.placesLeft(s.remaining)}</div></a>`).join('')}</div>`
    : `<p class="muted">${t.noTimes}</p>`;
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`,
    langSwitch: href(input.slug, '', { service: input.service.id, date: chosen?.date ?? input.selected, lang: other(input.lang) }),
    body: `<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a><h1>${escapeHtml(input.service.name)}</h1>
${input.notice === 'taken' ? `<p class="notice">${t.taken}</p>` : ''}<h2>${t.chooseTime}</h2><nav class="days">${strip}</nav><h2>${chosen ? dayLabel(chosen.date, input.lang) : ''}</h2>${times}`,
  });
}

export function formPage(input: Base & {
  service: PublicService;
  startsAt: Date;
  remaining: number;
  submissionKey: string;
  values: { name: string; phone: string; note: string; party: string };
  errors: FormError[];
  siteKey: string | undefined;
}): string {
  const t = T[input.lang];
  const err = (field: FormError) => (input.errors.includes(field) ? `<p class="error">${t.errors[field]}</p>` : '');
  /* A field's own error is tied to it, so a screen reader announces the
     field as invalid and reads the reason with it. */
  const invalid = (field: RequestField, id: string) =>
    (input.errors.includes(field) ? ` aria-invalid="true" aria-describedby="${id}-error"` : '');
  const fieldErr = (field: RequestField, id: string) =>
    (input.errors.includes(field) ? `<p class="error" id="${id}-error">${t.errors[field]}</p>` : '');
  const max = Math.min(input.remaining, 50);
  const options = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${String(n) === input.values.party ? ' selected' : ''}>${n}</option>`).join('');
  const general = (['service', 'start', 'submission', 'daily_cap'] as FormError[]).map(err).join('');
  const date = input.startsAt.toISOString();
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`, widget: Boolean(input.siteKey),
    langSwitch: href(input.slug, '/request', { service: input.service.id, start: date, lang: other(input.lang) }),
    body: `<a href="${href(input.slug, '', { service: input.service.id, lang: input.lang })}">${t.back}</a>
<h1>${escapeHtml(input.service.name)}</h1><p class="muted">${dayLabel(myDate(input.startsAt), input.lang)} · ${clockText(input.startsAt, input.lang)}</p>
${general}<form method="post" action="${href(input.slug, '/request', { lang: input.lang })}">
<input type="hidden" name="service" value="${escapeHtml(input.service.id)}"><input type="hidden" name="start" value="${escapeHtml(date)}">
<input type="hidden" name="submission_key" value="${escapeHtml(input.submissionKey)}">
<h2>${t.yourDetails}</h2>
<label for="name">${t.name}</label><input id="name" name="name" autocomplete="name" maxlength="80" required${invalid('name', 'name')} value="${escapeHtml(input.values.name)}">${fieldErr('name', 'name')}
<label for="phone">${t.phone}</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required${invalid('phone', 'phone')} value="${escapeHtml(input.values.phone)}">${fieldErr('phone', 'phone')}
<label for="party">${t.party}</label><select id="party" name="party"${invalid('partySize', 'party')}>${options}</select>${fieldErr('partySize', 'party')}
<label for="note">${t.note}</label><textarea id="note" name="note" maxlength="500" rows="3"${invalid('note', 'note')}>${escapeHtml(input.values.note)}</textarea>${fieldErr('note', 'note')}
${input.siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(input.siteKey)}" data-action="booking" data-language="${input.lang === 'bm' ? 'ms' : 'en'}"></div>` : ''}${err('turnstile')}
<p class="muted">${escapeHtml(t.privacy(input.businessName))} <a href="https://jentera.ai/privacy">${t.privacyLink}</a></p>
<button type="submit">${t.send}</button></form>`,
  });
}

export function donePage(input: Base & { reference: string }): string {
  const t = T[input.lang];
  return layout({
    lang: input.lang, title: t.receivedTitle,
    body: `<h1>${t.receivedTitle}</h1><p>${escapeHtml(t.received(input.businessName))}</p>
<p class="card"><span class="muted">${t.reference}</span><br><strong>${escapeHtml(input.reference)}</strong></p>
<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a>`,
  });
}

export function messagePage(input: { slug: string | null; lang: Lang; businessName: string | null; kind: MessageKind }): string {
  const t = T[input.lang];
  const heading = input.businessName ? `<p class="muted">${escapeHtml(input.businessName)}</p>` : '';
  const back = input.slug && input.kind !== 'not_found' ? `<a href="${href(input.slug, '', { lang: input.lang })}">${t.back}</a>` : '';
  return layout({
    lang: input.lang, title: t.titles[input.kind],
    body: `${heading}<h1>${t.titles[input.kind]}</h1><p>${t.bodies[input.kind]}</p>${back}`,
  });
}
