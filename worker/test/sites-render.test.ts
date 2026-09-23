import { describe, expect, it } from 'vitest';
import { donePage, escapeHtml, formPage, messagePage, page, redirect, servicesPage, timesPage } from '../src/sites/render';

const base = { slug: 'seido', lang: 'en' as const, businessName: 'SEIDO <script>alert(1)</script>' };
const service = { id: '11111111-1111-4111-8111-111111111112', name: 'Cupping <b>class</b>', durationMinutes: 60, capacity: 2, priceLabel: 'RM45 & up', hours: [] };

describe('escaping and responses', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('sends every security header and never a cookie', () => {
    const res = page('<p>hi</p>');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const moved = redirect('/b/seido', 301);
    expect(moved.status).toBe(301);
    expect(moved.headers.get('Location')).toBe('/b/seido');
    expect(moved.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('pages', () => {
  it('renders business and service names as text, never markup', () => {
    const html = servicesPage({ ...base, services: [service] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('SEIDO &lt;script&gt;');
    expect(html).toContain('Cupping &lt;b&gt;class&lt;/b&gt;');
    expect(html).toContain('RM45 &amp; up');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`href="/b/seido?service=${service.id}&amp;lang=en"`);
  });

  it('switches language and marks Malay pages as ms', () => {
    const html = servicesPage({ ...base, lang: 'bm', services: [service] });
    expect(html).toContain('<html lang="ms">');
    expect(html).toContain('Pilih perkhidmatan');
    expect(html).toContain('href="/b/seido?lang=en"');
  });

  it('lists times with places left, and says when a day has none', () => {
    const html = timesPage({ ...base, service, selected: '2026-10-06', notice: 'taken', days: [
      { date: '2026-10-06', slots: [{ startsAt: new Date('2026-10-06T02:00:00Z'), endsAt: new Date('2026-10-06T03:00:00Z'), remaining: 1 }] },
      { date: '2026-10-07', slots: [] },
    ] });
    expect(html).toContain('10:00 am');
    expect(html).toContain('1 place left');
    expect(html).toContain('That time was just taken');
    expect(html).toContain('/b/seido/request?service=');
    const empty = timesPage({ ...base, service, selected: '2026-10-07', notice: null, days: [{ date: '2026-10-07', slots: [] }] });
    expect(empty).toContain('No open times on this day.');
  });

  it('shows the privacy notice in both languages, the widget only with a site key, and the submission key', () => {
    const input = { ...base, service, startsAt: new Date('2026-10-06T02:00:00Z'), remaining: 3, submissionKey: 'key-1',
      values: { name: '<Aisyah>', phone: '', note: '', party: '1' }, errors: [] as never[], siteKey: 'site-key' };
    const en = formPage(input);
    expect(en).toContain('Your name and phone number go to SEIDO &lt;script&gt;');
    expect(en).toContain('href="https://jentera.ai/privacy"');
    expect(en).toContain('class="cf-turnstile" data-sitekey="site-key" data-action="booking"');
    expect(en).toContain('name="submission_key" value="key-1"');
    expect(en).toContain('value="&lt;Aisyah&gt;"');
    expect(en).toContain('<option value="3">3</option>');
    expect(en).not.toContain('<option value="4">');
    const bm = formPage({ ...input, lang: 'bm', siteKey: undefined });
    expect(bm).toContain('Nama dan nombor telefon anda dihantar kepada SEIDO &lt;script&gt;');
    expect(bm).not.toContain('cf-turnstile');
  });

  it('shows field errors next to the fields', () => {
    const html = formPage({ ...base, service, startsAt: new Date('2026-10-06T02:00:00Z'), remaining: 2, submissionKey: 'k',
      values: { name: '', phone: '123', note: '', party: '1' }, errors: ['name', 'phone', 'turnstile'], siteKey: undefined });
    expect(html).toContain('Please enter your name.');
    expect(html).toContain('Please enter a Malaysian phone number.');
    expect(html).toContain('Please complete the check before sending.');
  });

  it('gives a generic receipt and plain messages', () => {
    const done = donePage({ ...base, reference: 'K7Q2MP' });
    expect(done).toContain('K7Q2MP');
    expect(done).toContain('will confirm on WhatsApp.');
    expect(messagePage({ ...base, kind: 'unavailable' })).toContain('Not taking bookings right now');
    expect(messagePage({ slug: null, lang: 'en', businessName: null, kind: 'not_found' })).toContain('Page not found');
    const unreadable = messagePage({ slug: null, lang: 'en', businessName: null, kind: 'bad_request' });
    expect(unreadable).toContain('Please start again');
    expect(unreadable).toContain('This form could not be read. Go back and try again.');
    const unreadableBm = messagePage({ slug: null, lang: 'bm', businessName: null, kind: 'bad_request' });
    expect(unreadableBm).toContain('Sila mulakan semula');
    expect(unreadableBm).toContain('Borang ini tidak dapat dibaca. Kembali dan cuba lagi.');
    expect(messagePage({ slug: null, lang: 'en', businessName: null, kind: 'busy' })).toContain('Please try again shortly');
  });
});
