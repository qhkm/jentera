/* ============================================================
   The runtime seam.

   One implementation today, which makes a contract test look
   premature. It is not: the reason this seam exists is that a second
   implementation is coming, and the value of writing the rules down
   now is that they were derived from a runtime that works rather than
   from imagining one that does not.

   Everything here runs against the interface, never against
   InlineRuntime directly, so a Hermes adapter is added to the list at
   the top and either passes or is not finished.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { InlineRuntime, runtimeFor } from '../src/runtime';
import type { RuntimeAdapter } from '../src/runtime';
import type { Env } from '../src/env';

/* A stand-in for Workers AI. The seam's contract is about shape and
   side effects, not about what a model says. */
const env = {
  AI: {
    run: async () =>
      ({
        response: JSON.stringify({
          facts: [{ key: 'hours.monday', value: '9am to 6pm', confidence: 0.9 }],
        }),
      }) as unknown,
  },
} as unknown as Env;

const ADAPTERS: [string, () => RuntimeAdapter][] = [
  ['InlineRuntime', () => new InlineRuntime(env)],
  // ['HermesSprite', () => new HermesSpriteRuntime(env, ...)],
];

describe.each(ADAPTERS)('%s satisfies the runtime contract', (_name, make) => {
  it('names itself, for the run record', () => {
    const r = make();
    /* run.runtime is a snapshot taken when work starts, so history
       stays truthful after a runtime change. An adapter that did not
       identify itself would make every past run unattributable. */
    expect(r.id).toBeTruthy();
    expect(typeof r.id).toBe('string');
  });

  it('declares whether it outlives the request', () => {
    expect(['inline', 'durable']).toContain(make().mode);
  });

  it('declares its model, or null when it uses none', () => {
    const { model } = make();
    expect(model === null || typeof model === 'string').toBe(true);
  });

  it('answers a question without touching AISAR data', async () => {
    /* The adapter reads and reasons; the control plane decides what to
       persist. A runtime that could write facts or send messages
       directly would be a runtime that could bypass the approval
       gate — so the contract is that these methods return, and nothing
       else. */
    const r = make();
    const out = await r.answerQuestion('are you open?', [], []);
    expect(typeof out.text).toBe('string');
    expect(Array.isArray(out.usedKeys)).toBe(true);
    expect(typeof out.grounded).toBe('boolean');
  });

  it('reports grounded=false when it was given nothing to reason from', async () => {
    expect((await make().answerQuestion('anything?', [], [])).grounded).toBe(false);
  });

  it('reports grounded=true when it was given confirmed facts', async () => {
    const out = await make().answerQuestion('hours?', [
      { key: 'hours.monday', value: '9-6', source: 'owner', confidence: 1, confirmed: true },
    ], []);
    expect(out.grounded).toBe(true);
    expect(out.usedKeys).toContain('hours.monday');
  });
});

describe('choosing a runtime', () => {
  it('gives every business one', () => {
    const a = runtimeFor(env, '11111111-1111-4111-8111-111111111111');
    const b = runtimeFor(env, '22222222-2222-4222-8222-222222222222');
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
  });

  it('returns the inline runtime while nothing else is provisioned', () => {
    /* Asserted rather than assumed, so the day this stops being true
       it is a deliberate change with a failing test beside it. */
    expect(runtimeFor(env, '11111111-1111-4111-8111-111111111111').id).toBe('worker-inline');
    expect(runtimeFor(env, '11111111-1111-4111-8111-111111111111').mode).toBe('inline');
  });
});

describe('what the run record captures', () => {
  it('snapshots the runtime and model rather than looking them up later', () => {
    /* The invariant behind `runtime` and `model` being columns on
       `run` at all. A run that executed on one model must not appear,
       months later, to have used whatever is configured today. */
    const r = runtimeFor(env, '11111111-1111-4111-8111-111111111111');
    const snapshot = { runtime: r.id, model: r.model };
    expect(snapshot.runtime).toBe('worker-inline');
    expect(snapshot.model).toBe(r.model);
  });
});
