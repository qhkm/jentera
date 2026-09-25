import type { DayTimes, PublicService } from '../apps/bookings/public';
import type { RequestField } from '../apps/bookings/request';
import { clockText, dateText, type Lang } from '../apps/bookings/messages';
import { myDate, myInstant } from '../apps/bookings/time';

/* Server-rendered booking pages. Every business- or customer-supplied string
   goes through escapeHtml. No script of ours runs on these pages; the only
   script is Cloudflare's Turnstile widget. */

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
    booking: 'Book an appointment', intro: 'A little time, just for you.', serviceHint: 'Select a service to see available dates and times.',
    steps: ['Service', 'Date & time', 'Your details'], process: 'How it works',
    guidance: 'Choose your service and a time that suits you. Send your details, and the business will confirm on WhatsApp.',
    pending: 'Your booking is confirmed only after the business gets in touch.', timezone: 'Malaysia time (GMT+8)',
    location: 'Location', locationFallback: 'Confirmed on WhatsApp',
    select: 'View times', dateHint: 'Choose a date, then pick an available time below.', detailsHint: 'Where should we send your booking confirmation?',
    emptyHint: 'Try another date to find an available time.',
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
    booking: 'Tempah janji temu', intro: 'Luangkan masa untuk diri anda.', serviceHint: 'Pilih perkhidmatan untuk melihat tarikh dan masa yang tersedia.',
    steps: ['Perkhidmatan', 'Tarikh & masa', 'Butiran anda'], process: 'Cara membuat tempahan',
    guidance: 'Pilih perkhidmatan dan masa yang sesuai. Hantar butiran anda, dan pihak perniagaan akan mengesahkan melalui WhatsApp.',
    pending: 'Tempahan anda disahkan hanya selepas pihak perniagaan menghubungi anda.', timezone: 'Waktu Malaysia (GMT+8)',
    location: 'Lokasi', locationFallback: 'Disahkan melalui WhatsApp',
    select: 'Lihat masa', dateHint: 'Pilih tarikh, kemudian pilih masa yang tersedia di bawah.', detailsHint: 'Ke mana kami boleh menghantar pengesahan tempahan anda?',
    emptyHint: 'Cuba tarikh lain untuk mencari masa yang tersedia.',
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

// Visual tokens match app/src/styles/workspace-v3.css; actions match tokens.css.
const CSS = `@font-face{font-family:"Geist Sans";src:url("/geist-sans.woff2") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{color-scheme:dark;--bg:#080808;--surface:#181818;--ink:#f2f2f2;--muted:#aaa;--line:rgb(255 255 255 / .12);--soft:#242424;--accent:#4aebb5;--primary:#f3f7f5;--primary-ink:#101514;--focus:#72efc5;--radius-card:16px;--radius-item:13px;--radius-control:12px}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 "Geist Sans","DM Sans",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
a{color:var(--accent);text-underline-offset:4px}a,button,input,select,textarea{-webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--focus);outline-offset:4px}
.topbar{max-width:1080px;margin:auto;padding:28px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{font-size:25px;font-weight:650;letter-spacing:-.035em;display:flex;align-items:center;gap:10px}.brand-mark{display:block;width:36px;height:36px;flex-shrink:0}.brand>.muted{font-size:13px;font-weight:400;letter-spacing:0}.lang{font-size:13px;color:var(--ink);padding:8px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none}
main{max-width:1032px;margin:28px auto 0;padding:0 24px}.booking-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:48px;align-items:start}.business{padding:24px 0}.avatar{width:64px;height:64px;display:grid;place-items:center;background:var(--soft);border:1px solid var(--line);border-radius:var(--radius-control);font-size:24px;font-weight:650;margin-bottom:24px}.eyebrow{font-size:11px;letter-spacing:1.8px;text-transform:uppercase;font-weight:650;color:var(--muted)}.business-name{font-size:27px;line-height:1.25;letter-spacing:-1px;margin:12px 0 18px;overflow-wrap:anywhere}.business-copy{color:var(--muted);font-size:14px}.explanation{border-top:1px solid var(--line);margin-top:30px;padding-top:24px}.explanation strong{font-size:13px}.location{display:flex;gap:10px;margin-top:24px;color:var(--muted);font-size:13px}.location span:first-child{color:var(--accent)}.location strong{display:block;color:var(--ink);font-size:12px}.timezone{font-size:12px;color:var(--muted);margin-top:24px}
.panel{background:transparent;border:1px solid var(--line);border-radius:var(--radius-card);padding:32px;box-shadow:none;min-width:0;min-height:390px}.steps{display:flex;list-style:none;padding:0 0 25px;margin:0 0 30px;border-bottom:1px solid var(--line);gap:16px}.steps li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}.steps span{display:grid;place-items:center;width:23px;height:23px;flex-shrink:0;border:1px solid var(--line);border-radius:50%;font-size:11px}.steps [aria-current]{color:var(--accent);font-weight:650}.steps [aria-current] span{background:var(--accent);border-color:var(--accent);color:var(--bg)}
h1{font-size:25px;line-height:1.25;letter-spacing:-.7px;margin:8px 0 10px;overflow-wrap:anywhere}h2{font-size:16px;margin:26px 0 14px;letter-spacing:-.2px}p{margin:10px 0 20px}.muted{color:var(--muted);font-size:14px}.intro{margin-bottom:28px}.back{display:inline-block;font-size:13px;margin-bottom:20px;text-decoration:none}.card{display:block;padding:18px;margin:10px 0;border:1px solid var(--line);border-radius:var(--radius-item);background:var(--surface);text-decoration:none;color:inherit;overflow-wrap:anywhere}a.card:hover,.day:hover{border-color:var(--accent);background:var(--soft)}.service-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px}.service-card strong{font-size:17px}.service-card .muted{margin-top:6px}.service-description{max-width:32rem;margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.5}.service-action{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}.price{display:inline-block;padding-left:12px;margin-left:12px;border-left:1px solid var(--line);color:var(--ink)}.summary{padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-item);margin:0 0 24px}.summary .muted{margin:4px 0 0}.summary .location{margin-top:12px}.pending{font-size:12px;color:var(--muted);margin-top:24px}.empty{padding:28px 18px;text-align:center;background:var(--soft);border-radius:12px}.empty p{margin:4px 0}
.days{display:flex;gap:8px;overflow-x:auto;padding:4px 4px 12px;scrollbar-width:thin}.day{flex:0 0 68px;padding:10px 6px;border:1px solid var(--line);border-radius:var(--radius-control);text-decoration:none;color:var(--muted);background:var(--surface);text-align:center;font-size:11px}.day strong{display:block;font-size:22px;line-height:1.4;color:var(--ink)}.day[aria-current="date"]{border-color:var(--accent);background:var(--accent);color:var(--bg)}.day[aria-current="date"] strong{color:var(--bg)}.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:10px}.times .card{margin:0;text-align:center;padding:14px 8px}.times .muted{font-size:11px;margin-top:4px}
label{display:block;font-size:13px;font-weight:600;margin:18px 0 7px}input,select,textarea{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--surface);color:var(--ink)}textarea{resize:vertical}button{width:100%;margin-top:12px;font:inherit;font-weight:600;min-height:48px;padding:12px 24px;border:1px solid var(--primary);border-radius:999px;background:var(--primary);color:var(--primary-ink);cursor:pointer}button:hover{background:#fff}form>.muted{font-size:12px;margin-top:20px}.error{color:#ffb4ab;font-size:13px;margin:5px 0 0}.notice{padding:12px 16px;border-radius:10px;background:#3a1512;color:#f6c8c3}.success-mark{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:var(--soft);color:var(--accent);font-size:26px;margin-bottom:24px}footer{margin:28px 0 32px;font-size:12px;color:var(--muted);text-align:center}
@media(max-width:760px){.topbar{padding:18px 20px}main{margin:0 auto;padding:0 20px}.booking-layout{grid-template-columns:1fr;gap:20px}.business{padding:12px 0 0;display:grid;grid-template-columns:48px 1fr;column-gap:14px}.avatar{width:48px;height:48px;border-radius:13px;font-size:19px;grid-row:1/4;margin:0}.business .eyebrow{margin:0}.business-name{font-size:22px;margin:4px 0 0}.business-copy,.explanation,.business>.timezone{display:none}.panel{padding:24px;min-height:340px;border-radius:16px}.steps{gap:12px;margin-bottom:24px}.steps li{font-size:11px;gap:5px}h1{font-size:23px}.service-card{padding:18px}.service-action{font-size:11px}}
@media(max-width:760px){.brand>.muted{display:none}.lang{white-space:nowrap}.summary .timezone{margin-top:8px}}
@media(max-width:380px){main{padding:0 12px}.panel{padding:20px 16px}.steps{gap:8px}.steps li{font-size:10px}.service-card{gap:10px}.service-action{white-space:normal}}
`;

interface Base { slug: string; lang: Lang; businessName: string; location?: string | null }

function href(slug: string, path: '' | '/request' | '/done', params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return escapeHtml(`/b/${slug}${path}${query ? `?${query}` : ''}`);
}

function locationHtml(lang: Lang, location?: string | null): string {
  const t = T[lang];
  return `<div class="location"><span aria-hidden="true">⌖</span><span><strong>${t.location}</strong>${escapeHtml(location?.trim() || t.locationFallback)}</span></div>`;
}

function layout(input: { lang: Lang; title: string; body: string; langSwitch?: string; widget?: boolean; businessName?: string; location?: string | null; step?: number }): string {
  const t = T[input.lang];
  const name = input.businessName;
  const sidebar = name ? `<aside class="business"><div class="avatar" aria-hidden="true">${escapeHtml(Array.from(name.trim())[0]?.toUpperCase() ?? '')}</div><div class="eyebrow">${t.booking}</div><h2 class="business-name">${escapeHtml(name)}</h2><p class="business-copy">${t.intro}</p>${locationHtml(input.lang, input.location)}<div class="explanation"><strong>${t.process}</strong><p class="business-copy">${t.guidance}</p></div><div class="timezone">${t.timezone}</div></aside>` : '';
  const steps = input.step ? `<ol class="steps">${t.steps.map((label, i) => `<li${input.step === i + 1 ? ' aria-current="step"' : ''}><span>${i + 1}</span>${label}</li>`).join('')}</ol>` : '';
  return `<!doctype html><html lang="${input.lang === 'bm' ? 'ms' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(input.title)}</title><link rel="icon" href="/favicon.svg"><link rel="preload" href="/geist-sans.woff2" as="font" type="font/woff2" crossorigin><style>${CSS}</style>${input.widget ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}</head>
<body><header class="topbar"><div class="brand"><img class="brand-mark" src="/favicon.svg" width="36" height="36" alt="" aria-hidden="true">jentera<span class="muted">/ ${t.booking}</span></div>${input.langSwitch ? `<a class="lang" href="${input.langSwitch}">${t.otherLang}</a>` : ''}</header><main><div${name ? ' class="booking-layout"' : ''}>${sidebar}<section class="panel">${steps}${input.body}</section></div>
<footer>${t.poweredBy}</footer></main></body></html>`;
}

const other = (lang: Lang): Lang => (lang === 'bm' ? 'en' : 'bm');

function dayLabel(date: string, lang: Lang): string {
  return dateText(myInstant(date), lang);
}

export function servicesPage(input: Base & { services: PublicService[] }): string {
  const t = T[input.lang];
  const items = input.services.map((s) => `<a class="card service-card" href="${href(input.slug, '', { service: s.id, lang: input.lang })}">
<div><strong>${escapeHtml(s.name)}</strong>${s.description ? `<p class="service-description">${escapeHtml(s.description)}</p>` : ''}<div class="muted">${t.minutes(s.durationMinutes)}${s.priceLabel ? `<span class="price">${escapeHtml(s.priceLabel)}</span>` : ''}</div></div><span class="service-action">${t.select} <span aria-hidden="true">↗</span></span></a>`).join('');
  return layout({
    lang: input.lang, title: input.businessName, businessName: input.businessName, location: input.location, step: 1,
    langSwitch: href(input.slug, '', { lang: other(input.lang) }),
    body: `<h1>${t.chooseService}</h1><p class="muted intro">${t.serviceHint}</p>${items}<p class="pending">${t.pending}</p>`,
  });
}

export function timesPage(input: Base & { service: PublicService; days: DayTimes[]; selected: string; notice: 'taken' | null }): string {
  const t = T[input.lang];
  const chosen = input.days.find((d) => d.date === input.selected) ?? input.days[0];
  const strip = input.days.map((d) => {
    const date = myInstant(d.date);
    const locale = input.lang === 'bm' ? 'ms-MY' : 'en-MY';
    const part = (options: Intl.DateTimeFormatOptions) => escapeHtml(new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Kuala_Lumpur' }).format(date));
    return `<a class="day" aria-label="${escapeHtml(dayLabel(d.date, input.lang))}" href="${href(input.slug, '', { service: input.service.id, date: d.date, lang: input.lang })}"${d.date === chosen?.date ? ' aria-current="date"' : ''}>${part({ weekday: 'short' })}<strong>${part({ day: 'numeric' })}</strong>${part({ month: 'short' })}</a>`;
  }).join('');
  const times = chosen && chosen.slots.length > 0
    ? `<div class="times">${chosen.slots.map((s) => `<a class="card" href="${href(input.slug, '/request', { service: input.service.id, start: s.startsAt.toISOString(), lang: input.lang })}"><strong>${clockText(s.startsAt, input.lang)}</strong><div class="muted">${t.placesLeft(s.remaining)}</div></a>`).join('')}</div>`
    : `<div class="empty"><p>${t.noTimes}</p><p class="muted">${t.emptyHint}</p></div>`;
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`, businessName: input.businessName, location: input.location, step: 2,
    langSwitch: href(input.slug, '', { service: input.service.id, date: chosen?.date ?? input.selected, lang: other(input.lang) }),
    body: `<a class="back" href="${href(input.slug, '', { lang: input.lang })}">← ${t.back}</a><h1>${t.chooseTime}</h1><p class="muted intro">${t.dateHint}</p>
<div class="summary"><strong>${escapeHtml(input.service.name)}</strong>${input.service.description ? `<p class="service-description">${escapeHtml(input.service.description)}</p>` : ''}<div class="muted">${t.minutes(input.service.durationMinutes)}${input.service.priceLabel ? ` · ${escapeHtml(input.service.priceLabel)}` : ''}</div></div>
${input.notice === 'taken' ? `<p class="notice" role="alert">${t.taken}</p>` : ''}<nav class="days" aria-label="${t.steps[1]}">${strip}</nav><h2>${chosen ? dayLabel(chosen.date, input.lang) : ''}</h2><p class="muted">${t.timezone}</p>${times}`,
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
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`, widget: Boolean(input.siteKey), businessName: input.businessName, location: input.location, step: 3,
    langSwitch: href(input.slug, '/request', { service: input.service.id, start: date, lang: other(input.lang) }),
    body: `<a class="back" href="${href(input.slug, '', { service: input.service.id, date: myDate(input.startsAt), lang: input.lang })}">← ${t.back}</a>
<h1>${t.yourDetails}</h1><p class="muted intro">${t.detailsHint}</p><div class="summary"><strong>${escapeHtml(input.service.name)}</strong>${input.service.description ? `<p class="service-description">${escapeHtml(input.service.description)}</p>` : ''}<div class="muted">${dayLabel(myDate(input.startsAt), input.lang)} · ${clockText(input.startsAt, input.lang)}</div><div class="muted">${t.minutes(input.service.durationMinutes)}${input.service.priceLabel ? ` · ${escapeHtml(input.service.priceLabel)}` : ''}</div>${locationHtml(input.lang, input.location)}<div class="timezone">${t.timezone}</div></div>
${general}<form method="post" action="${href(input.slug, '/request', { lang: input.lang })}">
<input type="hidden" name="service" value="${escapeHtml(input.service.id)}"><input type="hidden" name="start" value="${escapeHtml(date)}">
<input type="hidden" name="submission_key" value="${escapeHtml(input.submissionKey)}">
<label for="name">${t.name}</label><input id="name" name="name" autocomplete="name" maxlength="80" required${invalid('name', 'name')} value="${escapeHtml(input.values.name)}">${fieldErr('name', 'name')}
<label for="phone">${t.phone}</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required${invalid('phone', 'phone')} value="${escapeHtml(input.values.phone)}">${fieldErr('phone', 'phone')}
<label for="party">${t.party}</label><select id="party" name="party"${invalid('partySize', 'party')}>${options}</select>${fieldErr('partySize', 'party')}
<label for="note">${t.note}</label><textarea id="note" name="note" maxlength="500" rows="3"${invalid('note', 'note')}>${escapeHtml(input.values.note)}</textarea>${fieldErr('note', 'note')}
${input.siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(input.siteKey)}" data-action="booking" data-language="${input.lang === 'bm' ? 'ms' : 'en'}"></div>` : ''}${err('turnstile')}
<p class="muted">${escapeHtml(t.privacy(input.businessName))} <a href="https://jentera.ai/privacy">${t.privacyLink}</a></p>
<button type="submit">${t.send} <span aria-hidden="true">→</span></button><p class="pending">${t.pending}</p></form>`,
  });
}

export function donePage(input: Base & { reference: string }): string {
  const t = T[input.lang];
  return layout({
    lang: input.lang, title: t.receivedTitle, businessName: input.businessName, location: input.location,
    body: `<div class="success-mark" aria-hidden="true">✓</div><h1>${t.receivedTitle}</h1><p>${escapeHtml(t.received(input.businessName))}</p>
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
