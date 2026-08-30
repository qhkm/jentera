/* ============================================================
   Storage. Every persisted key in the product lives here — the
   flow gates read off these, so adding one is a routing change.
   Wrapped so private-mode / quota failures degrade to defaults
   instead of throwing (same contract as the old KV_STORE).
   ============================================================ */

/* These pre-rebrand keys deliberately remain stable so existing Jentera users
   keep their onboarding, business profile, permissions, and connections. */
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
  /** Was defined locally in useTheme.ts and missing from this list. */
  theme: 'aisar-theme',
  approvals: 'aisar-approvals',
  /** Per-operation action policy. App-only; the engine has no equivalent. */
  permissions: 'aisar-permissions',
  /** suffixed with the playbook key */
  workDone: 'aisar-work-done:',
  /** suffixed with the playbook key */
  learn: 'aisar-learn:',
  /** Business facts in the anonymous demo, keyed by fact key. */
  facts: 'aisar-facts',
  /** First-run presentation state. Business answers still live in the repository. */
  onboardingDraft: 'aisar-onboarding-draft-v1',
} as const;

/**
 * Business-profile state is durable in localStorage only during local
 * development. Production's anonymous preview is tab-scoped, while signed-in
 * business data lives behind the API. That prevents a later visitor or account
 * on a shared browser from inheriting a stale local business profile.
 */
function profileStorage(): Storage {
  return import.meta.env.DEV ? localStorage : sessionStorage;
}

/** Enumerate profile keys without exposing the selected browser store. */
export function keys(): string[] {
  try {
    return Object.keys(profileStorage());
  } catch {
    return [];
  }
}

export function get(key: string, fallback = ''): string {
  try {
    const v = profileStorage().getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function set(key: string, value: string): void {
  try {
    profileStorage().setItem(key, value);
  } catch {
    /* private mode / quota — non-fatal by design */
  }
}

export function remove(key: string): void {
  try {
    profileStorage().removeItem(key);
  } catch {
    /* non-fatal */
  }
}

export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = profileStorage().getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  try {
    profileStorage().setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

/** True only when the key has never been written — distinct from empty. */
export function isUnset(key: string): boolean {
  try {
    return profileStorage().getItem(key) === null;
  } catch {
    return true;
  }
}

/** Clear every Jentera key. Useful for re-testing the first-run flow. */
export function resetAll(): void {
  try {
    const storage = profileStorage();
    const doomed = Object.keys(storage).filter((k) => k.startsWith('aisar-'));
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    /* non-fatal */
  }
}
