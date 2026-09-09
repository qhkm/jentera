import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

const base = process.env.SEO_BASE?.replace(/\/$/, '');
const dist = new URL('../dist/', import.meta.url);
const publicRoutes = ['/', '/connect'];
const privateRoutes = ['/signin', '/onboard', '/setup', '/app'];
const read = async (file) => readFile(new URL(file, dist));
const request = async (path) => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000), redirect: 'manual' });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
};
const responseText = (bytes) => bytes.toString('utf8');

for (const path of [...publicRoutes, ...privateRoutes, '/404']) {
  const file = path === '/' ? 'index.html' : `${path.slice(1)}.html`;
  const { response, bytes } = base ? await request(path === '/404' ? '/seo-check-page-that-does-not-exist' : `${path}?seo-check=1`) : { bytes: await read(file) };
  if (response) {
    assert.equal(response.status, path === '/404' ? 404 : 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    if (privateRoutes.includes(path)) assert.match(response.headers.get('x-robots-tag'), /noindex/);
    // Pages adds noindex to preview deployments. Keep enforcing indexability
    // on the primary/secondary custom domains and local production emulator.
    if (publicRoutes.includes(path) && !new URL(base).hostname.endsWith('.pages.dev')) {
      assert.doesNotMatch(response.headers.get('x-robots-tag') ?? '', /noindex/);
    }
  }
  const dom = new JSDOM(bytes.toString());
  const doc = dom.window.document;
  const indexable = publicRoutes.includes(path);
  assert.equal(doc.querySelectorAll('title').length, 1);
  assert.equal(doc.querySelectorAll('meta[name=description]').length, 1);
  assert.equal(doc.querySelector('meta[property="og:title"]').content, doc.title);
  assert.equal(doc.querySelector('meta[name="twitter:title"]').content, doc.title);
  assert.equal(doc.querySelector('meta[name="twitter:card"]').content, 'summary_large_image');
  assert.equal(doc.querySelector('meta[property="og:image"]').content, 'https://jentera.ai/social/jentera-v1.png');
  assert.equal(doc.querySelector('meta[property="og:image:width"]').content, '1200');
  assert.equal(doc.querySelector('meta[property="og:image:height"]').content, '630');
  assert(doc.querySelector('meta[property="og:image:alt"]').content.length > 20);
  assert.equal(doc.querySelectorAll('link[rel=canonical]').length, indexable ? 1 : 0);
  if (indexable) {
    assert.equal(doc.querySelector('link[rel=canonical]').href, `https://jentera.ai${path}`);
    assert.doesNotMatch(doc.querySelector('meta[name=robots]').content, /noindex/);
    assert(doc.querySelector('h1'), 'public H1 must exist without JavaScript');
    assert(doc.querySelector('#root').textContent.length > 1000);
    const graph = JSON.parse(doc.querySelector('#jentera-structured-data').textContent);
    assert.equal(graph['@context'], 'https://schema.org');
  } else {
    assert.match(doc.querySelector('meta[name=robots]').content, /noindex/);
    if (path !== '/404') assert.equal(doc.querySelector('#root').innerHTML, '');
  }
  assert.doesNotMatch(bytes.toString(), /<!--seo-head-->|seo-check=1/);
  console.log(`${path}: ${response?.status ?? 'built'} · ${indexable ? 'public HTML + canonical' : 'noindex'}`);
  dom.window.close();
}
const image = base ? (await request('/social/jentera-v1.png')) : { bytes: await read('social/jentera-v1.png') };
if (image.response) { assert.equal(image.response.status, 200); assert.match(image.response.headers.get('content-type'), /image\/png/); }
assert.equal(image.bytes.subarray(1, 4).toString(), 'PNG');
assert.equal(image.bytes.readUInt32BE(16), 1200); assert.equal(image.bytes.readUInt32BE(20), 630);
const expected = await read('social/jentera-v1.png');
assert.equal(createHash('sha256').update(image.bytes).digest('hex'), createHash('sha256').update(expected).digest('hex'));
const sitemapResult = base ? await request('/sitemap.xml') : { bytes: await read('sitemap.xml') };
if (sitemapResult.response) {
  assert.equal(sitemapResult.response.status, 200);
  assert.match(sitemapResult.response.headers.get('content-type'), /(?:application|text)\/xml/);
  assert.match(sitemapResult.response.headers.get('cache-control'), /public/);
  assert.doesNotMatch(sitemapResult.response.headers.get('cache-control'), /no-store/);
}
const sitemap = responseText(sitemapResult.bytes);
const sitemapDom = new JSDOM(sitemap, { contentType: 'application/xml' });
const parserError = sitemapDom.window.document.querySelector('parsererror');
assert.equal(parserError, null, parserError?.textContent);
const entries = [...sitemapDom.window.document.querySelectorAll('url')].map((node) => ({
  loc: node.querySelector('loc')?.textContent ?? '',
  lastmod: node.querySelector('lastmod')?.textContent ?? '',
}));
assert.deepEqual(entries.map(({ loc }) => loc), publicRoutes.map((path) => `https://jentera.ai${path}`));
assert.equal(new Set(entries.map(({ loc }) => loc)).size, entries.length, 'duplicate sitemap URLs');
for (const entry of entries) {
  assert.equal(new URL(entry.loc).origin, 'https://jentera.ai');
  if (entry.lastmod) {
    assert.match(entry.lastmod, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert(Date.parse(entry.lastmod) <= Date.now(), `future sitemap lastmod: ${entry.loc}`);
  }
  if (base) {
    const target = await request(new URL(entry.loc).pathname);
    assert.equal(target.response.status, 200, `sitemap target must return 200: ${entry.loc}`);
    const targetDoc = new JSDOM(responseText(target.bytes)).window.document;
    assert.equal(targetDoc.querySelector('link[rel=canonical]')?.href, entry.loc);
    assert.doesNotMatch(targetDoc.querySelector('meta[name=robots]')?.content ?? '', /noindex/);
    assert(targetDoc.querySelector('h1'), `sitemap target needs rendered content: ${entry.loc}`);
  }
}
sitemapDom.window.close();
const builtSitemap = await read('sitemap.xml');
if (base) assert.equal(createHash('sha256').update(sitemapResult.bytes).digest('hex'), createHash('sha256').update(builtSitemap).digest('hex'));

const robotsResult = base ? await request('/robots.txt') : { bytes: await read('robots.txt') };
if (robotsResult.response) {
  assert.equal(robotsResult.response.status, 200);
  assert.match(robotsResult.response.headers.get('content-type'), /text\/plain/);
  assert.match(robotsResult.response.headers.get('cache-control'), /public/);
  assert.doesNotMatch(robotsResult.response.headers.get('cache-control'), /no-store/);
}
const robots = responseText(robotsResult.bytes);
assert.match(robots, /Sitemap: https:\/\/jentera.ai\/sitemap.xml/);
assert.doesNotMatch(robots, /Disallow: \/(?:app|signin|onboard|setup)/);
console.log('Social image: 1200×630 PNG, byte-verified. Sitemap: canonical 200s with valid lastmod when available. Robots: discoverable and crawlable.');
