import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueRuntimeTask } from '../src/runtime/tasks';
import { startRun } from '../src/runs';
import { DEFAULT_SPECIALISTS, specialistForTurn, STICKY_SPECIALIST_WINDOW_MS } from '../src/specialists';
import { asOwner, asTenant, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const specialists = DEFAULT_SPECIALISTS.map((specialist) => ({
  ...specialist, id: specialist.profile, instructions: '', enabled: true,
}));
const MARKETING = 'Plan a social media marketing campaign';

/** One earlier turn in a chat: a run carrying the session, and the task that
    answered it, with or without a specialist profile. */
async function previousTurn(sessionId: string, profile: string | undefined, agoMs = 0) {
  const runId = await asTenant(A, async (tx) => {
    const run = await startRun(tx, A, {
      kind: 'ask', triggerShape: 'owner.ask', runtime: 'hermes-sprite', model: 'deepseek',
      triggerRef: { question: 'earlier', sessionId },
    });
    await enqueueRuntimeTask(tx, A, {
      kind: 'run', runId: run.id, dedupeKey: `turn:${run.id}`,
      payload: { input: 'earlier', sessionId, ...(profile ? { profile } : {}) },
    });
    return run.id;
  });
  /* After the tenant transaction has committed: an update inside it, on
     another connection, finds no row and says nothing. */
  if (agoMs) {
    await asOwner((sql) => sql`update run set created_at = now() - make_interval(secs => ${agoMs / 1000}) where id = ${runId}`);
  }
  return runId;
}

const route = (sessionId: string | undefined, question = MARKETING) =>
  asTenant(A, (tx) => specialistForTurn(tx, A, sessionId, question, specialists));

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`insert into business (id, name, playbook_key) values (${A}, 'Alpha', 'restaurant')`);
});

describe('which specialist answers a turn', () => {
  it('scores the request when the chat has no earlier turn', async () => {
    expect((await route('new-chat'))?.profile).toBe('growth');
    expect((await route(undefined))?.profile).toBe('growth');
  });

  it('follows the specialist that answered the previous turn of the same chat', async () => {
    await previousTurn('thread', 'operations');
    expect((await route('thread'))?.profile).toBe('operations');
    expect((await route('other-thread'))?.profile).toBe('growth');
  });

  it('stays with the Chief of Staff when the Chief of Staff answered the previous turn', async () => {
    await previousTurn('thread', undefined);
    expect(await route('thread')).toBeUndefined();
  });

  it('follows the most recent turn, not the first', async () => {
    await previousTurn('thread', 'operations', 60_000);
    await previousTurn('thread', 'records');
    expect((await route('thread'))?.profile).toBe('records');
  });

  it('scores afresh once the previous turn is older than the window', async () => {
    await previousTurn('thread', 'operations', STICKY_SPECIALIST_WINDOW_MS + 60_000);
    expect((await route('thread'))?.profile).toBe('growth');
  });

  it('scores afresh when the previous specialist has since been disabled', async () => {
    await previousTurn('thread', 'operations');
    const withoutOperations = specialists.filter((specialist) => specialist.profile !== 'operations');
    expect((await asTenant(A, (tx) => specialistForTurn(tx, A, 'thread', MARKETING, withoutOperations)))?.profile).toBe('growth');
  });
});
