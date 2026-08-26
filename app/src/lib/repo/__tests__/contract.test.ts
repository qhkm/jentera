/* ============================================================
   One suite, both implementations.

   This is the assertion slice 0 was built to make possible: if
   LocalRepository and RemoteRepository both satisfy the same
   observable contract, the interface genuinely abstracts the
   difference, and a screen cannot tell which one it is talking to.

   RemoteRepository runs against a fake fetch holding the same shape
   the Worker returns — the point is the client's contract, not the
   server's, which is covered by the SQL-level tests.
   ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/repo/local';
import { RemoteRepository } from '@/lib/repo/remote';
import type { Repository } from '@/lib/repo/types';

/* ---- a Worker-shaped fake ------------------------------------------ */

interface FakeState {
  onboarded: boolean;
  setupDone: boolean;
  bizType: string;
  bizName: string;
  bizLoc: string;
  channels: string[] | null;
  conns: string[] | null;
  country: string;
  lang: string;
  theme: string;
  approvals: Record<string, unknown>[];
  permissions: Record<string, string>;
  workDone: Record<string, string[]>;
  learn: Record<string, Record<string, number>>;
}

function installFakeWorker(): FakeState {
  const state: FakeState = {
    onboarded: false, setupDone: false, bizType: '', bizName: '', bizLoc: '',
    channels: null, conns: null, country: 'MY', lang: 'en', theme: 'dark',
    approvals: [], permissions: {}, workDone: {}, learn: {},
  };
  let seq = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const done = () => new Response(null, { status: 204 });

    if (path === '/api/state') return ok({ ok: true, snapshot: state });
    if (path === '/api/state/biz-type') { state.bizType = String(body.key); return done(); }
    if (path === '/api/state/biz-profile') {
      if (body.name !== undefined) state.bizName = String(body.name);
      if (body.loc !== undefined) state.bizLoc = String(body.loc);
      return done();
    }
    if (path === '/api/state/onboarded') { state.onboarded = Boolean(body.value); return done(); }
    if (path === '/api/state/setup-done') { state.setupDone = Boolean(body.value); return done(); }
    if (path === '/api/state/channels') { state.channels = body.channels as string[]; return done(); }
    if (path === '/api/state/connections') { state.conns = body.connections as string[]; return done(); }
    if (path === '/api/state/country') { state.country = String(body.code); return done(); }
    if (path === '/api/state/lang') { state.lang = String(body.lang); return done(); }
    if (path === '/api/state/theme') { state.theme = String(body.theme); return done(); }
    if (path === '/api/state/policy') {
      state.permissions[String(body.op)] = String(body.policy); return done();
    }
    if (path === '/api/state/policies/reset') { state.permissions = {}; return done(); }
    if (path === '/api/state/approvals') {
      const remoteId = `uuid-${++seq}`;
      state.approvals.push({
        remoteId, conn: body.conn, op: body.op, args: body.args,
        risk: body.risk, status: 'pending', ts: new Date().toISOString(), decided: null,
      });
      return ok({ ok: true, remoteId });
    }
    const decide = path.match(/^\/api\/state\/approvals\/([^/]+)\/decide$/);
    if (decide) {
      const row = state.approvals.find((a) => a.remoteId === decide[1] && a.status === 'pending');
      if (!row) return new Response(JSON.stringify({ ok: false, err: 'not pending' }), { status: 409 });
      row.status = body.approved ? 'approved' : 'rejected';
      row.decided = new Date().toISOString();
      return ok({ ok: true });
    }
    if (path === '/api/state/work-done') {
      const k = String(body.playbookKey);
      (state.workDone[k] ??= []);
      if (!state.workDone[k].includes(String(body.index))) state.workDone[k].push(String(body.index));
      return done();
    }
    if (path === '/api/state/learn') {
      const k = String(body.playbookKey);
      (state.learn[k] ??= {});
      state.learn[k][String(body.pick)] = (state.learn[k][String(body.pick)] ?? 0) + 1;
      return done();
    }
    return new Response(JSON.stringify({ ok: false, err: 'not found' }), { status: 404 });
  }) as typeof fetch;

  return state;
}

/* ---- the shared contract -------------------------------------------- */

const IMPLS: [string, () => Repository][] = [
  ['LocalRepository', () => { localStorage.clear(); return new LocalRepository(); }],
  ['RemoteRepository', () => { installFakeWorker(); return new RemoteRepository(); }],
];

describe.each(IMPLS)('%s satisfies the Repository contract', (_name, make) => {
  let repo: Repository;
  beforeEach(() => { repo = make(); });

  it('starts from safe defaults', async () => {
    const s = await repo.load();
    expect(s.onboarded).toBe(false);
    expect(s.channels).toBeNull();
    /* Null rather than empty. Both implementations must agree that
       "nothing chosen yet" is distinct from "chose nothing", or the
       connection defaults get re-seeded over a deliberate choice. */
    expect(s.conns).toBeNull();
    expect(s.country).toBe('MY');
    expect(s.lang).toBe('en');
    expect(s.theme).toBe('dark');
    expect(s.approvals).toEqual([]);
  });

  it('round-trips the business profile', async () => {
    await repo.setBizType('restaurant');
    await repo.setBizProfile({ name: 'Warung Pak Din', loc: 'Ipoh, Perak' });
    const s = await repo.load();
    expect(s.bizType).toBe('restaurant');
    expect(s.bizName).toBe('Warung Pak Din');
    expect(s.bizLoc).toBe('Ipoh, Perak');
  });

  it('round-trips the flow gates', async () => {
    await repo.setOnboarded(true);
    await repo.setSetupDone(true);
    const s = await repo.load();
    expect(s.onboarded).toBe(true);
    expect(s.setupDone).toBe(true);
  });

  it('treats empty channels as null, not an empty array', async () => {
    await repo.setChannels([]);
    expect((await repo.load()).channels).toBeNull();
    await repo.setChannels(['WhatsApp']);
    expect((await repo.load()).channels).toEqual(['WhatsApp']);
  });

  it('round-trips connections, country, lang and theme', async () => {
    await repo.setConnections(['WhatsApp', 'Instagram']);
    await repo.setCountry('SG');
    await repo.setLang('bm');
    await repo.setTheme('light');
    const s = await repo.load();
    expect(s.conns).toEqual(['WhatsApp', 'Instagram']);
    expect(s.country).toBe('SG');
    expect(s.lang).toBe('bm');
    expect(s.theme).toBe('light');
  });

  it('merges policies and clears them', async () => {
    await repo.setPolicy('send', 'automatic');
    await repo.setPolicy('book', 'blocked');
    expect((await repo.load()).permissions).toEqual({ send: 'automatic', book: 'blocked' });
    await repo.resetPolicies();
    expect((await repo.load()).permissions).toEqual({});
  });

  it('queues an approval and decides it exactly once', async () => {
    const approval = {
      id: 1, conn: 'WhatsApp', op: 'send', args: { to: '+60123' },
      risk: 'high' as const, ts: new Date().toISOString(), status: 'pending' as const,
    };
    await repo.queueApproval(approval);

    let s = await repo.load();
    expect(s.approvals).toHaveLength(1);
    expect(s.approvals[0].status).toBe('pending');

    await repo.decideApproval(s.approvals[0].id, true);
    s = await repo.load();
    expect(s.approvals[0].status).toBe('approved');
    expect(s.approvals[0].decided).toBeTruthy();

    // Deciding the same approval again must not succeed a second time.
    await expect(repo.decideApproval(s.approvals[0].id, true)).rejects.toThrow();
  });

  it('records work as strings and does not duplicate', async () => {
    await repo.markWorkDone('restaurant', 1);
    await repo.markWorkDone('restaurant', 1);
    expect((await repo.load()).workDone.restaurant).toEqual(['1']);
  });

  it('counts repeated learn picks', async () => {
    await repo.recordLearn('restaurant', 'a');
    await repo.recordLearn('restaurant', 'a');
    expect((await repo.load()).learn.restaurant).toEqual({ a: 2 });
  });
});
