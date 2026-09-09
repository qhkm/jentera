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

for (const path of [...publicRoutes, ...privateRoutes, '/404']) {
  const file = path === '/' ? 'index.html' : `${path.slice(1)}.html`;
  const { response, bytes } = base ? await request(path === '/404' ? '/seo-check-page-that-does-not-exist' : `${path}?seo-check=1`) : { bytes: await read(file) };
  if (response) {
    assert.equal(response.status, path === '/404' ? 404 : 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    if (privateRoutes.includes(path)) assert.match(response.headers.get('x-robots-tag'), /noindex/);
    if (publicRoutes.includes(path)) assert.doesNotMatch(response.headers.get('x-robots-tag') ?? '', /noindex/);
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
const sitemap = base ? (await request('/sitemap.xml')).bytes.toString() : (await read('sitemap.xml')).toString();
assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), publicRoutes.map((path) => `https://jentera.ai${path}`));
const robots = base ? (await request('/robots.txt')).bytes.toString() : (await read('robots.txt')).toString();
assert.match(robots, /Sitemap: https:\/\/jentera.ai\/sitemap.xml/);
assert.doesNotMatch(robots, /Disallow: \/(?:app|signin|onboard|setup)/);
console.log('Social image: 1200×630 PNG, byte-verified. Sitemap: public routes only. Robots: crawlable noindex.');
