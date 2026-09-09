/** Shared by the static build and client navigation. Never derive public URLs
 * or metadata from account data, query strings, or the current preview host. */
export const SITE_URL = 'https://jentera.ai';
export const SOCIAL_IMAGE = `${SITE_URL}/social/jentera-v1.png`;
export const SOCIAL_ALT = 'Jentera by AISAR. AI staff that works 24/7 for Malaysian businesses.';
export const INDEXABLE_PATHS = ['/', '/connect'] as const;
export const PRIVATE_PATHS = ['/signin', '/onboard', '/setup', '/app'] as const;

/** Files whose committed changes materially alter each public page. The build
 * uses their most recent git commit for sitemap lastmod; it never stamps every
 * deploy with today's date when the page itself did not change. */
export const INDEXABLE_PAGE_SOURCES: Record<(typeof INDEXABLE_PATHS)[number], readonly string[]> = {
  '/': [
    'app/src/routes/Landing.tsx',
    'app/src/lib/landing-content.ts',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/components/landing/WorkIllustration.tsx',
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/connect': [
    'app/src/routes/Connect.tsx',
    'app/src/lib/live-connectors.ts',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/styles/connect.css',
    'app/src/lib/seo.ts',
  ],
};

export interface PageSeo {
  title: string;
  description: string;
  canonical: string | null;
  indexable: boolean;
}

const PAGES: Record<string, Omit<PageSeo, 'canonical' | 'indexable'>> = {
  '/': {
    title: 'Jentera — 24/7 AI staff for Malaysian businesses',
    description: 'AI help for the business you already run. Prepare replies, follow-ups, paperwork and plans with Jentera, in English or Bahasa Malaysia. Built by AISAR.',
  },
  '/connect': {
    title: 'Jentera connections — The tools your business uses',
    description: 'Start with the Jentera web workspace and private Telegram chat. See which business connections are available now and which are still planned.',
  },
  '/signin': { title: 'Sign in to Jentera', description: 'Sign in to your private Jentera business workspace.' },
  '/onboard': { title: 'Introduce your business — Jentera', description: 'Tell Jentera about your business and the work you need help with.' },
  '/setup': { title: 'Set up your workspace — Jentera', description: 'Review your business details and prepare your private Jentera workspace.' },
  '/app': { title: 'Your business workspace — Jentera', description: 'Your private Jentera workspace for conversations, work records and business details.' },
};

export function normalisePath(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
}

export function pageSeo(pathname: string): PageSeo {
  const path = normalisePath(pathname);
  const indexable = INDEXABLE_PATHS.some((item) => item === path);
  return {
    ...(PAGES[path] ?? { title: 'Page not found — Jentera', description: 'This page is not available. Return to Jentera to find what you need.' }),
    canonical: indexable ? `${SITE_URL}${path === '/' ? '/' : path}` : null,
    indexable,
  };
}

export function metaEntries(path: string): Array<{ attribute: 'name' | 'property'; key: string; content: string }> {
  const seo = pageSeo(path);
  return [
    { attribute: 'name', key: 'description', content: seo.description },
    { attribute: 'name', key: 'robots', content: seo.indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' },
    { attribute: 'property', key: 'og:type', content: 'website' },
    { attribute: 'property', key: 'og:site_name', content: 'Jentera' },
    { attribute: 'property', key: 'og:locale', content: 'en_MY' },
    { attribute: 'property', key: 'og:title', content: seo.title },
    { attribute: 'property', key: 'og:description', content: seo.description },
    // Private links intentionally share the public product, never an account,
    // task UUID, sign-in token or other query parameter.
    { attribute: 'property', key: 'og:url', content: seo.canonical ?? `${SITE_URL}/` },
    { attribute: 'property', key: 'og:image', content: SOCIAL_IMAGE },
    { attribute: 'property', key: 'og:image:secure_url', content: SOCIAL_IMAGE },
    { attribute: 'property', key: 'og:image:type', content: 'image/png' },
    { attribute: 'property', key: 'og:image:width', content: '1200' },
    { attribute: 'property', key: 'og:image:height', content: '630' },
    { attribute: 'property', key: 'og:image:alt', content: SOCIAL_ALT },
    { attribute: 'name', key: 'twitter:card', content: 'summary_large_image' },
    { attribute: 'name', key: 'twitter:title', content: seo.title },
    { attribute: 'name', key: 'twitter:description', content: seo.description },
    { attribute: 'name', key: 'twitter:image', content: SOCIAL_IMAGE },
    { attribute: 'name', key: 'twitter:image:alt', content: SOCIAL_ALT },
  ];
}

export function structuredData(path: string): Record<string, unknown> | null {
  const seo = pageSeo(path);
  if (!seo.indexable) return null;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': 'https://aisar.ai/#organization', name: 'AISAR', url: 'https://aisar.ai/' },
      { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'Jentera', inLanguage: 'en-MY', publisher: { '@id': 'https://aisar.ai/#organization' } },
      { '@type': 'WebPage', '@id': `${seo.canonical}#webpage`, url: seo.canonical, name: seo.title, description: seo.description,
        inLanguage: 'en-MY', isPartOf: { '@id': `${SITE_URL}/#website` } },
      ...(normalisePath(path) === '/' ? [{ '@type': 'SoftwareApplication', name: 'Jentera', url: `${SITE_URL}/`,
        applicationCategory: 'BusinessApplication', operatingSystem: 'Web', description: seo.description,
        provider: { '@id': 'https://aisar.ai/#organization' }, image: SOCIAL_IMAGE }] : []),
    ],
  };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

export function seoHead(path: string): string {
  const seo = pageSeo(path);
  const data = structuredData(path);
  return [
    `<title>${escapeHtml(seo.title)}</title>`,
    ...metaEntries(path).map(({ attribute, key, content }) => `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`),
    ...(seo.canonical ? [`<link rel="canonical" href="${seo.canonical}" />`] : []),
    ...(data ? [`<script id="jentera-structured-data" type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ');
}
