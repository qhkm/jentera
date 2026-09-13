import { expect, it } from 'vitest';
import { cachedPromptTokens, modelUsageCostMicrousd } from '../src/model-usage';

it('discounts only confirmed DeepSeek cache hits at peak rates', () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 };
  expect(cachedPromptTokens(usage)).toBe(800);
  expect(modelUsageCostMicrousd('deepseek-flash', usage)).toBe(185);
});
it('supports compatible counters, missing usage and invalid cache totals', () => {
  expect(cachedPromptTokens({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 300 } })).toBe(300);
  for (const cached of [-1, 1001, 1.5, '800', null]) {
    const usage = { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: cached };
    expect(cachedPromptTokens(usage)).toBeNull();
    expect(modelUsageCostMicrousd('deepseek-flash', usage)).toBe(420);
  }
  expect(cachedPromptTokens({ prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 900 })).toBeNull();
  expect(modelUsageCostMicrousd('deepseek-flash', {})).toBe(0);
});
it('preserves existing upstream pricing', () => {
  expect(modelUsageCostMicrousd('MiniMax-M3', { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 800 })).toBe(840);
});
