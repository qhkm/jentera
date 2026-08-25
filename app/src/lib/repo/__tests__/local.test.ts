import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/repo/local';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';

function repo() {
  return new LocalRepository();
}

beforeEach(() => {
  localStorage.clear();
});

describe('load', () => {
  it('returns safe defaults on a first visit', async () => {
    const snap = await repo().load();
    expect(snap.onboarded).toBe(false);
    expect(snap.setupDone).toBe(false);
    expect(snap.bizType).toBe('');
    expect(snap.channels).toBeNull();
    expect(snap.conns).toEqual([]);
    expect(snap.country).toBe('MY');
    expect(snap.lang).toBe('en');
    expect(snap.theme).toBe('dark');
    expect(snap.approvals).toEqual([]);
    expect(snap.permissions).toEqual({});
    expect(snap.workDone).toEqual({});
    expect(snap.learn).toEqual({});
  });

  it('reads state a previous session wrote', async () => {
    store.set(KEYS.onboarded, '1');
    store.set(KEYS.bizType, 'restaurant');
    store.set(KEYS.bizName, 'Warung Pak Din');
    store.setJSON(KEYS.channels, ['WhatsApp']);
    const snap = await repo().load();
    expect(snap.onboarded).toBe(true);
    expect(snap.bizType).toBe('restaurant');
    expect(snap.bizName).toBe('Warung Pak Din');
    expect(snap.channels).toEqual(['WhatsApp']);
  });

  it('collects per-playbook work-done and learn keys into maps', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', ['0', '2']);
    store.setJSON(KEYS.workDone + 'clinic', ['1']);
    store.setJSON(KEYS.learn + 'restaurant', { 'inferred:restaurant': 3 });
    const snap = await repo().load();
    expect(snap.workDone).toEqual({ restaurant: ['0', '2'], clinic: ['1'] });
    expect(snap.learn).toEqual({ restaurant: { 'inferred:restaurant': 3 } });
  });

  it('normalises numeric work-done indices to strings', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0, 2]);
    const snap = await repo().load();
    expect(snap.workDone.restaurant).toEqual(['0', '2']);
  });
});

describe('writes land on the exact legacy keys', () => {
  it('setBizType', async () => {
    await repo().setBizType('clinic');
    expect(localStorage.getItem('aisar-biz-type')).toBe('clinic');
  });

  it('setOnboarded writes the string 1, and removes it when false', async () => {
    const r = repo();
    await r.setOnboarded(true);
    expect(localStorage.getItem('aisar-onboarded-v1')).toBe('1');
    await r.setOnboarded(false);
    expect(localStorage.getItem('aisar-onboarded-v1')).toBeNull();
  });

  it('setTheme uses the key useTheme.ts used', async () => {
    await repo().setTheme('light');
    expect(localStorage.getItem('aisar-theme')).toBe('light');
  });

  it('setConnections writes JSON', async () => {
    await repo().setConnections(['WhatsApp', 'Instagram']);
    expect(JSON.parse(localStorage.getItem('aisar-conns') ?? 'null')).toEqual([
      'WhatsApp',
      'Instagram',
    ]);
  });

  it('markWorkDone writes strings and does not duplicate', async () => {
    const r = repo();
    await r.markWorkDone('restaurant', 1);
    await r.markWorkDone('restaurant', 1);
    expect(JSON.parse(localStorage.getItem('aisar-work-done:restaurant') ?? 'null')).toEqual(['1']);
  });

  /**
   * The engine wrote these indices as numbers before this port switched to
   * strings. Seeding a pre-existing numeric entry proves markWorkDone
   * coerces it on write, not just on read — a user who approved work on
   * the old format must not find it un-approved after the cutover.
   */
  it('markWorkDone coerces a pre-existing numeric entry to a string on write', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0]);
    const r = repo();
    await r.markWorkDone('restaurant', 1);
    await r.markWorkDone('restaurant', 1);
    expect(JSON.parse(localStorage.getItem('aisar-work-done:restaurant') ?? 'null')).toEqual([
      '0',
      '1',
    ]);
  });

  it('recordLearn increments a counter', async () => {
    const r = repo();
    await r.recordLearn('restaurant', 'a');
    await r.recordLearn('restaurant', 'a');
    expect(JSON.parse(localStorage.getItem('aisar-learn:restaurant') ?? 'null')).toEqual({ a: 2 });
  });
});

describe('policies', () => {
  it('setPolicy merges into existing stored policies rather than replacing them', async () => {
    const r = repo();
    await r.setPolicy('send', 'automatic');
    await r.setPolicy('refund', 'approval');
    expect(JSON.parse(localStorage.getItem('aisar-permissions') ?? 'null')).toEqual({
      send: 'automatic',
      refund: 'approval',
    });
  });

  it('resetPolicies clears stored policies to {}', async () => {
    const r = repo();
    await r.setPolicy('send', 'automatic');
    await r.resetPolicies();
    expect(JSON.parse(localStorage.getItem('aisar-permissions') ?? 'null')).toEqual({});
  });
});

describe('approvals', () => {
  it('queues and then decides one', async () => {
    const r = repo();
    await r.queueApproval({
      id: 7,
      conn: 'WhatsApp',
      op: 'send',
      args: {},
      risk: 'high',
      ts: '2026-08-21T00:00:00.000Z',
      status: 'pending',
    });
    let snap = await r.load();
    expect(snap.approvals).toHaveLength(1);

    await r.decideApproval(7, true);
    snap = await r.load();
    expect(snap.approvals[0].status).toBe('approved');
    expect(snap.approvals[0].decided).toBeTruthy();
  });

  it('leaves other approvals untouched when deciding one', async () => {
    const r = repo();
    const base = { conn: 'WhatsApp', op: 'send', args: {}, risk: 'high' as const, ts: 'x', status: 'pending' as const };
    await r.queueApproval({ ...base, id: 1 });
    await r.queueApproval({ ...base, id: 2 });
    await r.decideApproval(1, false);
    const snap = await r.load();
    expect(snap.approvals.find((a) => a.id === 1)?.status).toBe('rejected');
    expect(snap.approvals.find((a) => a.id === 2)?.status).toBe('pending');
  });
});

describe('reset', () => {
  it('clears every aisar- key and leaves others alone', async () => {
    store.set(KEYS.bizType, 'restaurant');
    localStorage.setItem('unrelated', 'keep me');
    await repo().reset();
    expect(localStorage.getItem('aisar-biz-type')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });
});
