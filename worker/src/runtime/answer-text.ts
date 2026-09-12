/** The readable answer a finished task carries, bounded. Shared by the run
    detail and the chat transcript so both read a result the same way. */
export function answerText(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result.trim().slice(0, 20_000);
  if (result && typeof result === 'object') {
    const text = (result as Record<string, unknown>).text;
    if (typeof text === 'string' && text.trim()) return text.trim().slice(0, 20_000);
  }
  return 'Jentera completed the work but returned no readable answer.';
}
