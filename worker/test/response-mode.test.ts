import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { modelForResponseMode, responseModeFor, routedModelNames } from '../src/runtime/response-mode';
import { modelCostMicrousd } from '../src/runtime/usage';

describe('responseModeFor', () => {
  it.each([
    'Are we open on Sunday?',
    'Draft a short reply to this customer',
    'What did I tell you about our refund policy?',
  ])('keeps ordinary business chat quick: %s', (message) => {
    expect(responseModeFor(message)).toBe('quick');
  });

  it.each([
    '/deep work through this operational problem',
    '/research the latest payroll rules in Malaysia',
  ])('reserves deep reasoning for an explicit request: %s', (message) => {
    expect(responseModeFor(message)).toBe('deep');
  });

  /* Deep runs on Telegram took nine minutes each when a phrase like "deep
     dive" tripped the heuristic. An owner who wants that waits for it on
     purpose, with the slash command; wording alone never costs ten minutes. */
  it.each([
    'Research the latest payroll rules in Malaysia',
    'Do a deep dive into our competitors',
    'Prepare a comprehensive market analysis',
    'Compare accounting providers for our business',
  ])('keeps substantial-sounding wording quick unless asked: %s', (message) => {
    expect(responseModeFor(message)).toBe('quick');
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

/* An override is a deployed string, and both ways it can be wrong fail on a
   live request rather than at deploy: `quickModelOverride` throws when the
   model is not one the sprites are provisioned to accept, and
   `modelCostMicrousd` throws when it carries no price. Read the config that
   actually ships rather than restating it here, so the two cannot drift. */
describe('the deployed model routing in wrangler.toml', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const value = (key: string): string | undefined =>
    toml.match(new RegExp(`^${key} = "([^"]*)"`, 'm'))?.[1];

  const env = {
    AISAR_MODEL_NAME: value('AISAR_MODEL_NAME'),
    AISAR_DEEP_MODEL_NAME: value('AISAR_DEEP_MODEL_NAME'),
    AISAR_CANDIDATE_MODEL_NAMES: value('AISAR_CANDIDATE_MODEL_NAMES'),
    AISAR_QUICK_MODEL_OVERRIDES: value('AISAR_QUICK_MODEL_OVERRIDES'),
  };

  const overridden = (env.AISAR_QUICK_MODEL_OVERRIDES ?? '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.slice(0, pair.indexOf('=')).trim());

  it('routes every quick override to a model the sprites accept', () => {
    for (const businessId of overridden) {
      expect(routedModelNames(env)).toContain(modelForResponseMode(env, 'quick', businessId));
    }
  });

  it('prices every model it routes, so a run can be billed', () => {
    for (const model of routedModelNames(env)) {
      expect(() => modelCostMicrousd(model, 1_000, 100)).not.toThrow();
    }
  });

  it('leaves deep work on the deep route for an overridden business', () => {
    for (const businessId of overridden) {
      expect(modelForResponseMode(env, 'deep', businessId)).toBe(env.AISAR_DEEP_MODEL_NAME);
    }
  });
});
