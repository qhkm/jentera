import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { AppRoutes } from './App';
import { INDEXABLE_PATHS } from './lib/seo';
export { seoHead, escapeXml, pageSeo, alternateLinks, INDEXABLE_PATHS, INDEXABLE_PAGE_SOURCES, PRIVATE_PATHS, SITE_URL } from './lib/seo';

/** Public pages only. Never render an authenticated provider at build time. */
export function renderPublic(path: string): string {
  if (!INDEXABLE_PATHS.some((item) => item === path) && path !== '/404') throw new Error('Cannot prerender a private route');
  return renderToString(<StrictMode><StaticRouter location={path}><AppRoutes /></StaticRouter></StrictMode>);
}
