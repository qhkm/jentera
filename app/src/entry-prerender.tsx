import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { AppRoutes } from './App';
export { seoHead, INDEXABLE_PATHS, PRIVATE_PATHS, SITE_URL } from './lib/seo';

/** Public pages only. Never render an authenticated provider at build time. */
export function renderPublic(path: string): string {
  if (!['/', '/connect', '/404'].includes(path)) throw new Error('Cannot prerender a private route');
  return renderToString(<StrictMode><StaticRouter location={path}><AppRoutes /></StaticRouter></StrictMode>);
}
