/** Whether this page already runs the build the server has now: the
    service worker it serves precaches every hashed asset the page loaded.

    A waiting worker alone does not mean the page is out of date. Pages load
    from the network first (`sw.ts`), so the first load after a deploy
    already runs the new build while the new worker waits behind the old
    one, and it keeps waiting on every later load until something tells it
    to take over. Offering a reload there reloads into the same build.

    Answers false whenever it cannot tell (no built assets on the page, the
    worker unreadable), so the owner is offered the reload as before.
    `no-store`, because the zone caches /sw.js for four hours. */
export async function runsServedBuild(
  doc: Document = document,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const assets = [...doc.querySelectorAll('script[src*="/assets/"], link[href*="/assets/"]')]
    .map((node) => new URL(node.getAttribute('src') ?? node.getAttribute('href')!, doc.baseURI).pathname.slice(1));
  if (assets.length === 0) return false;
  try {
    const response = await fetcher('/sw.js', { cache: 'no-store' });
    if (!response.ok) return false;
    const worker = await response.text();
    return assets.every((asset) => worker.includes(asset));
  } catch {
    return false;
  }
}
