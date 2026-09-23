/* ============================================================
   Taking the update the owner just asked for.

   `updateServiceWorker` does less than its name and its argument
   suggest: vite-plugin-pwa ignores the `reloadPage` it is given and only
   posts SKIP_WAITING to the waiting worker. The reload comes from a
   listener the plugin installs separately, which fires on `controlling`
   and only when `navigator.serviceWorker.controller` was already set at
   the moment it registered.

   Two live paths get nothing from that listener, and both were
   reproduced against a real build-to-build swap on 23 September:

   - The page was not under a worker when it registered — the session
     that first installs one, or any load after a hard refresh, which
     deliberately leaves the page uncontrolled. The new worker takes
     over, `controllerchange` fires, and the plugin drops it because its
     flag says this was not an update. The owner stays on the old bundle
     with the notice still on screen.
   - Nothing is waiting, because another tab already took the update.
     SKIP_WAITING lands nowhere and no event follows at all.

   So the tap decides, not the flag: take over, then reload when the new
   worker has control — and reload anyway if nothing takes control, which
   is right in the second case because the newer worker is already the
   one serving this page.
   ============================================================ */

/** How long the takeover gets before the reload stops waiting for it.
    Skip-waiting to `controllerchange` measured well under a second; this
    is the ceiling for a tap that must not feel ignored. */
export const TAKEOVER_GRACE_MS = 3000;

export function applyUpdate(
  updateServiceWorker: (reloadPage?: boolean) => Promise<void> | void,
  {
    worker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
    reload = () => window.location.reload(),
    graceMs = TAKEOVER_GRACE_MS,
  }: {
    worker?: ServiceWorkerContainer;
    reload?: () => void;
    graceMs?: number;
  } = {},
): void {
  let reloaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const go = () => {
    if (reloaded) return;
    reloaded = true;
    if (timer !== undefined) clearTimeout(timer);
    worker?.removeEventListener('controllerchange', go);
    reload();
  };
  worker?.addEventListener('controllerchange', go);
  timer = setTimeout(go, graceMs);
  /* The plugin's own reload, where it still runs, only races this one to
     the same page load. A rejected message is the timer's problem. */
  void Promise.resolve(updateServiceWorker(true)).catch(() => undefined);
}
