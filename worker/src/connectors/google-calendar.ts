/* ============================================================
   Google Calendar, behind the Jentera control plane.

   The OAuth refresh token stays encrypted in the Worker. A tenant runtime
   receives only narrow list/propose operations and can never call Google or
   turn a proposed event into a real one by itself.
   ============================================================ */

import type { Env } from '../env';
import { redirectUri } from '../oauth';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_CONNECTOR = 'google';
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events.owned',
] as const;

interface GoogleCalendarSecret {
  v: 1;
  refreshToken: string;
  scopes: string[];
}

export interface GoogleCalendarProfile {
  subject: string;
  email: string;
  name: string | null;
  refreshToken: string;
  scopes: string[];
}

export interface CalendarEventInput {
  requestId: string;
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  location?: string;
  description?: string;
}

export interface CalendarEventView {
  id: string;
  summary: string;
  status: string;
  start: string;
  end: string;
  location: string | null;
  htmlLink: string | null;
}

export interface CalendarBusyInterval {
  eventKey: string;
  startsAt: Date;
  endsAt: Date;
}

const ACCESS_EXPIRED = 'Google Calendar access expired. Reconnect it to continue.';
const UNREACHABLE = 'Google Calendar could not be reached.';
const BUSY = 'Google Calendar is busy. Jentera will try again.';

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly auth = false) {
    super(message);
  }
}

function client(env: Env): { id: string; secret: string } | null {
  const id = env.GOOGLE_WORKSPACE_CLIENT_ID?.trim() || env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_WORKSPACE_CLIENT_SECRET?.trim() || env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function googleCalendarConfigured(env: Env): boolean {
  return client(env) !== null;
}

export function googleCalendarAuthorizeUrl(
  env: Env,
  opts: { state: string; codeChallenge: string },
): string {
  const oauth = client(env);
  if (!oauth) throw new GoogleCalendarError('Google Calendar is not configured.');
  const params = new URLSearchParams({
    client_id: oauth.id,
    redirect_uri: redirectUri(env),
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    include_granted_scopes: 'true',
    // Google returns a refresh token reliably only when consent is explicit.
    prompt: 'consent select_account',
  });
  return `${AUTHORIZE}?${params}`;
}

function decodePayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCalendarCode(
  env: Env,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleCalendarProfile | null> {
  const oauth = client(env);
  if (!oauth) return null;
  const response = await fetcher(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauth.id,
      client_secret: oauth.secret,
      redirect_uri: redirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    console.error(`[google-calendar] OAuth exchange failed (${response.status})`);
    return null;
  }
  const body = await response.json().catch(() => null) as {
    id_token?: string;
    refresh_token?: string;
    scope?: string;
  } | null;
  if (!body?.id_token || !body.refresh_token) return null;
  const claims = decodePayload(body.id_token);
  if (!claims || claims.aud !== oauth.id ||
      !(claims.email_verified === true || claims.email_verified === 'true')) return null;
  const subject = typeof claims.sub === 'string' ? claims.sub : '';
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!subject || !email) return null;
  const scopes = (body.scope ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(GOOGLE_CALENDAR_SCOPES[3])) return null;
  return {
    subject,
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
    refreshToken: body.refresh_token,
    scopes,
  };
}

export function calendarSecret(profile: GoogleCalendarProfile): string {
  return JSON.stringify({
    v: 1,
    refreshToken: profile.refreshToken,
    scopes: profile.scopes,
  } satisfies GoogleCalendarSecret);
}

function openSecret(raw: string): GoogleCalendarSecret {
  try {
    const value = JSON.parse(raw) as Partial<GoogleCalendarSecret>;
    if (value.v === 1 && typeof value.refreshToken === 'string' && value.refreshToken &&
        Array.isArray(value.scopes)) {
      return { v: 1, refreshToken: value.refreshToken, scopes: value.scopes.filter((s): s is string => typeof s === 'string') };
    }
  } catch {
    // The caller receives one actionable error without secret material.
  }
  throw new GoogleCalendarError('Reconnect Google Calendar to continue.', true);
}

/** The provider id for one Jentera request. Deterministic, so a retried
    create and a later delete address the same event even when an earlier
    response was lost. Google accepts lowercase a-v and 0-9; this is
    "jentera" and hex. */
export function calendarEventId(requestId: string): string {
  const encoded = [...new TextEncoder().encode(requestId)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `jentera${encoded}`;
}

async function accessToken(
  env: Env,
  rawSecret: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const oauth = client(env);
  if (!oauth) throw new GoogleCalendarError('Google Calendar is not configured.');
  const stored = openSecret(rawSecret);
  const response = await fetcher(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.id,
      client_secret: oauth.secret,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    /* Only Google refusing the grant itself (400 invalid_grant, 401 invalid_client) means the
       owner has to reconnect. A 429 or a 5xx is Google busy or down: retried like any other
       outage, never read as a broken connection — that would fail every booking at once. */
    if (response.status === 400 || response.status === 401) {
      throw new GoogleCalendarError(ACCESS_EXPIRED, true);
    }
    throw new GoogleCalendarError(UNREACHABLE);
  }
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!body?.access_token) throw new GoogleCalendarError(UNREACHABLE);
  return body.access_token;
}

/** Google's reasons for a 403 that is throttling, not a refusal of the grant. */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);

/** Google's machine-readable reason from an error body: error.errors[0].reason, else error.status. */
function errorReason(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: { status?: unknown; errors?: Array<{ reason?: unknown }> } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;   // Not JSON: a plain refusal.
  }
}

/** A failed Calendar API response as an error the caller can act on. The body is read only for
    Google's machine-readable reason and never copied into the message. */
async function providerError(response: Response): Promise<GoogleCalendarError> {
  if (response.status === 401) return new GoogleCalendarError(ACCESS_EXPIRED, true);
  if (response.status === 403) {
    let text: string;
    try {
      text = await response.text();
    } catch {
      // The body never arrived (the budget ran out, the connection dropped): we cannot tell a
      // throttle from a refusal, so retry rather than expire a connection that may be fine.
      return new GoogleCalendarError(UNREACHABLE);
    }
    const reason = errorReason(text);
    return reason && RATE_LIMIT_REASONS.has(reason)
      ? new GoogleCalendarError(BUSY)
      : new GoogleCalendarError(ACCESS_EXPIRED, true);
  }
  return new GoogleCalendarError(`Google Calendar could not complete that request (${response.status}).`);
}

function view(raw: Record<string, unknown>): CalendarEventView {
  const start = raw.start as Record<string, unknown> | undefined;
  const end = raw.end as Record<string, unknown> | undefined;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    summary: typeof raw.summary === 'string' ? raw.summary : '(untitled event)',
    status: typeof raw.status === 'string' ? raw.status : 'confirmed',
    start: typeof start?.dateTime === 'string' ? start.dateTime : typeof start?.date === 'string' ? start.date : '',
    end: typeof end?.dateTime === 'string' ? end.dateTime : typeof end?.date === 'string' ? end.date : '',
    location: typeof raw.location === 'string' ? raw.location : null,
    htmlLink: typeof raw.htmlLink === 'string' ? raw.htmlLink : null,
  };
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;

export function normaliseCalendarEvent(raw: unknown): CalendarEventInput {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const start = typeof value.start === 'string' ? value.start.trim() : '';
  const end = typeof value.end === 'string' ? value.end.trim() : '';
  const timeZone = typeof value.timeZone === 'string' && value.timeZone.trim()
    ? value.timeZone.trim()
    : 'Asia/Kuala_Lumpur';
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new GoogleCalendarError('requestId must be 8 to 100 letters, numbers, underscores, or dashes.');
  }
  if (!summary || summary.length > 200) throw new GoogleCalendarError('Event title must be 1 to 200 characters.');
  if (!RFC3339.test(start) || !RFC3339.test(end)) {
    throw new GoogleCalendarError('Event start and end must include a date, time, and UTC offset.');
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new GoogleCalendarError('Event end must be after its start.');
  }
  if (endMs - startMs > 7 * 24 * 60 * 60 * 1000) {
    throw new GoogleCalendarError('One event cannot be longer than seven days.');
  }
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone) || timeZone.length > 100) {
    throw new GoogleCalendarError('Event time zone is invalid.');
  }
  const location = typeof value.location === 'string' ? value.location.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (location.length > 500) throw new GoogleCalendarError('Event location is too long.');
  if (description.length > 5000) throw new GoogleCalendarError('Event description is too long.');
  return {
    requestId,
    summary,
    start,
    end,
    timeZone,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
  };
}

export function normaliseCalendarRange(url: URL): { timeMin: string; timeMax: string } {
  const timeMin = url.searchParams.get('timeMin') ?? '';
  const timeMax = url.searchParams.get('timeMax') ?? '';
  const min = Date.parse(timeMin);
  const max = Date.parse(timeMax);
  if (!RFC3339.test(timeMin) || !RFC3339.test(timeMax) ||
      !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new GoogleCalendarError('timeMin and timeMax must be a valid RFC3339 range.');
  }
  if (max - min > 31 * 24 * 60 * 60 * 1000) {
    throw new GoogleCalendarError('Calendar lookups are limited to 31 days.');
  }
  return { timeMin, timeMax };
}

export async function listGoogleCalendarEvents(
  env: Env,
  rawSecret: string,
  range: { timeMin: string; timeMax: string },
  fetcher: typeof fetch = fetch,
): Promise<CalendarEventView[]> {
  const token = await accessToken(env, rawSecret, fetcher);
  const params = new URLSearchParams({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
    fields: 'items(id,summary,status,start,end,location,htmlLink)',
  });
  const response = await fetcher(`${API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await providerError(response);
  const body = await response.json().catch(() => null) as { items?: Record<string, unknown>[] } | null;
  return (body?.items ?? []).map(view).filter((event) => event.id && event.start && event.end);
}

function busyInstant(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  const shaped = value as { dateTime?: unknown; date?: unknown };
  const raw = typeof shaped.dateTime === 'string' ? shaped.dateTime
    : typeof shaped.date === 'string' ? `${shaped.date}T00:00:00+08:00` : '';
  const date = new Date(raw);
  return raw && !Number.isNaN(date.getTime()) ? date : null;
}

/** Busy times only: no titles, descriptions, guests or locations. Jentera's
    own deterministic events are excluded because the booking rows already
    hold their capacity; counting both would close group services after the
    first customer. */
export async function listGoogleCalendarBusy(
  env: Env,
  rawSecret: string,
  range: { timeMin: string; timeMax: string },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CalendarBusyInterval[]> {
  const token = await accessToken(env, rawSecret, fetcher, signal);
  const found: CalendarBusyInterval[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      timeZone: 'Asia/Kuala_Lumpur',
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
      fields: 'nextPageToken,items(id,status,transparency,start(date,dateTime),end(date,dateTime))',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetcher(`${API}/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await providerError(response);
    const body = await response.json().catch(() => null) as {
      nextPageToken?: unknown;
      items?: Array<{ id?: unknown; status?: unknown; transparency?: unknown; start?: unknown; end?: unknown }>;
    } | null;
    if (!body) throw new GoogleCalendarError('Google Calendar returned an incomplete availability response.');
    for (const event of body.items ?? []) {
      const eventKey = typeof event.id === 'string' ? event.id : '';
      if (!eventKey || eventKey.startsWith('jentera') || event.status === 'cancelled' || event.transparency === 'transparent') continue;
      const startsAt = busyInstant(event.start);
      const endsAt = busyInstant(event.end);
      if (startsAt && endsAt && endsAt.getTime() > startsAt.getTime()) found.push({ eventKey, startsAt, endsAt });
    }
    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
    if (!pageToken) return found;
  }
  throw new GoogleCalendarError('Google Calendar availability was too large to read safely.');
}

export async function createGoogleCalendarEvent(
  env: Env,
  rawSecret: string,
  event: CalendarEventInput,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CalendarEventView> {
  const budget = signal ? { signal } : {};
  const token = await accessToken(env, rawSecret, fetcher, signal);
  // A stable provider id makes a retry safe even if the first response is lost.
  const id = calendarEventId(event.requestId);
  const response = await fetcher(`${API}/calendars/primary/events?sendUpdates=none`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id,
      summary: event.summary,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone },
      ...(event.location ? { location: event.location } : {}),
      ...(event.description ? { description: event.description } : {}),
    }),
    ...budget,
  });
  if (response.status === 409) {
    /* The deterministic id makes an uncertain retry safe. A 409 means Google
       has, or had, this exact Jentera request: read it back. A `cancelled`
       status there is a deletion marker, not a live event, and is returned
       as is. The caller must not record it as created. */
    const existing = await fetcher(`${API}/calendars/primary/events/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      ...budget,
    });
    if (!existing.ok) throw await providerError(existing);
    const body = await existing.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new GoogleCalendarError('Google Calendar returned an incomplete event.');
    return view(body);
  }
  if (!response.ok) throw await providerError(response);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) throw new GoogleCalendarError('Google Calendar returned an incomplete event.');
  return view(body);
}

/** Remove the event a Jentera request created. An event that is already
    gone counts as success. It may never have been created, the owner may
    have deleted it, or an earlier attempt's answer may have been lost; 404
    and 410 both mean there is nothing left to remove. */
export async function deleteGoogleCalendarEvent(
  env: Env,
  rawSecret: string,
  requestId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<'deleted' | 'already_absent'> {
  const token = await accessToken(env, rawSecret, fetcher, signal);
  const response = await fetcher(
    `${API}/calendars/primary/events/${calendarEventId(requestId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) },
  );
  if (response.status === 404 || response.status === 410) return 'already_absent';
  if (!response.ok) throw await providerError(response);
  return 'deleted';
}

export async function revokeGoogleCalendar(
  env: Env,
  rawSecret: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const oauth = client(env);
  if (!oauth) return;
  const stored = openSecret(rawSecret);
  await fetcher(REVOKE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: stored.refreshToken }),
  });
}
