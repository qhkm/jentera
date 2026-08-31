import { describe, expect, it } from 'vitest';
import { modelForResponseMode, responseModeFor } from '../src/runtime/response-mode';

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
