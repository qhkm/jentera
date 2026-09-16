import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '33333333-3333-4333-8333-333333333333';
const config = { id: ID, name: 'Trusted report service', task: 'business_summary', timeZone: 'Asia/Kuala_Lumpur', expiresAt: '2026-09-23T00:00:00.000Z' };
const row = { ...config, revokedAt: null, createdAt: '2026-09-16T00:00:00.000Z' };
const list = { ok: true, apiVersion: 1, available: false, triggers: [row], tasks: ['business_summary', 'weekly_summary', 'approval_reminder'],
  limits: { maxActive: 3, dailyEvents: 20, bodyBytes: 2048 } };
const created = { ok: true, trigger: row, shownOnce: true, url: 'https://api.jentera.test/api/webhooks/external/' + ID, secret: 'a'.repeat(64) };
beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_API_URL', 'https://api.jentera.test'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const respond = (body: unknown, status = 200) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(body, { status }));
  vi.stubGlobal('fetch', fetch); return fetch;
};
describe('owner trigger API boundary', () => {
  it('uses private authenticated reads and exposes metadata only, even while paused', async () => {
    const fetch = respond({ ...list, triggers: [{ ...row, secret: 'never-retain', ciphertext: 'never-retain' }] });
    const { fetchTriggers } = await import('../external-triggers');
    const signal = new AbortController().signal;
    const result = await fetchTriggers(signal);
    expect(result.available).toBe(false);
    expect(result.triggers).toEqual([row]);
    expect(JSON.stringify(result)).not.toContain('never-retain');
    expect(fetch).toHaveBeenCalledWith('https://api.jentera.test/api/external-triggers', expect.objectContaining({ signal, credentials: 'include', cache: 'no-store', redirect: 'error', method: 'GET' }));
  });
  it.each([
    { apiVersion: 2 }, { limits: { ...list.limits, dailyEvents: 100 } }, { tasks: ['run_anything'] },
    { triggers: [{ ...row, id: 'https://evil.test' }] }, { triggers: [{ ...row, task: 'run_anything' }] },
    { triggers: [row, row] }, { triggers: [{ ...row, expiresAt: 'bad-date' }] },
  ])('rejects unsupported configuration: %j', async override => {
    respond({ ...list, ...override });
    const { fetchTriggers } = await import('../external-triggers');
    await expect(fetchTriggers(new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('retains a signing key only from its matching one-time create response', async () => {
    const fetch = respond(created, 201);
    const { createTrigger } = await import('../external-triggers');
    const result = await createTrigger(config as import('../external-triggers').TriggerConfig, new AbortController().signal);
    expect(result).toEqual({ trigger: row, secret: created.secret, url: created.url });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(config) });
  });
  it.each([
    { url: 'https://evil.test/steal' }, { url: created.url + '?key=leak' }, { shownOnce: false },
    { secret: 'not-a-key' }, { trigger: { ...row, name: 'Changed scope' } }, { trigger: { ...row, revokedAt: row.createdAt } },
  ])('rejects a malformed or scope-changed create response without retry: %j', async override => {
    const fetch = respond({ ...created, ...override }, 201);
    const { createTrigger } = await import('../external-triggers');
    await expect(createTrigger(config as import('../external-triggers').TriggerConfig, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('never follows raw error text or exposes unknown server error codes', async () => {
    respond({ ok: false, code: 'secret-error', err: created.secret }, 503);
    const { fetchTriggers } = await import('../external-triggers');
    await expect(fetchTriggers(new AbortController().signal)).rejects.toMatchObject({ code: 'TRIGGER_UNAVAILABLE', message: 'External trigger operation failed' });
  });
  it('requires exact ID and confirmed revocation in the delete response', async () => {
    const fetch = respond({ ok: true, trigger: { ...row, revokedAt: row.createdAt } });
    const { revokeTrigger } = await import('../external-triggers');
    expect(await revokeTrigger(ID, new AbortController().signal)).toMatchObject({ revokedAt: row.createdAt });
    expect(fetch).toHaveBeenCalledWith('https://api.jentera.test/api/external-triggers/' + ID, expect.objectContaining({ method: 'DELETE' }));
    respond({ ok: true, trigger: row });
    await expect(revokeTrigger(ID, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not send requests to an insecure API URL', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.jentera.test');
    const fetch = respond(list);
    const { fetchTriggers } = await import('../external-triggers');
    await expect(fetchTriggers(new AbortController().signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
