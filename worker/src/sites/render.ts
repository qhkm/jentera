import type { DayTimes, PublicService } from '../apps/bookings/public';
import type { ManagedBooking } from '../apps/bookings/customer';
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
    steps: ['Service', 'Date & time', 'Details', 'Confirm'], process: 'How it works',
    guidance: 'Choose your service and a time that suits you. Send your details, and the business will confirm on WhatsApp.',
    pending: 'Your booking is confirmed only after the business gets in touch.', timezone: 'Malaysia time (GMT+8)',
    location: 'Location', locationFallback: 'Confirmed on WhatsApp',
    select: 'View times', dateHint: 'Choose a date, then pick an available time below.', detailsHint: 'Where should we send your booking confirmation?',
    selectedService: 'Selected service', change: 'Change', selectTimeHint: 'Select a time to continue', selectedTime: 'Selected time', continue: 'Continue',
    emptyHint: 'Try another date to find an available time.',
    nextAvailable: 'Go to next available', noTimesShort: 'No times',
    timesAvailable: (n: number) => (n === 1 ? '1 time' : `${n} times`),
    chooseService: 'Choose a service', chooseTime: 'Choose a time', noTimes: 'No open times on this day.',
    placesLeft: (n: number) => (n === 1 ? '1 place left' : `${n} places left`), minutes: (n: number) => `${n} min`,
    yourDetails: 'Your details', appointment: 'Appointment', changeTimeAction: 'Change time', name: 'Your name', phone: 'Phone number (WhatsApp)', party: 'How many people',
    note: 'Note (optional)', send: 'Send request', back: 'Back', otherLang: 'Bahasa Melayu', poweredBy: 'Bookings by Jentera',
    privacy: (b: string) => `Your name and phone number go to ${b} to handle this booking.`, privacyLink: 'Privacy',
    receivedTitle: 'Request received', received: (b: string) => `${b} will confirm on WhatsApp.`, reference: 'Reference',
    referenceHint: 'Keep this reference to manage or change your booking.', bookAnother: 'Book another appointment',
    taken: 'That time was just taken. Please choose another.',
    manage: 'Manage booking', manageTitle: 'Find your booking', manageHint: 'Enter the reference and WhatsApp number used for the booking.',
    referenceInput: 'Booking reference', findBooking: 'Continue securely', manageError: 'Those details do not match a booking. Check them and try again.',
    status: 'Status', statuses: { pending: 'Awaiting confirmation', confirmed: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled' },
    changeTime: 'Choose a new time', cancelBooking: 'Cancel booking', cannotChange: 'This booking can no longer be changed online.',
    cancelTitle: 'Cancel this booking?', cancelHint: 'This releases the time immediately. This action cannot be undone.',
    keepBooking: 'Keep booking', confirmCancel: 'Yes, cancel booking', cancelledTitle: 'Booking cancelled', cancelledBody: 'The business has been notified.',
    rescheduleTitle: 'Choose a new time', rescheduleHint: 'Your current time stays reserved until you confirm a new one.',
    confirmNewTime: 'Request this new time', rescheduledTitle: 'New time requested',
    rescheduledBody: 'Your previous booking was cancelled. The business will confirm the new time on WhatsApp.',
    sessionExpired: 'For your privacy, this secure session has expired. Find your booking again to continue.',
    bookingUnavailable: 'Online changes are not available right now. Your existing booking has not changed.',
    cutoffPassed: 'The deadline to change this booking has passed. Contact the business directly if you need help.',
    changePolicy: (n: number) => n === 0 ? 'Changes are allowed until the booking starts.' : `Changes are allowed up to ${n < 60 ? `${n} minutes` : n % 1440 === 0 ? `${n / 1440} ${n === 1440 ? 'day' : 'days'}` : `${n / 60} hours`} before the booking.`,
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
    steps: ['Perkhidmatan', 'Tarikh & masa', 'Butiran', 'Sahkan'], process: 'Cara membuat tempahan',
    guidance: 'Pilih perkhidmatan dan masa yang sesuai. Hantar butiran anda, dan pihak perniagaan akan mengesahkan melalui WhatsApp.',
    pending: 'Tempahan anda disahkan hanya selepas pihak perniagaan menghubungi anda.', timezone: 'Waktu Malaysia (GMT+8)',
    location: 'Lokasi', locationFallback: 'Disahkan melalui WhatsApp',
    select: 'Lihat masa', dateHint: 'Pilih tarikh, kemudian pilih masa yang tersedia di bawah.', detailsHint: 'Ke mana kami boleh menghantar pengesahan tempahan anda?',
    selectedService: 'Perkhidmatan dipilih', change: 'Tukar', selectTimeHint: 'Pilih masa untuk meneruskan', selectedTime: 'Masa dipilih', continue: 'Teruskan',
    emptyHint: 'Cuba tarikh lain untuk mencari masa yang tersedia.',
    nextAvailable: 'Pergi ke masa tersedia seterusnya', noTimesShort: 'Tiada masa',
    timesAvailable: (n: number) => `${n} masa`,
    chooseService: 'Pilih perkhidmatan', chooseTime: 'Pilih masa', noTimes: 'Tiada masa kosong pada hari ini.',
    placesLeft: (n: number) => `${n} tempat lagi`, minutes: (n: number) => `${n} min`,
    yourDetails: 'Butiran anda', appointment: 'Janji temu', changeTimeAction: 'Tukar masa', name: 'Nama anda', phone: 'Nombor telefon (WhatsApp)', party: 'Bilangan orang',
    note: 'Nota (pilihan)', send: 'Hantar permintaan', back: 'Kembali', otherLang: 'English', poweredBy: 'Tempahan oleh Jentera',
    privacy: (b: string) => `Nama dan nombor telefon anda dihantar kepada ${b} untuk menguruskan tempahan ini.`, privacyLink: 'Privasi',
    receivedTitle: 'Permintaan diterima', received: (b: string) => `${b} akan mengesahkan melalui WhatsApp.`, reference: 'Rujukan',
    referenceHint: 'Simpan rujukan ini untuk mengurus atau mengubah tempahan anda.', bookAnother: 'Buat janji temu lain',
    taken: 'Masa itu baru sahaja diambil. Sila pilih masa lain.',
    manage: 'Urus tempahan', manageTitle: 'Cari tempahan anda', manageHint: 'Masukkan rujukan dan nombor WhatsApp yang digunakan untuk tempahan.',
    referenceInput: 'Rujukan tempahan', findBooking: 'Teruskan dengan selamat', manageError: 'Butiran tersebut tidak sepadan dengan tempahan. Semak dan cuba lagi.',
    status: 'Status', statuses: { pending: 'Menunggu pengesahan', confirmed: 'Disahkan', declined: 'Ditolak', cancelled: 'Dibatalkan' },
    changeTime: 'Pilih masa baharu', cancelBooking: 'Batalkan tempahan', cannotChange: 'Tempahan ini tidak lagi boleh diubah dalam talian.',
    cancelTitle: 'Batalkan tempahan ini?', cancelHint: 'Masa ini akan dikosongkan serta-merta. Tindakan ini tidak boleh dibuat asal.',
    keepBooking: 'Kekalkan tempahan', confirmCancel: 'Ya, batalkan tempahan', cancelledTitle: 'Tempahan dibatalkan', cancelledBody: 'Pihak perniagaan telah dimaklumkan.',
    rescheduleTitle: 'Pilih masa baharu', rescheduleHint: 'Masa semasa anda kekal ditempah sehingga anda mengesahkan masa baharu.',
    confirmNewTime: 'Minta masa baharu ini', rescheduledTitle: 'Masa baharu diminta',
    rescheduledBody: 'Tempahan sebelumnya telah dibatalkan. Pihak perniagaan akan mengesahkan masa baharu melalui WhatsApp.',
    sessionExpired: 'Demi privasi anda, sesi selamat ini telah tamat. Cari tempahan anda semula untuk meneruskan.',
    bookingUnavailable: 'Perubahan dalam talian tidak tersedia sekarang. Tempahan sedia ada anda tidak berubah.',
    cutoffPassed: 'Tarikh akhir untuk mengubah tempahan ini telah berlalu. Hubungi pihak perniagaan secara terus jika anda memerlukan bantuan.',
    changePolicy: (n: number) => n === 0 ? 'Perubahan dibenarkan sehingga tempahan bermula.' : `Perubahan dibenarkan sehingga ${n < 60 ? `${n} minit` : n % 1440 === 0 ? `${n / 1440} hari` : `${n / 60} jam`} sebelum tempahan.`,
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
.panel{background:transparent;border:1px solid var(--line);border-radius:var(--radius-card);padding:32px;box-shadow:none;min-width:0;min-height:390px}.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;padding:0 0 25px;margin:0 0 30px;border-bottom:1px solid var(--line);gap:10px}.steps li{display:flex;align-items:center;gap:7px;min-width:0;font-size:12px;color:var(--muted);white-space:nowrap}.steps span{display:grid;place-items:center;width:23px;height:23px;flex-shrink:0;border:1px solid var(--line);border-radius:50%;font-size:11px}.steps .done{color:var(--ink)}.steps .done span{border-color:rgb(74 235 181 / .55);color:var(--accent)}.steps [aria-current]{color:var(--accent);font-weight:650}.steps [aria-current] span{background:var(--accent);border-color:var(--accent);color:var(--bg)}
h1{font-size:25px;line-height:1.25;letter-spacing:-.7px;margin:8px 0 10px;overflow-wrap:anywhere}h2{font-size:16px;margin:26px 0 14px;letter-spacing:-.2px}p{margin:10px 0 20px}.muted{color:var(--muted);font-size:14px}.intro{margin-bottom:28px}.back{display:inline-block;font-size:13px;margin-bottom:20px;text-decoration:none}.card{display:block;padding:18px;margin:10px 0;border:1px solid var(--line);border-radius:var(--radius-item);background:var(--surface);text-decoration:none;color:inherit;overflow-wrap:anywhere}a.card:hover,a.day:hover{border-color:var(--accent);background:var(--soft)}.service-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px}.service-card strong{font-size:17px}.service-card .muted{margin-top:6px}.service-description{max-width:32rem;margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.5}.service-action{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}.price{display:inline-block;padding-left:12px;margin-left:12px;border-left:1px solid var(--line);color:var(--ink)}.summary{padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-item);margin:0 0 24px}.summary .muted{margin:4px 0 0}.summary .location{margin-top:12px}.summary-heading{display:flex;align-items:start;justify-content:space-between;gap:12px}.summary-label{display:block;margin-bottom:3px;color:var(--muted);font-size:10px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}.summary-change{font-size:12px;font-weight:600}.appointment-time{display:grid;gap:1px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}.appointment-time strong{font-size:15px}.pending{font-size:12px;color:var(--muted);margin-top:24px}.empty{padding:30px 18px;text-align:center;background:var(--soft);border:1px solid var(--line);border-radius:12px}.empty-mark{display:grid;place-items:center;width:38px;height:38px;margin:0 auto 10px;border-radius:50%;background:var(--surface);color:var(--muted);font-size:18px}.empty p{margin:4px 0}.next-available{display:inline-flex;margin-top:16px;padding:9px 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:12px;font-weight:600}
.days{display:flex;gap:8px;overflow-x:auto;padding:4px 4px 12px;scrollbar-width:thin}.day{flex:0 0 74px;padding:9px 5px;border:1px solid var(--line);border-radius:var(--radius-control);text-decoration:none;color:var(--muted);background:var(--surface);text-align:center;font-size:11px}.day strong{display:block;font-size:22px;line-height:1.3;color:var(--ink)}.day[aria-disabled="true"]{opacity:.42}.availability{display:block;margin-top:3px;font-size:9px;color:var(--accent)}.day[aria-disabled="true"] .availability{color:var(--muted)}.day[aria-current="date"]{border-color:var(--accent);background:var(--accent);color:var(--bg);opacity:1}.day[aria-current="date"] strong,.day[aria-current="date"] .availability{color:var(--bg)}.day[aria-disabled="true"][aria-current="date"]{background:var(--soft);color:var(--ink)}.day[aria-disabled="true"][aria-current="date"] strong{color:var(--ink)}.day[aria-disabled="true"][aria-current="date"] .availability{color:var(--muted)}.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:10px}.times .card{margin:0;min-height:64px;text-align:center;padding:13px 8px}.times .muted{font-size:11px;margin-top:2px}.time-card[aria-current="true"]{border-color:var(--accent);background:rgb(74 235 181 / .12);box-shadow:0 0 0 1px var(--accent) inset}.time-card[aria-current="true"] .muted{color:var(--ink)}.time-prompt{margin:14px 0 0;text-align:center;font-size:12px}.selection-action{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:22px -8px -8px;padding:14px 8px 8px;background:linear-gradient(to bottom,transparent,var(--bg) 20%)}.selection-action-copy{display:grid;min-width:0}.selection-action-copy span{color:var(--muted);font-size:11px}.selection-action-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.primary-action{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:150px;min-height:48px;padding:11px 20px;border:1px solid var(--primary);border-radius:999px;background:var(--primary);color:var(--primary-ink);font-weight:650;text-decoration:none}.primary-action:hover{background:#fff}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px}.actions a,.actions button{display:grid;place-items:center;min-height:48px;margin:0;padding:11px 16px;border-radius:999px;text-align:center;text-decoration:none;font-weight:600}.actions a{border:1px solid var(--line);color:var(--ink)}.actions .receipt-primary{border-color:var(--primary);background:var(--primary);color:var(--primary-ink)}.actions .receipt-primary:hover{background:#fff}.danger{border-color:#82483f!important;background:#3a1512!important;color:#ffd9d4!important}.status{display:inline-flex;padding:5px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-size:12px;font-weight:650}.manage-meta{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}.manage-meta span{display:block}.manage-meta .muted{font-size:11px}.secondary{display:inline-grid;place-items:center;min-height:48px;padding:11px 20px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none}.center{text-align:center}
label{display:block;font-size:13px;font-weight:600;margin:18px 0 7px}input,select,textarea{width:100%;min-height:50px;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--surface);color:var(--ink)}input::placeholder{color:#777}textarea{resize:vertical}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.form-field{min-width:0}.form-submit{margin-top:20px;padding-top:4px}.form-submit button{margin-top:0}.reference-card{padding:20px}.reference-card strong{display:block;margin:3px 0 8px;font-size:24px;letter-spacing:.08em}.reference-card .muted{margin:0}button{width:100%;margin-top:12px;font:inherit;font-weight:600;min-height:48px;padding:12px 24px;border:1px solid var(--primary);border-radius:999px;background:var(--primary);color:var(--primary-ink);cursor:pointer}button:hover{background:#fff}form>.muted{font-size:12px;margin-top:20px}.error{color:#ffb4ab;font-size:13px;margin:5px 0 0}.notice{padding:12px 16px;border-radius:10px;background:#3a1512;color:#f6c8c3}.success-mark{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:var(--soft);color:var(--accent);font-size:26px;margin-bottom:24px}footer{margin:28px 0 32px;font-size:12px;color:var(--muted);text-align:center}
@media(max-width:760px){.topbar{padding:18px 20px}main{margin:0 auto;padding:0 20px}.booking-layout{grid-template-columns:1fr;gap:20px}.business{padding:12px 0 0;display:grid;grid-template-columns:48px 1fr;column-gap:14px}.avatar{width:48px;height:48px;border-radius:13px;font-size:19px;grid-row:1/4;margin:0}.business .eyebrow{margin:0}.business-name{font-size:22px;margin:4px 0 0}.business-copy,.explanation,.business>.timezone{display:none}.panel{padding:24px;min-height:340px;border-radius:16px}.steps{gap:4px;margin-bottom:24px}.steps li{align-items:center;flex-direction:column;gap:4px;overflow:hidden;font-size:9px;text-align:center;text-overflow:ellipsis}.steps span{width:25px;height:25px}h1{font-size:23px}.service-card{padding:18px}.service-action{font-size:11px}.service-summary{position:sticky;z-index:2;top:8px;margin-bottom:20px;padding:13px 14px;background:rgb(24 24 24 / .96);box-shadow:0 8px 24px rgb(0 0 0 / .28);backdrop-filter:blur(12px)}.service-summary .service-description{display:none}.details-summary{padding:14px}.details-summary .location{margin-top:10px}.days{margin-inline:-4px}.times{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.times .card{min-height:68px;display:grid;place-content:center}.selection-action{position:sticky;z-index:3;bottom:0;align-items:center;margin:22px -12px -12px;padding:22px 12px 12px}.selection-action .primary-action{min-width:132px}.form-grid{grid-template-columns:1fr}.form-submit{position:sticky;z-index:3;bottom:0;margin:20px -12px -12px;padding:22px 12px 12px;background:linear-gradient(to bottom,transparent,var(--bg) 20%)}.actions{grid-template-columns:1fr}}
@media(max-width:760px){.brand>.muted{display:none}.lang{white-space:nowrap}.summary .timezone{margin-top:8px}}
@media(max-width:380px){main{padding:0 12px}.panel{padding:20px 16px}.steps{gap:2px}.steps li{font-size:8px}.service-card{gap:10px}.service-action{white-space:normal}.selection-action-copy{max-width:42%}}
`;

interface Base { slug: string; lang: Lang; businessName: string; location?: string | null }

function href(slug: string, path: string, params: Record<string, string>): string {
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
  const steps = input.step ? `<ol class="steps" aria-label="${escapeHtml(t.process)}">${t.steps.map((label, i) => {
    const number = i + 1;
    const state = number < input.step! ? ' class="done"' : number === input.step ? ' aria-current="step"' : '';
    return `<li${state}><span>${number}</span>${label}</li>`;
  }).join('')}</ol>` : '';
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

export function timesPage(input: Base & { service: PublicService; days: DayTimes[]; selected: string; selectedStart?: Date | null; nextAvailable?: string | null; notice: 'taken' | null }): string {
  const t = T[input.lang];
  const chosen = input.days.find((d) => d.date === input.selected) ?? input.days[0];
  const selectedSlot = input.selectedStart && chosen?.slots.find((slot) => slot.startsAt.getTime() === input.selectedStart!.getTime());
  const strip = input.days.map((d) => {
    const date = myInstant(d.date);
    const locale = input.lang === 'bm' ? 'ms-MY' : 'en-MY';
    const part = (options: Intl.DateTimeFormatOptions) => escapeHtml(new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Kuala_Lumpur' }).format(date));
    const available = d.slots.length > 0;
    const current = d.date === chosen?.date ? ' aria-current="date"' : '';
    const contents = `${part({ weekday: 'short' })}<strong>${part({ day: 'numeric' })}</strong>${part({ month: 'short' })}<span class="availability">${available ? t.timesAvailable(d.slots.length) : t.noTimesShort}</span>`;
    const label = escapeHtml(`${dayLabel(d.date, input.lang)} · ${available ? t.timesAvailable(d.slots.length) : t.noTimes}`);
    return available
      ? `<a class="day" aria-label="${label}" href="${href(input.slug, '', { service: input.service.id, date: d.date, lang: input.lang })}"${current}>${contents}</a>`
      : `<span class="day" aria-label="${label}" aria-disabled="true"${current}>${contents}</span>`;
  }).join('');
  const times = chosen && chosen.slots.length > 0
    ? `<div class="times">${chosen.slots.map((slot) => {
      const active = selectedSlot?.startsAt.getTime() === slot.startsAt.getTime();
      return `<a class="card time-card"${active ? ' aria-current="true"' : ''} href="${href(input.slug, '', { service: input.service.id, date: chosen.date, start: slot.startsAt.toISOString(), lang: input.lang })}"><strong>${clockText(slot.startsAt, input.lang)}</strong><div class="muted">${t.placesLeft(slot.remaining)}</div></a>`;
    }).join('')}</div>${selectedSlot ? '' : `<p class="muted time-prompt">${t.selectTimeHint}</p>`}`
    : `<div class="empty"><span class="empty-mark" aria-hidden="true">○</span><p>${t.noTimes}</p><p class="muted">${t.emptyHint}</p>${input.nextAvailable ? `<a class="next-available" href="${href(input.slug, '', { service: input.service.id, date: input.nextAvailable, lang: input.lang })}">${t.nextAvailable} →</a>` : ''}</div>`;
  const selection = selectedSlot ? `<div class="selection-action"><span class="selection-action-copy"><span>${t.selectedTime}</span><strong>${clockText(selectedSlot.startsAt, input.lang)}</strong></span><a class="primary-action" href="${href(input.slug, '/request', { service: input.service.id, start: selectedSlot.startsAt.toISOString(), lang: input.lang })}">${t.continue} <span aria-hidden="true">→</span></a></div>` : '';
  return layout({
    lang: input.lang, title: `${input.service.name} · ${input.businessName}`, businessName: input.businessName, location: input.location, step: 2,
    langSwitch: href(input.slug, '', { service: input.service.id, date: chosen?.date ?? input.selected, ...(selectedSlot ? { start: selectedSlot.startsAt.toISOString() } : {}), lang: other(input.lang) }),
    body: `<a class="back" href="${href(input.slug, '', { lang: input.lang })}">← ${t.back}</a><h1>${t.chooseTime}</h1><p class="muted intro">${t.dateHint}</p>
<div class="summary service-summary"><div class="summary-heading"><div><span class="summary-label">${t.selectedService}</span><strong>${escapeHtml(input.service.name)}</strong></div><a class="summary-change" href="${href(input.slug, '', { lang: input.lang })}">${t.change}</a></div>${input.service.description ? `<p class="service-description">${escapeHtml(input.service.description)}</p>` : ''}<div class="muted">${t.minutes(input.service.durationMinutes)}${input.service.priceLabel ? ` · ${escapeHtml(input.service.priceLabel)}` : ''}</div></div>
    ${input.notice === 'taken' ? `<p class="notice" role="alert">${t.taken}</p>` : ''}<nav class="days" aria-label="${t.steps[1]}">${strip}</nav><h2>${chosen ? dayLabel(chosen.date, input.lang) : ''}</h2><p class="muted">${t.timezone}</p>${times}${selection}`,
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
    body: `<a class="back" href="${href(input.slug, '', { service: input.service.id, date: myDate(input.startsAt), start: input.startsAt.toISOString(), lang: input.lang })}">← ${t.back}</a>
<h1>${t.yourDetails}</h1><p class="muted intro">${t.detailsHint}</p><div class="summary details-summary"><div class="summary-heading"><div><span class="summary-label">${t.appointment}</span><strong>${escapeHtml(input.service.name)}</strong></div><a class="summary-change" href="${href(input.slug, '', { service: input.service.id, date: myDate(input.startsAt), start: input.startsAt.toISOString(), lang: input.lang })}">${t.changeTimeAction}</a></div><div class="appointment-time"><strong>${dayLabel(myDate(input.startsAt), input.lang)} · ${clockText(input.startsAt, input.lang)}</strong><span class="muted">${t.minutes(input.service.durationMinutes)}${input.service.priceLabel ? ` · ${escapeHtml(input.service.priceLabel)}` : ''} · ${t.timezone}</span></div>${locationHtml(input.lang, input.location)}</div>
${general}<form class="booking-form" method="post" action="${href(input.slug, '/request', { lang: input.lang })}">
<input type="hidden" name="service" value="${escapeHtml(input.service.id)}"><input type="hidden" name="start" value="${escapeHtml(date)}">
<input type="hidden" name="submission_key" value="${escapeHtml(input.submissionKey)}">
<div class="form-grid"><div class="form-field"><label for="name">${t.name}</label><input id="name" name="name" autocomplete="name" maxlength="80" required${invalid('name', 'name')} value="${escapeHtml(input.values.name)}">${fieldErr('name', 'name')}</div>
<div class="form-field"><label for="phone">${t.phone}</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="012 345 6789" required${invalid('phone', 'phone')} value="${escapeHtml(input.values.phone)}">${fieldErr('phone', 'phone')}</div></div>
<label for="party">${t.party}</label><select id="party" name="party"${invalid('partySize', 'party')}>${options}</select>${fieldErr('partySize', 'party')}
<label for="note">${t.note}</label><textarea id="note" name="note" maxlength="500" rows="3"${invalid('note', 'note')}>${escapeHtml(input.values.note)}</textarea>${fieldErr('note', 'note')}
${input.siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(input.siteKey)}" data-action="booking" data-language="${input.lang === 'bm' ? 'ms' : 'en'}"></div>` : ''}${err('turnstile')}
<p class="muted">${escapeHtml(t.privacy(input.businessName))} <a href="https://jentera.ai/privacy">${t.privacyLink}</a></p>
<div class="form-submit"><button type="submit">${t.send} <span aria-hidden="true">→</span></button></div><p class="pending">${t.pending}</p></form>`,
  });
}

export function donePage(input: Base & { reference: string }): string {
  const t = T[input.lang];
  return layout({
    lang: input.lang, title: t.receivedTitle, businessName: input.businessName, location: input.location, step: 4,
    body: `<div class="success-mark" aria-hidden="true">✓</div><h1>${t.receivedTitle}</h1><p>${escapeHtml(t.received(input.businessName))}</p>
<div class="card reference-card"><span class="summary-label">${t.reference}</span><strong>${escapeHtml(input.reference)}</strong><p class="muted">${t.referenceHint}</p></div>
<div class="actions"><a class="receipt-primary" href="${href(input.slug, '/manage', { ref: input.reference, lang: input.lang })}">${t.manage}</a><a href="${href(input.slug, '', { lang: input.lang })}">${t.bookAnother}</a></div>`,
  });
}

export function manageLoginPage(input: Base & { reference: string; error: boolean; expired?: boolean }): string {
  const t = T[input.lang];
  return layout({
    lang: input.lang, title: t.manageTitle, businessName: input.businessName, location: input.location,
    langSwitch: href(input.slug, '/manage', { ref: input.reference, lang: other(input.lang) }),
    body: `<h1>${t.manageTitle}</h1><p class="muted intro">${input.expired ? t.sessionExpired : t.manageHint}</p>
${input.error ? `<p class="notice" role="alert">${t.manageError}</p>` : ''}
<form method="post" action="${href(input.slug, '/manage', { lang: input.lang })}">
<label for="reference">${t.referenceInput}</label><input id="reference" name="reference" required maxlength="6" autocomplete="off" value="${escapeHtml(input.reference)}">
<label for="phone">${t.phone}</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required>
<button type="submit">${t.findBooking} <span aria-hidden="true">→</span></button></form>`,
  });
}

function bookingSummary(input: Base & { booking: ManagedBooking }): string {
  const t = T[input.lang];
  return `<div class="summary"><span class="status">${t.statuses[input.booking.status]}</span><h2>${escapeHtml(input.booking.serviceName)}</h2>
<div class="muted">${dateText(input.booking.startsAt, input.lang)} · ${clockText(input.booking.startsAt, input.lang)}</div>
<div class="manage-meta"><span><span class="muted">${t.reference}</span><strong>${escapeHtml(input.booking.reference)}</strong></span><span><span class="muted">${t.party}</span><strong>${input.booking.partySize}</strong></span></div>
${locationHtml(input.lang, input.location)}</div>`;
}

export function managePage(input: Base & { token: string; booking: ManagedBooking; confirmCancel?: boolean; notice?: 'cancelled' | 'rescheduled' }): string {
  const t = T[input.lang];
  const path = `/manage/${input.token}`;
  if (input.notice) {
    const cancelled = input.notice === 'cancelled';
    return layout({ lang: input.lang, title: cancelled ? t.cancelledTitle : t.rescheduledTitle, businessName: input.businessName, location: input.location,
      body: `<div class="success-mark" aria-hidden="true">✓</div><h1>${cancelled ? t.cancelledTitle : t.rescheduledTitle}</h1><p>${cancelled ? t.cancelledBody : t.rescheduledBody}</p>${bookingSummary(input)}<a class="secondary" href="${href(input.slug, path, { lang: input.lang })}">${t.manage}</a>` });
  }
  const changeable = input.booking.canChange;
  if (input.confirmCancel && changeable) {
    return layout({ lang: input.lang, title: t.cancelTitle, businessName: input.businessName, location: input.location,
      body: `<h1>${t.cancelTitle}</h1><p class="muted intro">${t.cancelHint}</p>${bookingSummary(input)}<div class="actions"><a href="${href(input.slug, path, { lang: input.lang })}">${t.keepBooking}</a><form method="post" action="${href(input.slug, `${path}/cancel`, { lang: input.lang })}"><button class="danger" type="submit">${t.confirmCancel}</button></form></div>` });
  }
  return layout({
    lang: input.lang, title: t.manage, businessName: input.businessName, location: input.location,
    langSwitch: href(input.slug, path, { lang: other(input.lang) }),
    body: `<h1>${t.manage}</h1>${bookingSummary(input)}<p class="muted">${t.changePolicy(input.booking.changeCutoffMinutes)}</p>${changeable
      ? `<div class="actions"><a href="${href(input.slug, `${path}/reschedule`, { lang: input.lang })}">${t.changeTime}</a><a class="danger" href="${href(input.slug, path, { confirm: 'cancel', lang: input.lang })}">${t.cancelBooking}</a></div>`
      : `<p class="muted">${t.cannotChange}</p>`}`,
  });
}

export function reschedulePage(input: Base & { token: string; booking: ManagedBooking; days: DayTimes[]; selected: string; selectedStart?: Date | null; notice?: boolean }): string {
  const t = T[input.lang];
  const path = `/manage/${input.token}/reschedule`;
  const chosen = input.days.find((day) => day.date === input.selected) ?? input.days[0];
  const strip = input.days.map((day) => {
    const instant = myInstant(day.date);
    const locale = input.lang === 'bm' ? 'ms-MY' : 'en-MY';
    const part = (options: Intl.DateTimeFormatOptions) => escapeHtml(new Intl.DateTimeFormat(locale, { ...options, timeZone: 'Asia/Kuala_Lumpur' }).format(instant));
    const available = day.slots.length > 0;
    const contents = `${part({ weekday: 'short' })}<strong>${part({ day: 'numeric' })}</strong>${part({ month: 'short' })}<span class="availability">${available ? t.timesAvailable(day.slots.length) : t.noTimesShort}</span>`;
    return available ? `<a class="day" href="${href(input.slug, path, { date: day.date, lang: input.lang })}"${day.date === chosen?.date ? ' aria-current="date"' : ''}>${contents}</a>`
      : `<span class="day" aria-disabled="true"${day.date === chosen?.date ? ' aria-current="date"' : ''}>${contents}</span>`;
  }).join('');
  const selectedSlot = input.selectedStart && chosen?.slots.find((slot) => slot.startsAt.getTime() === input.selectedStart!.getTime());
  const content = selectedSlot
    ? `<div class="summary"><strong>${dateText(selectedSlot.startsAt, input.lang)} · ${clockText(selectedSlot.startsAt, input.lang)}</strong><p class="muted">${t.rescheduleHint}</p></div><form method="post" action="${href(input.slug, path, { lang: input.lang })}"><input type="hidden" name="start" value="${escapeHtml(selectedSlot.startsAt.toISOString())}"><button type="submit">${t.confirmNewTime}</button></form>`
    : chosen && chosen.slots.length > 0
      ? `<div class="times">${chosen.slots.map((slot) => `<a class="card" href="${href(input.slug, path, { date: chosen.date, start: slot.startsAt.toISOString(), lang: input.lang })}"><strong>${clockText(slot.startsAt, input.lang)}</strong><div class="muted">${t.placesLeft(slot.remaining)}</div></a>`).join('')}</div>`
      : `<div class="empty"><p>${t.noTimes}</p><p class="muted">${t.emptyHint}</p></div>`;
  return layout({ lang: input.lang, title: t.rescheduleTitle, businessName: input.businessName, location: input.location,
    langSwitch: href(input.slug, path, { date: input.selected, lang: other(input.lang) }),
    body: `<a class="back" href="${href(input.slug, `/manage/${input.token}`, { lang: input.lang })}">← ${t.back}</a><h1>${t.rescheduleTitle}</h1><p class="muted intro">${t.rescheduleHint}</p>${input.notice ? `<p class="notice" role="alert">${t.taken}</p>` : ''}<nav class="days">${strip}</nav><h2>${chosen ? dayLabel(chosen.date, input.lang) : ''}</h2>${content}` });
}

export function customerMessagePage(input: Base & { kind: 'expired' | 'cutoff' | 'unavailable' }): string {
  const t = T[input.lang];
  return layout({ lang: input.lang, title: t.manage, businessName: input.businessName, location: input.location,
    body: `<h1>${t.manage}</h1><p>${input.kind === 'expired' ? t.sessionExpired : input.kind === 'cutoff' ? t.cutoffPassed : t.bookingUnavailable}</p><a class="secondary" href="${href(input.slug, '/manage', { lang: input.lang })}">${t.findBooking}</a>` });
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
