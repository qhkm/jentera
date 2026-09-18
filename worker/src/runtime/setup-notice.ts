/**
 * What the owner is told about their runtime, and what stays ours.
 *
 * `agent_runtime.last_error` is an operator's field. It carries provider
 * text, host filesystem paths and internal stage names, and it is also
 * where a *warning* is parked on a runtime that is working — a checkpoint
 * that failed after a healthy bootstrap is recorded there deliberately so
 * the release still converges (`markRuntimeReadyWithoutCheckpoint`).
 *
 * On 2026-09-18 three businesses, two of them customers, were shown this on
 * the setup screen while their runtime was `ready`:
 *
 *   Checkpoint failed after a healthy bootstrap; rollback point unchanged:
 *   Failed to create checkpoint: JuiceFS rename clone: rename
 *   /dev/fly_vol/juicefs/data/checkpoints/v37
 *
 * Nothing about that is the owner's to read, or to act on, and the path is
 * ours. So this module is the only thing that turns that column into words
 * for a person, the same way `failure-notice.ts` does for a failed run:
 * a fixed line, never the detail.
 */

/** Runtime states in which the owner genuinely cannot use Jentera yet. */
const UNUSABLE = new Set(['error']);

export const SETUP_NOTICES = {
  retrying:
    '⚠️ Setting up your Jentera hit a problem and it is retrying. Nothing for you to do — ' +
    'we can see it. If this is still here in an hour, tell us.',
  capacity:
    '⚠️ Jentera could not get a computer for your business just now. It keeps trying, ' +
    'and we can see it.',
} as const;

const CAPACITY = /capacity|no (?:available )?(?:host|machine|region)|out of (?:memory|capacity)|quota|limit reached/i;

/**
 * The owner-facing line for a runtime, or null when there is nothing they
 * need to know.
 *
 * A stored warning on a working runtime returns null: it is a note to us
 * that the next release should clear, not news for the person whose
 * business is running fine.
 */
export function setupNotice(status: string, lastError: unknown): string | null {
  if (!UNUSABLE.has(status)) return null;
  const text = typeof lastError === 'string' ? lastError : '';
  if (!text.trim()) return SETUP_NOTICES.retrying;
  return CAPACITY.test(text) ? SETUP_NOTICES.capacity : SETUP_NOTICES.retrying;
}

/** True only for text this module produced, so a test can prove nothing
    else reaches the browser. */
export function isSetupNotice(text: unknown): boolean {
  return typeof text === 'string' && (Object.values(SETUP_NOTICES) as string[]).includes(text);
}
