import { describe, expect, it, vi } from 'vitest';
import { runsServedBuild } from '@/pwa/served-build';

/** A page as the build writes it: the entry script and its stylesheet. */
function page(...assets: string[]): Document {
  const doc = document.implementation.createHTMLDocument('Jentera');
  for (const asset of assets) {
    if (asset.endsWith('.css')) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://jentera.ai/${asset}`;
      doc.head.append(link);
    } else {
      const script = doc.createElement('script');
      script.type = 'module';
      script.src = `https://jentera.ai/${asset}`;
      doc.head.append(script);
    }
  }
  return doc;
}

const worker = (...precached: string[]) => vi.fn(async () => new Response(
  `self.__WB_MANIFEST=[${precached.map((url) => `{url:"${url}",revision:null}`).join(',')}]`,
  { status: 200 },
));

describe('whether this page runs the build the server has now', () => {
  it('is, when the served worker precaches every asset the page loaded', async () => {
    const fetcher = worker('assets/index-NEW.js', 'assets/index-NEW.css', 'assets/chunk-A.js');
    await expect(runsServedBuild(page('assets/index-NEW.js', 'assets/index-NEW.css'), fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/sw.js', { cache: 'no-store' });
  });

  it('is not, when the served worker is for a later build', async () => {
    const fetcher = worker('assets/index-NEXT.js', 'assets/index-NEW.css');
    await expect(runsServedBuild(page('assets/index-NEW.js', 'assets/index-NEW.css'), fetcher)).resolves.toBe(false);
  });

  it('is not, when only the stylesheet has moved on', async () => {
    const fetcher = worker('assets/index-NEW.js', 'assets/index-NEXT.css');
    await expect(runsServedBuild(page('assets/index-NEW.js', 'assets/index-NEW.css'), fetcher)).resolves.toBe(false);
  });

  it('cannot say so for a page with no built assets, and does not ask', async () => {
    const fetcher = worker('assets/index-NEW.js');
    await expect(runsServedBuild(page(), fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cannot say so when the worker cannot be read', async () => {
    const page1 = page('assets/index-NEW.js');
    await expect(runsServedBuild(page1, vi.fn(async () => { throw new TypeError('offline'); }))).resolves.toBe(false);
    await expect(runsServedBuild(page1, vi.fn(async () => new Response('', { status: 503 })))).resolves.toBe(false);
  });
});
