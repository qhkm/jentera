import { describe, expect, it } from 'vitest';
import { calendarConnectionUrl, GOOGLE_CALENDAR_WEB_SETUP } from '@/lib/calendar-connection';

describe('Calendar connection destination', () => {
  it('uses the fixed cookie-authenticated OAuth start route on web', () => {
    expect(calendarConnectionUrl('https://api.jentera.ai/', false))
      .toBe('https://api.jentera.ai/api/connections/google-calendar/start');
  });
  it('opens public web setup instead of the API inside a native WebView', () => {
    expect(calendarConnectionUrl('https://api.jentera.ai', true)).toBe(GOOGLE_CALENDAR_WEB_SETUP);
    expect(GOOGLE_CALENDAR_WEB_SETUP).not.toMatch(/token|code|state|callback/);
  });
  it('uses Connections instead of an unavailable API route in local-only mode', () => {
    expect(calendarConnectionUrl('', false)).toBe('/app?view=business&tab=connections&connector=google');
  });
});
