/* What an owner is told while their workspace wakes.

   Playful on purpose — the owner chose a rotating mix on 25 September — and
   honest about the wait: a cold start measured 10–25 s the week before
   (docs/reply-latency.md), so every line says about twenty seconds. Shown
   only from the path that knows the sprite is still waking, never on a warm
   start.

   One line per run, chosen from its id, so the checks every couple of
   seconds while the sprite wakes never flip the text. This English set is
   for Telegram and for app builds older than the `wake` status kind; the app
   shows its own translated set (`ask.wake.*`), picked the same way. */
export const WAKE_LINES = [
  '☕ Jentera was on a kopi break — back at your desk in ~20 seconds.',
  '🔧 Warming up the jentera… first message after a break takes ~20 s.',
  '🥱 Just woke up — stretching and switching on. ~20 seconds.',
  '🏃 Running back to the office — almost there (~20 s).',
] as const;

/** A stable index for a run id; app/src/lib/wake-line.ts does the same. */
export function wakeLineIndex(runId: string, count: number): number {
  let sum = 0;
  for (const char of runId) sum = (sum + char.charCodeAt(0)) % 997;
  return sum % count;
}

export function wakeLine(runId: string): string {
  return WAKE_LINES[wakeLineIndex(runId, WAKE_LINES.length)];
}
