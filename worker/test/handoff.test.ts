import { describe, expect, it } from 'vitest';
import { HANDOFF_PREAMBLE, handoffEnabledFor, handoffTaskField } from '../src/handoff';
import { runPayload } from '../src/runtime/run-task';
import { testEnv } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('who may hand off', () => {
  it('is nobody until a business is listed, and only while the switch is on', () => {
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: '' }), A)).toBe(false);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: `${B}, ${A}` }), A)).toBe(true);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'false', HANDOFF_BUSINESS_IDS: A }), A)).toBe(false);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: `${A},not-a-uuid` }), A)).toBe(false);
  });
});

describe('what a task start carries', () => {
  it('puts who asked into what the specialist is told', () => {
    expect(handoffTaskField().preamble).toBe(HANDOFF_PREAMBLE);
    expect(handoffTaskField('The person typing is staff member sam@example.com.').preamble)
      .toBe(`${HANDOFF_PREAMBLE}\n\nThe person typing is staff member sam@example.com.`);
    expect(handoffTaskField()).toMatchObject({ maxDepth: 2, maxHandoffs: 5 });
  });

  it('keeps well-formed hand-off limits on a run payload and drops anything else', () => {
    const field = handoffTaskField();
    expect(runPayload({ input: 'hi', handoff: field }).handoff).toEqual(field);
    expect(runPayload({ input: 'hi', handoff: { ...field, maxDepth: 3 } }).handoff).toBeUndefined();
    expect(runPayload({ input: 'hi', handoff: { ...field, preamble: 'x'.repeat(4_001) } }).handoff).toBeUndefined();
    expect(runPayload({ input: 'hi' }).handoff).toBeUndefined();
  });
});
