/**
 * What the owner is told when a run fails.
 *
 * Three runs failed on 2026-09-11 with the router's own quota error ("Token
 * Plan usage limit reached"); the web chat showed a generic line and Activity
 * showed the raw provider text. Neither is right: the owner should learn what
 * kind of thing went wrong and what to do, and no provider detail — hosts,
 * library names, status codes — should reach a page. So every failure maps
 * to one of a few fixed notices here, the notice is what the work record
 * stores and the chat shows, and the raw detail stays on the task for us.
 */

/** The business's own monthly credit cap; the one failure the owner can
    act on. Also the model proxy's `budget_exceeded` refusal. */
export const CREDIT_CAP_NOTICE =
  "⏸ This month's AI credits are used up. While Jentera is pre-launch every " +
  'business gets US$5 of AI credits a month, and they reset on the 1st. ' +
  'Reply here if you need more before then.';

export type FailureKind =
  | 'capped'
  | 'provider_quota'
  | 'context_limit'
  | 'payload_limit'
  | 'provider_unavailable'
  | 'model_auth'
  | 'generic';

export const FAILURE_NOTICES: Record<Exclude<FailureKind, 'capped'>, string> = {
  payload_limit:
    '⚠️ The image or conversation data was too large to send to the AI model. Try a smaller image or start a new chat. Any saved files remain available.',
  provider_quota:
    '⚠️ The AI model provider has hit its own usage limit for now. This is on our ' +
    'side, not your credits. Please try again in a few minutes.',
  context_limit:
    '⚠️ This conversation has grown too long for the model. Start a new chat and ' +
    'ask again.',
  provider_unavailable:
    '⚠️ The AI service is temporarily unavailable. Please try again in a moment.',
  model_auth:
    '⚠️ Jentera could not reach its AI model because of a setup problem on our ' +
    'side. Please try again later.',
  generic: "⚠️ I couldn't complete that reply. Please try again.",
};

const CAPPED = /budget_exceeded|model budget exhausted|runtime budget exceeded/i;
/* Specific before general: "maximum context length" must not read as a
   quota, and the router's "Token Plan usage limit" must not read as a
   context limit. */
const CONTEXT_LIMIT =
  /context[_ ]length|context window|maximum.{0,40}tokens|too many tokens|prompt is too long|input is too long|exceeds? the model/i;
const PROVIDER_QUOTA =
  /usage limit|quota|insufficient[_ ](?:balance|credits|funds)|rate[_ ]?limit|too many requests|http\s*429|http\s*402|payment required/i;
const PROVIDER_UNAVAILABLE =
  /http\s*50[0-4]|service unavailable|temporar(?:y|ily)|unreachable|timed? ?out|overloaded|econn|connection (?:reset|refused|closed)|fetch failed/i;
const MODEL_AUTH = /http\s*401|http\s*403|missing authentication|invalid api key|unauthori[sz]ed|forbidden/i;

export function classifyRunFailure(detail: unknown): FailureKind {
  const text = typeof detail === 'string' ? detail : detail == null ? '' : JSON.stringify(detail);
  if (!text) return 'generic';
  if (CAPPED.test(text)) return 'capped';
  if (/payload too large|model request body.*(?:too large|limit)|model context is too large/i.test(text)) return 'payload_limit';
  if (CONTEXT_LIMIT.test(text)) return 'context_limit';
  if (PROVIDER_QUOTA.test(text)) return 'provider_quota';
  if (MODEL_AUTH.test(text)) return 'model_auth';
  if (PROVIDER_UNAVAILABLE.test(text)) return 'provider_unavailable';
  return 'generic';
}

/** The owner-facing line for a failure detail; never the detail itself. */
export function failureNotice(detail: unknown): string {
  const kind = classifyRunFailure(detail);
  return kind === 'capped' ? CREDIT_CAP_NOTICE : FAILURE_NOTICES[kind];
}

const NOTICES = new Set<string>([CREDIT_CAP_NOTICE, ...Object.values(FAILURE_NOTICES)]);

/** True only for text this module produced — the guard that keeps raw
    provider text off every page. */
export function isFailureNotice(text: unknown): boolean {
  return typeof text === 'string' && NOTICES.has(text);
}
