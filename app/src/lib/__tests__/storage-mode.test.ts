import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('business-profile browser storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps production profile state out of persistent localStorage', async () => {
    vi.stubEnv('DEV', false);
    const store = await import('@/lib/storage');

    store.set(store.KEYS.bizName, 'Tab-scoped business');

    expect(localStorage.getItem(store.KEYS.bizName)).toBeNull();
    expect(sessionStorage.getItem(store.KEYS.bizName)).toBe('Tab-scoped business');
    expect(store.get(store.KEYS.bizName)).toBe('Tab-scoped business');
  });

  it('retains localStorage persistence during development', async () => {
    vi.stubEnv('DEV', true);
    const store = await import('@/lib/storage');

    store.set(store.KEYS.bizName, 'Development business');

    expect(localStorage.getItem(store.KEYS.bizName)).toBe('Development business');
    expect(sessionStorage.getItem(store.KEYS.bizName)).toBeNull();
  });
});
