/** Shared by the static build and client navigation. Never derive public URLs
 * or metadata from account data, query strings, or the current preview host. */
export const SITE_URL = 'https://jentera.ai';
export const SOCIAL_IMAGE = `${SITE_URL}/social/jentera-v1.png`;
export const SOCIAL_ALT = 'Jentera by AISAR. AI staff that works 24/7 for Malaysian businesses.';
export const INDEXABLE_PATHS = [
  '/', '/ms', '/pricing', '/about',
  '/connect', '/connect/telegram', '/connect/google-calendar',
  '/privacy', '/terms',
] as const;
export const PRIVATE_PATHS = ['/signin', '/onboard', '/setup', '/app', '/join', '/access', '/waitlist', '/subscribe', '/admin/launch'] as const;

export type IndexablePath = (typeof INDEXABLE_PATHS)[number];

/** Pages that exist in both languages. Every member of a pair must list the
 * whole pair plus x-default, or Google treats the annotation as unconfirmed
 * and ignores it. Pages with no translation get no annotation at all —
 * an hreflang pointing at a language that does not exist is worse than none. */
const TRANSLATIONS: readonly (readonly IndexablePath[])[] = [['/', '/ms']];

/** BM pages. Drives <html lang>, og:locale and the hreflang self-reference. */
const BM_PATHS = new Set<string>(['/ms']);

/** Files whose committed changes materially alter each public page. The build
 * uses their most recent git commit for sitemap lastmod; it never stamps every
 * deploy with today's date when the page itself did not change. */
const CHROME = ['app/src/components/landing/LandingChrome.tsx', 'app/src/lib/landing-content.ts'] as const;
export const INDEXABLE_PAGE_SOURCES: Record<IndexablePath, readonly string[]> = {
  '/': [
    'app/src/routes/Landing.tsx',
    'app/src/lib/landing-content.ts',
    'app/src/lib/launch-offer.ts',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/components/landing/WorkIllustration.tsx',
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/ms': [
    'app/src/routes/LandingMs.tsx',
    'app/src/lib/landing-content-ms.ts',
    'app/src/lib/launch-offer.ts',
    ...CHROME,
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/pricing': [
    'app/src/routes/Pricing.tsx',
    'app/src/lib/launch-offer.ts',
    'app/src/lib/landing-content.ts',
    ...CHROME,
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/about': [
    'app/src/routes/About.tsx',
    'app/src/lib/landing-content.ts',
    ...CHROME,
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/connect': [
    'app/src/routes/Connect.tsx',
    'app/src/components/ConnectorCard.tsx',
    'app/src/components/Icon.tsx',
    'app/src/lib/data/connectors.ts',
    'app/src/lib/connector-catalogue.ts',
    'app/src/i18n/pages.ts',
    'app/src/lib/live-connectors.ts',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/styles/connect.css',
    'app/src/styles/connectors.css',
    'app/src/styles/landing.css',
    'app/src/lib/seo.ts',
  ],
  '/connect/telegram': [
    'app/src/routes/ConnectorPage.tsx',
    'app/src/lib/connector-pages.ts',
    'app/src/lib/live-connectors.ts',
    ...CHROME,
    'app/src/styles/connect.css',
    'app/src/lib/seo.ts',
  ],
  '/connect/google-calendar': [
    'app/src/routes/ConnectorPage.tsx',
    'app/src/lib/connector-pages.ts',
    'app/src/lib/live-connectors.ts',
    ...CHROME,
    'app/src/styles/connect.css',
    'app/src/lib/seo.ts',
  ],
  '/privacy': [
    'app/src/routes/Privacy.tsx',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/styles/privacy.css',
    'app/src/lib/seo.ts',
  ],
  '/terms': [
    'app/src/routes/Terms.tsx',
    'app/src/components/landing/LandingChrome.tsx',
    'app/src/styles/privacy.css',
    'app/src/lib/seo.ts',
  ],
};

export interface PageSeo {
  title: string;
  description: string;
  canonical: string | null;
  indexable: boolean;
  lang: 'en' | 'ms';
}

const PAGES: Record<string, Omit<PageSeo, 'canonical' | 'indexable' | 'lang'>> = {
  '/subscribe': { title: 'Subscribe — Jentera', description: 'Secure Jentera subscription checkout and payment status.' },
  '/admin/launch': { title: 'Launch centre — Jentera', description: 'Private launch administration.' },
  '/waitlist': { title: 'Join the waitlist — Jentera', description: 'Join the Jentera waitlist or redeem an invitation for a three-day trial.' },
  '/access': { title: 'Your access — Jentera', description: 'Review your Jentera access or redeem a trial invitation.' },
  '/': {
    title: 'Jentera — 24/7 AI staff for Malaysian businesses',
    description: 'AI help for the business you already run. Prepare replies, files and everyday business work with Jentera. RM99/month for your first 3 months, then RM199/month.',
  },
  '/ms': {
    title: 'Jentera — Staf AI 24/7 untuk perniagaan Malaysia',
    description: 'Bantuan AI untuk perniagaan yang anda sudah jalankan. Sediakan jawapan, fail dan kerja harian perniagaan bersama Jentera. RM99/bulan untuk 3 bulan pertama, kemudian RM199/bulan.',
  },
  '/pricing': {
    title: 'Pricing — Jentera',
    description: 'RM99/month for your first 3 monthly billing periods, then RM199/month. See what the launch plan includes, what counts as fair use, and how the 10 free chats work.',
  },
  '/about': {
    title: 'About Jentera and AISAR — Kitakod Ventures',
    description: 'Jentera is built by Kitakod Ventures (SSM 202203226187) in Malaysia. Who we are, what AISAR builds, and what Jentera does and does not do today.',
  },
  '/connect': {
    title: 'Jentera connections — The tools your business uses',
    description: 'Start with the Jentera web workspace and private Telegram chat. See which business connections are available now and which are still planned.',
  },
  '/connect/telegram': {
    title: 'Jentera for Telegram — Your private owner chat',
    description: 'Pair a private Telegram chat with your Jentera AI staff. Ask for work and review results from your phone. The chat is for you, the owner — not your customers.',
  },
  '/connect/google-calendar': {
    title: 'Jentera for Google Calendar — Prepare events for review',
    description: 'Let Jentera check your primary Google Calendar and prepare events you approve before they are added. A pilot connection; Google permission verification is pending.',
  },
  '/privacy': {
    title: 'Privacy notice — Jentera',
    description: 'How Kitakod Ventures collects, uses, discloses, stores and protects personal data when you use Jentera.',
  },
  '/terms': {
    title: 'Terms of service — Jentera',
    description: 'Terms for using Jentera, including account responsibilities, AI outputs, connected services, approvals and your legal rights.',
  },
  '/signin': { title: 'Sign in to Jentera', description: 'Sign in to your private Jentera business workspace.' },
  '/onboard': { title: 'Introduce your business — Jentera', description: 'Tell Jentera about your business and the work you need help with.' },
  '/setup': { title: 'Set up your workspace — Jentera', description: 'Review your business details and prepare your private Jentera workspace.' },
  '/join': { title: 'Join your team on Jentera', description: 'Accept an invitation to work in a business on Jentera.' },
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
    lang: indexable && BM_PATHS.has(path) ? 'ms' : 'en',
  };
}

/** The hreflang set for a path, or none when the page has no translation.
 * Each URL is absolute and self-referential, which is what Google requires
 * before it will honour the annotation at all. */
export function alternateLinks(pathname: string): Array<{ hreflang: string; href: string }> {
  const path = normalisePath(pathname);
  const group = TRANSLATIONS.find((paths) => paths.some((item) => item === path));
  if (!group) return [];
  const href = (item: IndexablePath) => `${SITE_URL}${item === '/' ? '/' : item}`;
  return [
    ...group.map((item) => ({ hreflang: BM_PATHS.has(item) ? 'ms-MY' : 'en-MY', href: href(item) })),
    { hreflang: 'x-default', href: href(group[0]) },
  ];
}

export function metaEntries(path: string): Array<{ attribute: 'name' | 'property'; key: string; content: string }> {
  const seo = pageSeo(path);
  return [
    { attribute: 'name', key: 'description', content: seo.description },
    { attribute: 'name', key: 'robots', content: seo.indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' },
    { attribute: 'property', key: 'og:type', content: 'website' },
    { attribute: 'property', key: 'og:site_name', content: 'Jentera' },
    { attribute: 'property', key: 'og:locale', content: seo.lang === 'ms' ? 'ms_MY' : 'en_MY' },
    { attribute: 'property', key: 'og:title', content: seo.title },
    { attribute: 'property', key: 'og:description', content: seo.description },
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

/* ============================================================
   Structured data.

   Every node here must be something the page actually says. A rich
   result that promises a price, a capability or a rating the page does
   not support is the same lie as writing it in the copy, and Google
   penalises it separately.
   ============================================================ */
const ORGANIZATION = 'https://aisar.ai/#organization';

function pageGraph(path: string): Record<string, unknown>[] {
  if (path === '/pricing') {
    return [{
      '@type': 'Product',
      name: 'Jentera',
      description: 'AI staff for Malaysian small businesses. One dedicated computer per subscription.',
      brand: { '@id': ORGANIZATION },
      image: SOCIAL_IMAGE,
      /* An AggregateOffer, not a single RM99 Offer: the introductory price
         is real but temporary, and quoting it alone would advertise a price
         nobody pays from month four. */
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'MYR',
        lowPrice: '99',
        highPrice: '199',
        offerCount: 2,
        availability: 'https://schema.org/InStock',
        url: `${SITE_URL}/pricing`,
        description: 'RM99/month for the first 3 monthly billing periods, then RM199/month. Standard AI usage included; fair-use limits apply.',
      },
    }];
  }
  if (path === '/about') {
    return [{
      '@type': 'Organization',
      '@id': `${SITE_URL}/#publisher`,
      name: 'Kitakod Ventures',
      legalName: 'Kitakod Ventures',
      identifier: 'SSM 202203226187 (003430123-M)',
      url: `${SITE_URL}/about`,
      email: 'hello@kitakodventures.com',
      address: { '@type': 'PostalAddress', addressCountry: 'MY' },
      brand: { '@id': ORGANIZATION },
    }];
  }
  if (path === '/') {
    return [{
      '@type': 'SoftwareApplication',
      name: 'Jentera',
      url: `${SITE_URL}/`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: PAGES['/'].description,
      provider: { '@id': ORGANIZATION },
      image: SOCIAL_IMAGE,
    }];
  }
  return [];
}

export function structuredData(path: string): Record<string, unknown> | null {
  const seo = pageSeo(path);
  if (!seo.indexable) return null;
  const normalised = normalisePath(path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': ORGANIZATION, name: 'AISAR', url: 'https://aisar.ai/' },
      { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'Jentera', inLanguage: 'en-MY', publisher: { '@id': ORGANIZATION } },
      { '@type': 'WebPage', '@id': `${seo.canonical}#webpage`, url: seo.canonical, name: seo.title, description: seo.description,
        inLanguage: seo.lang === 'ms' ? 'ms-MY' : 'en-MY', isPartOf: { '@id': `${SITE_URL}/#website` } },
      ...pageGraph(normalised),
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
    ...alternateLinks(path).map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${href}" />`),
    ...(data ? [`<script id="jentera-structured-data" type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ');
}
