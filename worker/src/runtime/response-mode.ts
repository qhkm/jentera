export type ResponseMode = 'quick' | 'deep';

export function modelForResponseMode(
  env: { AISAR_MODEL_NAME?: string; AISAR_DEEP_MODEL_NAME?: string },
  mode: ResponseMode,
): string {
  const quick = env.AISAR_MODEL_NAME?.trim() ?? '';
  const deep = env.AISAR_DEEP_MODEL_NAME?.trim() || quick;
  const selected = mode === 'quick' ? quick : deep;
  if (!selected) throw new Error('runtime model is not configured');
  return selected;
}

/** Ordinary business chat should feel conversational. Deep reasoning remains
 * available when the owner explicitly asks for research or substantial
 * analysis; `/quick` and `/deep` are deterministic escape hatches. */
export function responseModeFor(input: string): ResponseMode {
  const text = input.trim().toLowerCase();
  if (/^\/quick(?:\s|$)/.test(text)) return 'quick';
  if (/^\/(?:deep|research)(?:\s|$)/.test(text)) return 'deep';

  const deepRequest = [
    /\b(?:deep[ -]?dive|in[ -]?depth|comprehensive|thorough)\b/,
    /\b(?:research|investigate|due diligence)\b/,
    /\b(?:market|competitor|competitive|financial|strategic) analysis\b/,
    /\b(?:business plan|go-to-market|market entry|long-term strategy)\b/,
    /\b(?:compare|evaluate)\b[^\n]{0,80}\b(?:options|vendors|providers|competitors|markets)\b/,
  ].some((pattern) => pattern.test(text));

  return deepRequest ? 'deep' : 'quick';
}
