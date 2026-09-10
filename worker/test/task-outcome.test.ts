import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessTaskOutcome, parseTaskAssessment } from '../src/task-outcome';
import { append, homeCounters, recordWork, recentWork, startRun } from '../src/runs';
import { asOwner, asTenant, testEnv, truncateAll } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await truncateAll();
  await asOwner((sql) => sql`insert into business (id, name, playbook_key)
    values (${A}, 'Alpha', 'restaurant'), (${B}, 'Beta', 'retail')`);
});

async function run(businessId = A, sessionId = 'chat-a') {
  return asTenant(businessId, (tx) => startRun(tx, businessId, {
    kind: 'ask', runtime: 'hermes-sprite', triggerShape: 'owner.ask', triggerRef: { sessionId },
  }));
}

describe('task outcome assessment', () => {
  it('rejects invalid verdicts and arbitrary continuation ids', () => {
    expect(parseTaskAssessment('I am done')).toBeNull();
    expect(parseTaskAssessment({ kind: 'work', status: 'success' })).toBeNull();
    expect(parseTaskAssessment({ kind: 'work', status: 'needs_input', continuesWorkId: B }))
      .toEqual({ kind: 'work', status: 'needs_input' });
    expect(parseTaskAssessment({ kind: 'conversation', status: 'blocked', continuesWorkId: A }))
      .toEqual({ kind: 'conversation', status: 'completed' });
  });

  it('offers only same-business, same-session tasks and preserves one record on continuation', async () => {
    const previous = await run();
    const workId = await asTenant(A, (tx) => recordWork(tx, A, {
      runId: previous.id, kind: 'work', objective: 'Log in to Cloudflare', status: 'needs_input',
    }));
    for (const [business, session] of [[B, 'chat-a'], [A, 'different-chat']]) {
      const other = await run(business, session);
      await asTenant(business, (tx) => recordWork(tx, business, {
        runId: other.id, kind: 'work', objective: 'Private unrelated work', status: 'needs_input',
      }));
    }
    const current = await run();
    const model = vi.fn(async () => ({ response: JSON.stringify({
      kind: 'work', status: 'completed', continuesWorkId: workId,
      completionEvidence: 'Verified Cloudflare identity with wrangler whoami.',
    }) }));
    const verdict = await assessTaskOutcome(testEnv({ AI: { run: model } }), A, current.id,
      "I've authorized it, try again", 'Verified Cloudflare identity with wrangler whoami.');
    const input = model.mock.calls[0] as unknown as [string, { messages: { content: string }[] }];
    const data = JSON.parse(input[1].messages[1].content);
    expect(data.tasks.map((t: { id: string }) => t.id)).toEqual([workId]);
    expect(verdict).toMatchObject({ continuesWorkId: workId, previousRunId: previous.id });
    await asTenant(A, async (tx) => {
      await append(tx, A, current.id, 'outcome.observed', { ...verdict, assessmentVersion: 1 });
      expect(await recordWork(tx, A, {
        runId: current.id, kind: 'work', objective: 'Retry login', status: 'completed', outcome: 'Identity verified',
      })).toBe(workId);
      const work = await recentWork(tx);
      expect(work.filter((w) => w.objective === 'Log in to Cloudflare'))
        .toMatchObject([{ id: workId, runId: current.id, status: 'completed' }]);
      expect(work.some((w) => w.objective === 'Retry login')).toBe(false);
      expect(await recordWork(tx, A, {
        runId: current.id, kind: 'work', objective: 'Retry login', status: 'completed', outcome: 'Identity verified',
      })).toBe(workId);
    });
    const unused = vi.fn();
    expect(await assessTaskOutcome(testEnv({ AI: { run: unused } }), A, current.id, 'retry', 'done'))
      .toMatchObject(verdict);
    expect(unused).not.toHaveBeenCalled();
  });

  it('cannot merge a fabricated cross-tenant work reference', async () => {
    const foreign = await run(B);
    const foreignWork = await asTenant(B, (tx) => recordWork(tx, B, {
      runId: foreign.id, kind: 'work', objective: 'Private', status: 'needs_input',
    }));
    const current = await run();
    await asTenant(A, async (tx) => {
      await append(tx, A, current.id, 'outcome.observed', {
        assessmentVersion: 1, kind: 'work', status: 'completed', continuesWorkId: foreignWork, previousRunId: foreign.id,
      });
      expect(await recordWork(tx, A, { runId: current.id, kind: 'work', objective: 'Own work', status: 'completed' }))
        .not.toBe(foreignWork);
    });
    expect(await asTenant(B, (tx) => recentWork(tx))).toMatchObject([{ id: foreignWork, status: 'needs_input' }]);
  });

  it('counts owner input as needing attention, not completed work', async () => {
    await asTenant(A, async (tx) => {
      await recordWork(tx, A, { objective: 'Authorize login', kind: 'work', status: 'needs_input' });
      await recordWork(tx, A, { objective: 'Unclear result', kind: 'work', status: 'needs_review' });
      await recordWork(tx, A, { objective: 'Explanation', kind: 'conversation', status: 'completed' });
      expect(await homeCounters(tx)).toMatchObject({ handled: 0, needsYou: 2, minutesSaved: 0 });
    });
  });

  it('downgrades a claimed completion with no supporting quote', async () => {
    const current = await run();
    const env = testEnv({ AI: { run: async () => ({ response: JSON.stringify({
      kind: 'work', status: 'completed', completionEvidence: 'Login verified',
    }) }) } });
    expect(await assessTaskOutcome(env, A, current.id, 'Log in', 'Please authorize in your browser.'))
      .toEqual({ kind: 'work', status: 'needs_review' });
  });
});
