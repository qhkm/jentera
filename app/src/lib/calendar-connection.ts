import { GOOGLE_CALENDAR_WEB_SETUP, isNative } from '@/lib/native';
export { GOOGLE_CALENDAR_WEB_SETUP } from '@/lib/native';

/** Native bearer credentials never appear in a browser URL. Web setup uses cookies. */
export function calendarConnectionUrl(api = import.meta.env.VITE_API_URL ?? '', native = isNative()): string {
  if (native) return GOOGLE_CALENDAR_WEB_SETUP;
  const base = api.replace(/\/$/, '');
  return base ? `${base}/api/connections/google-calendar/start` : '/app?view=business&tab=connections&connector=google';
}
