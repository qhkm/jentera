/* ============================================================
   Storage. Every persisted key in the product lives here — the
   flow gates read off these, so adding one is a routing change.
   Wrapped so private-mode / quota failures degrade to defaults
   instead of throwing (same contract as the old KV_STORE).
   ============================================================ */

export const KEYS = {
  onboarded: 'aisar-onboarded-v1',
  setupDone: 'aisar-setup-done-v1',
  bizType: 'aisar-biz-type',
  bizName: 'aisar-biz-name',
  bizLoc: 'aisar-biz-loc',
  channels: 'aisar-channels',
  conns: 'aisar-conns',
  country: 'aisar-country',
  lang: 'aisar-lang',
  approvals: 'aisar-approvals',
  /** suffixed with the playbook key */
  workDone: 'aisar-work-done:',
  /** suffixed with the playbook key */
  learn: 'aisar-learn:',
} as const;

export function get(key: string, fallback = ''): string {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — non-fatal by design */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

/** True only when the key has never been written — distinct from empty. */
export function isUnset(key: string): boolean {
  try {
    return localStorage.getItem(key) === null;
  } catch {
    return true;
  }
}

/** Clear every AISAR key. Useful for re-testing the first-run flow. */
export function resetAll(): void {
  try {
    const doomed = Object.keys(localStorage).filter((k) => k.startsWith('aisar-'));
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* non-fatal */
  }
}
