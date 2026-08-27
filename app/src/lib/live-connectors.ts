/* ============================================================
   Which connectors actually do something.

   The catalogue in each playbook lists what a business of that type
   typically uses — WhatsApp, Instagram, Google Calendar, a POS. That
   is a useful thing to show. What it must not do is let someone mark
   one "Connected" when connecting it does nothing, which is what the
   toggle did: it wrote a name into a list and turned the tag green.

   `worker/src/connectors.ts` is the authority, and it says plainly
   that every execute body but one is a stub pending OAuth app
   registrations. This mirrors that, and the test beside it fails if
   the two disagree.
   ============================================================ */

/**
 * Connectors with a real implementation behind them.
 *
 * Adding one means: implement its execute body in the Worker, add a
 * connect flow like TelegramConnect, then add its name here. In that
 * order — a name here without the other two puts the old lie back.
 */
export const LIVE_CONNECTORS = new Set(['Telegram']);

export function isLive(name: string): boolean {
  return LIVE_CONNECTORS.has(name);
}

/**
 * The catalogue subtitle with its connection claim removed.
 *
 * Playbook entries read "Business API · linked", "DM · linked",
 * "linked" — a state, written into static data, that was true of
 * nobody. The part before the separator ("Business API", "DM") is real
 * and worth keeping; the claim is not. A subtitle that is nothing but
 * the claim comes back empty, and the caller renders no subtitle.
 */
export function withoutLinkClaim(subtitle: string): string {
  const head = subtitle.split('·')[0].trim();
  return CLAIMS.has(head.toLowerCase()) ? '' : head;
}

const CLAIMS = new Set(['linked', 'not connected', 'connected']);
