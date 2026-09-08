import { describe, expect, it } from 'vitest';
import { modelForResponseMode, responseModeFor, routedModelNames } from '../src/runtime/response-mode';

describe('responseModeFor', () => {
  it.each([
    'Are we open on Sunday?',
    'Draft a short reply to this customer',
    'What did I tell you about our refund policy?',
  ])('keeps ordinary business chat quick: %s', (message) => {
    expect(responseModeFor(message)).toBe('quick');
  });

  it.each([
    'Research the latest payroll rules in Malaysia',
    'Do a deep dive into our competitors',
    'Prepare a comprehensive market analysis',
    'Compare accounting providers for our business',
    '/deep work through this operational problem',
  ])('reserves deep reasoning for substantial work: %s', (message) => {
    expect(responseModeFor(message)).toBe('deep');
  });

  it('lets the owner force a quick answer', () => {
    expect(responseModeFor('/quick research this briefly')).toBe('quick');
  });
});

describe('modelForResponseMode', () => {
  it('keeps MiniMax on quick replies and reserves DS4 for deep work', () => {
    const env = {
      AISAR_MODEL_NAME: 'MiniMax-M3',
      AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    };
    expect(modelForResponseMode(env, 'quick')).toBe('MiniMax-M3');
    expect(modelForResponseMode(env, 'deep')).toBe('deepseek-v4-flash');
  });

  it('falls back to the primary model when no separate deep route is configured', () => {
    expect(modelForResponseMode({ AISAR_MODEL_NAME: 'one-model' }, 'deep'))
      .toBe('one-model');
  });
});

describe('candidate routes and per-business quick overrides', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const env = {
    AISAR_MODEL_NAME: 'MiniMax-M3',
    AISAR_DEEP_MODEL_NAME: 'deepseek-v4-flash',
    AISAR_CANDIDATE_MODEL_NAMES: 'MiniMax-M2.7-highspeed',
    AISAR_QUICK_MODEL_OVERRIDES: `${A}=MiniMax-M2.7-highspeed`,
  };

  it('routes only the overridden business to the candidate quick model', () => {
    expect(modelForResponseMode(env, 'quick', A)).toBe('MiniMax-M2.7-highspeed');
    expect(modelForResponseMode(env, 'quick', B)).toBe('MiniMax-M3');
    expect(modelForResponseMode(env, 'quick')).toBe('MiniMax-M3');
  });

  it('never overrides deep work', () => {
    expect(modelForResponseMode(env, 'deep', A)).toBe('deepseek-v4-flash');
  });

  it('refuses a quick override that is not a routed model', () => {
    const broken = { ...env, AISAR_QUICK_MODEL_OVERRIDES: `${A}=unrouted-model` };
    expect(() => modelForResponseMode(broken, 'quick', A)).toThrow(/routed/);
  });

  it('lists quick, deep, and every candidate exactly once', () => {
    expect(routedModelNames(env)).toEqual([
      'MiniMax-M3',
      'deepseek-v4-flash',
      'MiniMax-M2.7-highspeed',
    ]);
    expect(routedModelNames({ AISAR_MODEL_NAME: 'one', AISAR_CANDIDATE_MODEL_NAMES: 'one, two' }))
      .toEqual(['one', 'two']);
  });
});
