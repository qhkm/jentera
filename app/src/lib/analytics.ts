/* ============================================================
   First-party activation measurement.

   No prompts, business names, email addresses, URLs, answers, connector
   identifiers, or error messages leave the browser. The random browser
   session expires after 30 days and Global Privacy Control / Do Not Track
   disables collection entirely.
   ============================================================ */

export type ActivationEvent =
  | 'signup_started'
  | 'signin_started'
  | 'onboarding_started'
  | 'business_import_started'
  | 'business_profile_confirmed'
  | 'onboarding_completed'
  | 'dashboard_opened'
  | 'ask_sent'
  | 'ask_completed'
  | 'work_sent'
  | 'work_completed'
  | 'telegram_connect_started'
  | 'telegram_connected';

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const STORAGE_KEY = 'jentera-activation-session-v1';
const MAX_AGE = 30 * 24 * 60 * 60 * 1_000;

interface ActivationSession {
  id: string;
  createdAt: number;
}

function privacyOptOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const privateNavigator = navigator as Navigator & { globalPrivacyControl?: boolean };
  return navigator.doNotTrack === '1' || privateNavigator.globalPrivacyControl === true;
}

function session(): ActivationSession | null {
  if (privacyOptOut()) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ActivationSession | null;
    if (saved && typeof saved.id === 'string' && Number.isFinite(saved.createdAt) &&
        Date.now() - saved.createdAt < MAX_AGE) return saved;
    const next = { id: crypto.randomUUID(), createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** Best effort by design: measurement must never delay or block the product. */
export function trackActivation(event: ActivationEvent): void {
  if (!API || typeof location === 'undefined') return;
  const current = session();
  if (!current) return;
  const elapsedSeconds = Math.max(0, Math.min(30 * 24 * 60 * 60,
    Math.round((Date.now() - current.createdAt) / 1_000)));
  void fetch(`${API}/api/events`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      sessionId: current.id,
      route: location.pathname,
      elapsedSeconds,
    }),
  }).catch(() => {});
}
