import type { Env } from './env';

export function isDirectDeepSeek(env: Env): boolean {
  return env.AISAR_MODEL_BASE?.trim() === 'https://api.deepseek.com';
}

export function modelUpstreamCredential(env: Env): string {
  return (isDirectDeepSeek(env) ? env.DEEPSEEK_API_KEY : env.FMCV_UPSTREAM_KEY)?.trim() ?? '';
}

/** Existing runtimes keep their proxy credential and legacy model name. */
export function prepareUpstreamPayload(env: Env, body: Record<string, unknown>): Record<string, unknown> {
  if (!isDirectDeepSeek(env)) return body;
  const next = { ...body };
  if (['deepseek-v4-flash', 'deepseek/deepseek-v4-flash-0731', 'deepseek/deepseek-v4-flash-20260731'].includes(String(next.model))) {
    next.model = 'deepseek-flash';
  }
  const reasoning = body.reasoning as { enabled?: boolean; effort?: string } | undefined;
  delete next.reasoning;
  delete next.provider;
  if (reasoning) {
    next.thinking = { type: reasoning.enabled === false || reasoning.effort === 'none' ? 'disabled' : 'enabled' };
    if (reasoning.effort && reasoning.effort !== 'none') {
      next.reasoning_effort = ['low', 'minimal'].includes(reasoning.effort) ? 'low'
        : ['max', 'ultra'].includes(reasoning.effort) ? 'max' : 'high';
    }
  }
  // Legacy tool transcripts may lack native reasoning_content. DeepSeek rejects
  // these in thinking mode; continue without thinking rather than inventing it
  // or discarding the user's history. Native reasoning is otherwise untouched.
  if (Array.isArray(next.messages) && next.messages.some(message =>
    message?.role === 'assistant' && Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0 && typeof message.reasoning_content !== 'string')) {
    next.thinking = { type: 'disabled' };
    delete next.reasoning_effort;
  }
  return next;
}
