import { myParts } from './time';

/* What the owner sends the customer on WhatsApp, prefilled into a wa.me link
   that the owner taps. Opening that link is not delivery: nothing here or in
   the UI may claim a message was sent. Text only; wa.me takes it URL-encoded. */

export type Lang = 'en' | 'bm';
export type MessageKind = 'confirm' | 'decline' | 'cancel';

export interface MessageInput {
  kind: MessageKind;
  lang: Lang;
  customerName: string;
  serviceName: string;
  partySize: number;
  startsAt: Date;
  reference: string;
  businessName: string;
  publicUrl: string;
}

const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BM_DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const BM_MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

/** The Malaysian calendar date, as a person reads it: en `Tue 6 Oct`, bm `Selasa 6 Okt`. */
export function dateText(instant: Date, lang: Lang): string {
  const p = myParts(instant);
  return lang === 'bm'
    ? `${BM_DAYS[p.weekday]} ${p.day} ${BM_MONTHS[p.month]}`
    : `${EN_DAYS[p.weekday]} ${p.day} ${EN_MONTHS[p.month]}`;
}

/** The Malaysian wall clock, as a person reads it: en `10:00 am`, bm `10.00 pagi`. */
export function clockText(instant: Date, lang: Lang): string {
  const p = myParts(instant);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const minutes = String(p.minute).padStart(2, '0');
  if (lang === 'bm') {
    const period = p.hour < 12 ? 'pagi' : p.hour < 14 ? 'tengah hari' : p.hour < 19 ? 'petang' : 'malam';
    return `${hour12}.${minutes} ${period}`;
  }
  return `${hour12}:${minutes} ${p.hour < 12 ? 'am' : 'pm'}`;
}

export function whenText(startsAt: Date, lang: Lang): string {
  const date = dateText(startsAt, lang);
  const clock = clockText(startsAt, lang);
  return lang === 'bm' ? `${date}, ${clock}` : `${date} at ${clock}`;
}

export function bookingMessage(m: MessageInput): string {
  const when = whenText(m.startsAt, m.lang);
  if (m.lang === 'bm') {
    if (m.kind === 'confirm') {
      return `Hai ${m.customerName}, tempahan ${m.serviceName} anda untuk ${m.partySize} orang pada ${when} telah disahkan. Rujukan ${m.reference}. Jumpa di ${m.businessName}.`;
    }
    if (m.kind === 'decline') {
      return `Hai ${m.customerName}, maaf, kami tidak dapat menerima tempahan ${m.serviceName} anda pada ${when}. Sila pilih masa lain: ${m.publicUrl}`;
    }
    return `Hai ${m.customerName}, maaf, tempahan ${m.serviceName} anda pada ${when} (rujukan ${m.reference}) telah dibatalkan. Anda boleh membuat tempahan lain di sini: ${m.publicUrl}`;
  }
  const people = m.partySize === 1 ? '1 person' : `${m.partySize} people`;
  if (m.kind === 'confirm') {
    return `Hi ${m.customerName}, your ${m.serviceName} for ${people} on ${when} is confirmed. Ref ${m.reference}. See you at ${m.businessName}.`;
  }
  if (m.kind === 'decline') {
    return `Hi ${m.customerName}, sorry, we can't take your ${m.serviceName} booking on ${when}. Please choose another time: ${m.publicUrl}`;
  }
  return `Hi ${m.customerName}, sorry, your ${m.serviceName} booking on ${when} (ref ${m.reference}) has been cancelled. You can book another time here: ${m.publicUrl}`;
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
