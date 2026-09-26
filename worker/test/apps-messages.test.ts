import { describe, expect, it } from 'vitest';
import { bookingMessage, bookingReminderMessage, whatsappUrl, whenText, type MessageInput } from '../src/apps/bookings/messages';

const base: MessageInput = {
  kind: 'confirm', lang: 'en', customerName: 'Aisyah', serviceName: 'cupping class', partySize: 2,
  startsAt: new Date('2026-09-26T07:00:00Z'), // Sat 26 Sep, 3:00 pm Malaysia
  reference: 'K7Q2MP', businessName: 'SEIDO Coffee', publicUrl: 'https://sites.test/b/seido',
};

describe('booking messages', () => {
  it('formats the Malaysian time in each language', () => {
    expect(whenText(base.startsAt, 'en')).toBe('Sat 26 Sep at 3:00 pm');
    expect(whenText(base.startsAt, 'bm')).toBe('Sabtu 26 Sep, 3.00 petang');
    expect(whenText(new Date('2026-09-26T02:30:00Z'), 'bm')).toBe('Sabtu 26 Sep, 10.30 pagi');
    expect(whenText(new Date('2026-09-26T04:00:00Z'), 'en')).toBe('Sat 26 Sep at 12:00 pm');
  });
  it('writes the confirmation, decline and cancellation in English', () => {
    expect(bookingMessage(base)).toBe(
      'Hi Aisyah, your cupping class for 2 people on Sat 26 Sep at 3:00 pm is confirmed. Ref K7Q2MP. See you at SEIDO Coffee.');
    expect(bookingMessage({ ...base, kind: 'decline' })).toBe(
      "Hi Aisyah, sorry, we can't take your cupping class booking on Sat 26 Sep at 3:00 pm. Please choose another time: https://sites.test/b/seido");
    expect(bookingMessage({ ...base, kind: 'cancel', partySize: 1 })).toContain('(ref K7Q2MP) has been cancelled');
  });
  it('writes them in Malay', () => {
    expect(bookingMessage({ ...base, lang: 'bm' })).toBe(
      'Hai Aisyah, tempahan cupping class anda untuk 2 orang pada Sabtu 26 Sep, 3.00 petang telah disahkan. Rujukan K7Q2MP. Jumpa di SEIDO Coffee.');
    expect(bookingMessage({ ...base, lang: 'bm', kind: 'cancel' })).toContain('telah dibatalkan');
  });
  it('prepares an honest reminder with the customer management link', () => {
    expect(bookingReminderMessage({ ...base, manageUrl: 'https://sites.test/b/seido/manage?ref=K7Q2MP' })).toBe(
      'Hi Aisyah, a reminder for your cupping class booking on Sat 26 Sep at 3:00 pm. Ref K7Q2MP. See you at SEIDO Coffee. Change or cancel your booking: https://sites.test/b/seido/manage?ref=K7Q2MP');
    expect(bookingReminderMessage({ ...base, lang: 'bm', manageUrl: 'https://sites.test/b/seido/manage?ref=K7Q2MP' }))
      .toContain('Ubah atau batalkan tempahan: https://sites.test/b/seido/manage?ref=K7Q2MP');
  });
  it('URL-encodes the text for wa.me, never HTML-escapes it', () => {
    const url = whatsappUrl('60123456789', 'Hi <Aisyah> & co?');
    expect(url).toBe('https://wa.me/60123456789?text=Hi%20%3CAisyah%3E%20%26%20co%3F');
    expect(decodeURIComponent(url.split('text=')[1])).toBe('Hi <Aisyah> & co?');
  });
});
