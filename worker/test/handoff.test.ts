import { describe, expect, it } from 'vitest';
import { HANDOFF_PREAMBLE, handoffEnabledFor, handoffTaskField } from '../src/handoff';
import { runPayload } from '../src/runtime/run-task';
import { testEnv } from './harness';
import { handoffInstructions } from '../src/handoff';
import { prepareHermesAgent } from '../src/ask';
import { specialistRunInstructions, type SpecialistDefinition } from '../src/specialists';

const specialist = (profile: string, name: string, description: string): SpecialistDefinition =>
  ({ id: profile, profile, name, description, instructions: '', enabled: true });
const ROSTER = [
  specialist('records', 'Finance and records', 'Invoices and cash flow.'),
  specialist('growth', 'Growth and marketing', 'Campaigns.'),
];

describe('what the agents are told', () => {
  it('lists the other specialists by key and asks for credit by name', () => {
    const text = handoffInstructions(ROSTER, 'growth');
    expect(text).toContain('ask_specialist');
    expect(text).toContain('- records: Finance and records — Invoices and cash flow.');
    expect(text).not.toContain('- growth:');
    expect(text).toContain('Never present a missing part as done');
    expect(handoffInstructions([ROSTER[1]], 'growth')).toBe('');
  });

  it('lets a routed specialist credit a colleague only when hand-offs are on', () => {
    expect(specialistRunInstructions(ROSTER[1])).toContain('do not expose internal profile names, routing, delegation, or handoffs');
    expect(specialistRunInstructions(ROSTER[1], { handoff: true })).toContain('say which part by their name');
    expect(specialistRunInstructions(ROSTER[1], { handoff: true })).not.toContain('delegation, or handoffs');
  });

  it('adds hand-off instructions to a turn only when given a roster', () => {
    const at = new Date('2026-09-26T00:00:00Z');
    expect(prepareHermesAgent('Reconcile last month', [], [], at).instructions).not.toContain('ask_specialist');
    expect(prepareHermesAgent('Reconcile last month', [], [], at, undefined, undefined, 'deep', ROSTER).instructions)
      .toContain('ask_specialist');
  });
});

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
