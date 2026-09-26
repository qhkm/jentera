/* Which of the `ask.wake.*` lines a run shows while its workspace wakes.

   One line per run, chosen from its id, so the checks every couple of
   seconds while the sprite wakes never flip the text. The Worker picks its
   English line for Telegram the same way (worker/src/runtime/wake-lines.ts),
   so a run reads the same in both places. */
export const WAKE_LINE_COUNT = 4;

export function wakeLineIndex(runId: string, count: number): number {
  let sum = 0;
  for (const char of runId) sum = (sum + char.charCodeAt(0)) % 997;
  return sum % count;
}
