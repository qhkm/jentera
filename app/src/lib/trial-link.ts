const KEY = 'jentera.pending-trial-invite.v1';
const VALID = /^[A-Za-z0-9_-]{32,100}$/;

/** The fragment stays out of server request logs and referrer headers.
 * Authentication carries the invitation back; never persist it in web storage
 * or redeem automatically.
 * The server remains authoritative for expiry, ownership and single use. */
export function pendingTrialInvite(): string {
  if (typeof window === 'undefined') return '';
  const incoming = new URLSearchParams(window.location.hash.slice(1)).get('code');
  try { localStorage.removeItem(KEY); } catch { /* Clean up the old implementation only. */ }
  return incoming && VALID.test(incoming) ? incoming : '';
}

export function clearTrialInvite(): void {
  try { localStorage.removeItem(KEY); } catch { /* Storage is optional. */ }
  if (new URLSearchParams(window.location.hash.slice(1)).has('code')) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
}
