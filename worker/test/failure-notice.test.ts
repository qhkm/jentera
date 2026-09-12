import { describe, expect, it } from 'vitest';
import {
  classifyRunFailure,
  CREDIT_CAP_NOTICE,
  failureNotice,
  FAILURE_NOTICES,
  isFailureNotice,
} from '../src/runtime/failure-notice';

/* Three runs failed on 2026-09-11 01:21 UTC with the router's own quota
   error; the web chat showed the generic line and Activity showed the raw
   text. Every known upstream failure now maps to one honest, owner-facing
   notice, and only those notices ever reach a page. */
describe('what the owner is told when a run fails', () => {
  const quota = 'HTTP 429: litellm.RateLimitError: RateLimitError: OpenAIException - ' +
    'Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage.';

  it('names the provider quota, the context limit, an outage and a misconfiguration', () => {
    expect(classifyRunFailure(quota)).toBe('provider_quota');
    expect(classifyRunFailure('HTTP 429: Too Many Requests')).toBe('provider_quota');
    expect(classifyRunFailure("This model's maximum context length is 128000 tokens")).toBe('context_limit');
    expect(classifyRunFailure('HTTP 503: Service Unavailable')).toBe('provider_unavailable');
    expect(classifyRunFailure('fetch failed: connection timed out')).toBe('provider_unavailable');
    expect(classifyRunFailure('HTTP 401: Missing Authentication header')).toBe('model_auth');
    expect(classifyRunFailure('run vanished (Hermes returned not_found)')).toBe('generic');
    expect(classifyRunFailure('')).toBe('generic');
    expect(classifyRunFailure('Request payload too large: max compression attempts (3) reached.')).toBe('payload_limit');
  });

  it("keeps the business's own credit cap distinct from the provider's quota", () => {
    expect(classifyRunFailure('runtime budget exceeded (input_tokens)')).toBe('capped');
    expect(classifyRunFailure('{"error":{"type":"budget_exceeded"}}')).toBe('capped');
    expect(failureNotice('runtime budget exceeded (cost)')).toBe(CREDIT_CAP_NOTICE);
    expect(failureNotice(quota)).toBe(FAILURE_NOTICES.provider_quota);
    expect(failureNotice(quota)).not.toMatch(/litellm|OpenAIException|HTTP 429/);
  });

  it('recognises its own notices and nothing else', () => {
    expect(isFailureNotice(FAILURE_NOTICES.provider_quota)).toBe(true);
    expect(isFailureNotice(CREDIT_CAP_NOTICE)).toBe(true);
    expect(isFailureNotice(quota)).toBe(false);
    expect(isFailureNotice(null)).toBe(false);
  });
});
