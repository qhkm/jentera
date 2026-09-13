/* ============================================================
   When the installed app looks for a newer Jentera.

   A browser checks a service worker's script on navigation and at most
   once a day on its own. An app left open on a phone navigates rarely,
   so a release could sit unseen until the next launch. This asks on
   every return to the foreground and once an hour while open, which is
   what surfaces the update prompt within minutes of a deploy. The
   reload itself still waits for a tap (`registerType: 'prompt'`).
   ============================================================ */

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Starts asking; the returned function stops. */
export function startUpdateChecks(
  registration: ServiceWorkerRegistration,
  doc: Document = document,
): () => void {
  const visible = () => doc.visibilityState === 'visible';
  const check = () => {
    if (!visible()) return;
    /* A refused check (offline, a bad response) is the next check's
       problem, not the page's. */
    void registration.update().catch(() => undefined);
  };
  const onVisibility = () => {
    if (visible()) check();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
  };
}
