import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
const template = await readFile(new URL('index.html', dist), 'utf8');
if (!template.includes('<!--seo-head-->') || !template.includes('<div id="root"></div>')) throw new Error('Prerender template markers missing');
const vite = await createServer({ root, mode: 'production', appType: 'custom', server: { middlewareMode: true, hmr: false } });
try {
  const { renderPublic, seoHead, INDEXABLE_PATHS, PRIVATE_PATHS, SITE_URL } = await vite.ssrLoadModule('/src/entry-prerender.tsx');
  for (const path of [...INDEXABLE_PATHS, ...PRIVATE_PATHS, '/404']) {
    const publicPage = INDEXABLE_PATHS.includes(path) || path === '/404';
    const html = template.replace('<!--seo-head-->', () => seoHead(path)).replace('<div id="root"></div>', () => publicPage
      ? `<div id="root" data-prerendered="${path}">${renderPublic(path)}</div>` : '<div id="root"></div>');
    if (publicPage && (!html.includes('<h1') || html.includes('The server did not finish this Suspense boundary'))) throw new Error(`Incomplete public render: ${path}`);
    await writeFile(new URL(path === '/' ? 'index.html' : `${path.slice(1)}.html`, dist), html);
    console.log(`Static HTML: ${path} (${publicPage && path !== '/404' ? 'indexable' : 'noindex'})`);
  }
  // Allow crawling so bots can read the noindex on private/unknown routes.
  // robots.txt is discovery guidance, not an authentication boundary.
  await writeFile(new URL('robots.txt', dist), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  await writeFile(new URL('sitemap.xml', dist), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${INDEXABLE_PATHS.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
} finally { await vite.close(); }
