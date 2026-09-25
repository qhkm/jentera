/* Google Calendar uses the existing Google callback URI so the pilot does
   not require a second redirect registration. Its own cookie distinguishes
   this explicit connection grant from ordinary Google sign-in. */

import type { Env } from '../env';
import { withTenant } from '../db';
import { saveConnection } from '../connections';
import { hasBusiness, resolveTenant, type TenantIdentity } from '../tenancy';
import { randomUrlSafe, s256 } from '../oauth';
import {
  GOOGLE_CALENDAR_CONNECTOR,
  calendarSecret,
  exchangeGoogleCalendarCode,
  googleCalendarAuthorizeUrl,
  googleCalendarConfigured,
} from '../connectors/google-calendar';
import { refreshBookingCalendarAvailability } from '../apps/bookings/calendar-availability';
import { appsEnabledFor } from '../apps/gating';

const COOKIE = 'aisar_calendar_oauth';
const COOKIE_PATH = '/api/auth';

function readCookie(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=') || null;
  }
  return null;
}

function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=0`;
}

function landing(env: Env, outcome: 'connected' | 'failed' | 'unavailable' | 'session') {
  const params = new URLSearchParams({
    view: 'business',
    tab: 'connections',
    calendar: outcome,
  });
  return `${env.APP_ORIGIN}/app?${params}`;
}

export async function startGoogleCalendarOAuth(
  env: Env,
  identity: TenantIdentity & { businessId: string },
): Promise<Response> {
  if (!googleCalendarConfigured(env)) {
    return new Response(null, { status: 302, headers: { Location: landing(env, 'unavailable') } });
  }
  const state = randomUrlSafe();
  const verifier = randomUrlSafe();
  const value = [state, verifier, identity.businessId, identity.userId].join('.');
  return new Response(null, {
    status: 302,
    headers: {
      Location: googleCalendarAuthorizeUrl(env, {
        state,
        codeChallenge: await s256(verifier),
      }),
      'Set-Cookie': `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Null means this is the normal Google sign-in callback. */
export async function handleGoogleCalendarCallback(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== '/api/auth/google/callback' || request.method !== 'GET') return null;
  const stash = readCookie(request);
  if (!stash) return null;

  const finish = (outcome: 'connected' | 'failed' | 'unavailable' | 'session') =>
    new Response(null, {
      status: 302,
      headers: {
        Location: landing(env, outcome),
        'Set-Cookie': clearCookie(),
        'Cache-Control': 'no-store',
      },
    });

  if (!googleCalendarConfigured(env)) return finish('unavailable');
  const [wantState, verifier, businessId, userId] = stash.split('.');
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || state !== wantState || !verifier || !businessId || !userId) {
    return finish('failed');
  }

  const identity = await resolveTenant(env, request);
  if (!identity || !hasBusiness(identity) || identity.businessId !== businessId || identity.userId !== userId) {
    return finish('session');
  }

  const profile = await exchangeGoogleCalendarCode(env, code, verifier).catch(() => null);
  if (!profile) return finish('failed');

  try {
    await withTenant(env, identity.businessId, (tx) => saveConnection(env, tx, identity.businessId, {
      connector: GOOGLE_CALENDAR_CONNECTOR,
      method: 'oauth',
      externalId: profile.subject,
      displayName: profile.email,
      secret: calendarSecret(profile),
      scopes: profile.scopes,
      connectedBy: identity.userId,
    }));
  } catch {
    return finish('failed');
  }
  // Prime the time-only cache before the owner returns to the app. A Calendar
  // outage does not undo a valid OAuth connection; the settings screen shows
  // the refresh problem and confirmation continues to fail safely.
  if (appsEnabledFor(env, identity.businessId)) {
    await refreshBookingCalendarAvailability(env, identity.businessId, { force: true });
  }
  return finish('connected');
}
