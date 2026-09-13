import { modelCostMicrousd } from './runtime/usage';

function token(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Native DeepSeek and OpenAI-compatible cache counters; never trust malformed
 * counters to discount a request. No prompt content or cache is stored here. */
export function cachedPromptTokens(usage: Record<string, unknown>): number | null {
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const native = token(usage.prompt_cache_hit_tokens);
  const cached = native ?? token(details?.cached_tokens);
  const total = token(usage.prompt_tokens);
  if (cached === null || total === null || cached > total) return null;
  if (native !== null && usage.prompt_cache_miss_tokens !== undefined) {
    const missed = token(usage.prompt_cache_miss_tokens);
    if (missed === null || missed !== total - native) return null;
  }
  return cached;
}

/** Peak-rate estimate, discounting only provider-confirmed cached input.
 * Reservations stay worst-case; off-peak discounts are not assumed. */
export function modelUsageCostMicrousd(model: string, usage: Record<string, unknown>): number {
  const input = token(usage.prompt_tokens) ?? 0;
  const output = token(usage.completion_tokens) ?? 0;
  if (model !== 'deepseek-flash') return modelCostMicrousd(model, input, output);
  const cached = cachedPromptTokens(usage) ?? 0;
  // $0.30/M miss, $0.006/M hit, $1.20/M output. Round once, in micro-USD.
  return Math.ceil(((input - cached) * 300 + cached * 6 + output * 1200) / 1000);
}
