/** Run links come from the server or browser storage, never from title matching. */
export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Continuation context belongs in the prompt, not in the task heading. */
export function taskDisplayTitle(value: string): string {
  const cleaned = value.replace(/^(?:Continue this task:|Teruskan tugasan ini:)\s*/i, '')
    .split(/\s*(?:Previous result:|Hasil terdahulu:)/i)[0].replace(/\s+/g, ' ').trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
}
