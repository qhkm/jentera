import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { modelUpstreamCredential, prepareUpstreamPayload } from '../src/model-upstream';
import { runtimeModelBaseAllowed } from '../src/runtime/execution';
import { modelCostMicrousd } from '../src/runtime/usage';

const env = { AISAR_MODEL_BASE: 'https://api.deepseek.com', DEEPSEEK_API_KEY: 'direct', FMCV_UPSTREAM_KEY: 'legacy' } as Env;

describe('direct DeepSeek adapter', () => {
  it('selects only the direct credential and exact allowed host', () => {
    expect(modelUpstreamCredential(env)).toBe('direct');
    expect(modelUpstreamCredential({ ...env, DEEPSEEK_API_KEY: undefined })).toBe('');
    expect(runtimeModelBaseAllowed(env.AISAR_MODEL_BASE)).toBe(true);
    expect(runtimeModelBaseAllowed('https://api.deepseek.com.evil.test')).toBe(false);
  });
  it('translates legacy runtime models and Quick mode without mutating input', () => {
    const body = { model: 'deepseek-v4-flash', reasoning: { enabled: false } };
    expect(prepareUpstreamPayload(env, body)).toEqual({ model: 'deepseek-flash', thinking: { type: 'disabled' } });
    expect(body.reasoning).toEqual({ enabled: false });
  });
  it('translates Deep mode while preserving native tool reasoning', () => {
    const messages = [{ role: 'assistant', content: null, tool_calls: [{ id: 'call1' }], reasoning_content: 'native reasoning' }];
    expect(prepareUpstreamPayload(env, { model: 'deepseek-flash', reasoning: { enabled: true, effort: 'high' }, messages })).toEqual({
      model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high', messages,
    });
  });
  it('keeps old tool history usable without fabricating missing reasoning', () => {
    const messages = [{ role: 'assistant', tool_calls: [{ id: 'call1' }] }];
    expect(prepareUpstreamPayload(env, { messages, reasoning: { enabled: true, effort: 'high' } })).toEqual({ messages, thinking: { type: 'disabled' } });
  });
  it('leaves other upstream payloads unchanged', () => {
    const body = { model: 'deepseek-v4-flash', reasoning: { enabled: true } };
    expect(prepareUpstreamPayload({ ...env, AISAR_MODEL_BASE: 'https://router.fmcv.my' }, body)).toBe(body);
  });
  it('reserves at conservative direct-provider peak rates', () => {
    expect(modelCostMicrousd('deepseek-flash', 1_000_000, 1_000_000)).toBe(1_500_000);
  });
});
