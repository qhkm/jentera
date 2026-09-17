import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import { PageMetadata } from '@/components/PageMetadata';
import { INDEXABLE_PAGE_SOURCES, INDEXABLE_PATHS, PRIVATE_PATHS, SOCIAL_IMAGE, alternateLinks, escapeXml, metaEntries, pageSeo, seoHead, structuredData } from '../seo';
import { CONNECTOR_PAGES, unbackedConnectorPages } from '@/lib/connector-pages';
import { PRICING_QUESTIONS, pricingFaqs } from '@/routes/Pricing';
import { PLAN_BENEFITS_MS } from '@/lib/landing-content-ms';
import { launchOffer, launchPlanBenefits } from '@/lib/launch-offer';
import { renderPublic } from '@/entry-prerender';

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.querySelectorAll('meta, link[rel="canonical"], #jentera-structured-data').forEach((tag) => tag.remove());
});

describe('public SEO and social previews', () => {
  it.each(INDEXABLE_PATHS)('renders complete, unique metadata in raw HTML for %s', (path) => {
    const document = new DOMParser().parseFromString(`<head>${seoHead(path)}</head>`, 'text/html');
    const seo = pageSeo(path);
    expect(document.title).toBe(seo.title);
    expect(document.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(seo.canonical);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(seo.canonical);
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(SOCIAL_IMAGE);
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
    expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
    expect(document.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toContain('Malaysian businesses');
    expect(document.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
    expect(JSON.parse(document.getElementById('jentera-structured-data')!.textContent!)).toEqual(structuredData(path));
  });

  it.each([...PRIVATE_PATHS, '/not-real'])('marks %s noindex without a public canonical or account data', (path) => {
    const head = seoHead(`${path}?token=private-secret&run=private-run`);
    expect(head).toContain('noindex, nofollow');
    expect(head).not.toContain('rel="canonical"');
    expect(head).not.toContain('private-secret');
    expect(head).not.toContain('private-run');
    expect(head).not.toContain('application/ld+json');
  });

  it('canonicalises query strings and trailing slashes without promoting unknown routes', () => {
    expect(pageSeo('/connect/?utm_source=test').canonical).toBe('https://jentera.ai/connect');
    expect(pageSeo('/?ref=test').canonical).toBe('https://jentera.ai/');
    expect(pageSeo('/unknown').indexable).toBe(false);
  });

  it('tracks meaningful source files for every sitemap page and escapes XML values', () => {
    expect(Object.keys(INDEXABLE_PAGE_SOURCES)).toEqual([...INDEXABLE_PATHS]);
    for (const path of INDEXABLE_PATHS) {
      expect(INDEXABLE_PAGE_SOURCES[path].length).toBeGreaterThan(1);
      expect(INDEXABLE_PAGE_SOURCES[path].every((source) => source.startsWith('app/'))).toBe(true);
    }
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
  });

  it('updates metadata across client navigation without duplicates or stale private tags', async () => {
    function Navigate() { const go = useNavigate(); return <><button onClick={() => go('/connect')}>Connections</button><button onClick={() => go('/app?run=secret-id')}>Dashboard</button><button onClick={() => go('/')}>Home</button></>; }
    render(<MemoryRouter><PageMetadata /><Navigate /></MemoryRouter>);
    expect(document.title).toBe(pageSeo('/').title);
    fireEvent.click(screen.getByText('Connections'));
    await waitFor(() => expect(document.title).toBe(pageSeo('/connect').title));
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://jentera.ai/connect');
    fireEvent.click(screen.getByText('Dashboard'));
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'));
    expect(document.head.querySelector('link[rel=canonical]')).toBeNull();
    expect(document.head.innerHTML).not.toContain('secret-id');
    fireEvent.click(screen.getByText('Home'));
    await waitFor(() => expect(document.title).toBe(pageSeo('/').title));
    for (const { attribute, key } of metaEntries('/')) expect(document.head.querySelectorAll(`meta[${attribute}="${key}"]`)).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel=canonical]')).toHaveLength(1);
  });

  it('uses a real 1200×630 PNG, not an SVG or HTML fallback', () => {
    const image = readFileSync('public/social/jentera-v1.png');
    expect(image.subarray(1, 4).toString()).toBe('PNG');
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    expect(image.length).toBeGreaterThan(10_000);
    expect(image.length).toBeLessThan(1_000_000);
  });

  it('provides meaningful public HTML without running an API request', () => {
    const fetch = vi.fn(() => { throw new Error('No network in prerender'); }); vi.stubGlobal('fetch', fetch);
    const landing = renderPublic('/');
    expect(landing).toContain('AI staff that works');
    expect(landing).toContain('hero-hours');
    expect(landing).not.toContain('Purchases are not open yet');
    expect(pageSeo('/').description).not.toContain('Purchases not open yet');
    expect(landing).toContain('RM199');
    expect(landing).not.toContain('chat.whatsapp.com/');
    expect(landing).toContain('href="/connect"');
    expect(landing).toContain('<h1');
    expect(renderPublic('/connect')).toContain('MyInvois submission and e-invoicing are not currently available');
    expect(renderPublic('/privacy')).toContain('Privacy notice');
    expect(renderPublic('/privacy')).toContain('Google sign-in and Google Calendar');
    expect(renderPublic('/terms')).toContain('Terms of service');
    expect(renderPublic('/terms')).toContain('Kitakod Ventures');
    expect(renderPublic('/terms')).toContain('href="/privacy"');
    expect(landing).toContain('href="/terms"');
    expect(renderPublic('/pricing')).toContain('RM199');
    expect(renderPublic('/pricing')).toContain('10 free chat requests');
    expect(renderPublic('/about')).toContain('SSM 202203226187');
    expect(renderPublic('/connect/telegram')).toContain('does not message your customers');
    expect(renderPublic('/connect/google-calendar')).toContain('permission verification');
    const ms = renderPublic('/ms');
    expect(ms).toContain('Staf AI');
    expect(ms).toContain('RM199');
    expect(ms).toContain('href="/"');
    expect(renderPublic('/404')).toContain('Page not found');
    expect(() => renderPublic('/app')).toThrow('Cannot prerender a private route');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Cloudflare private headers and removes the blanket soft-404 rewrite', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    // Public shells revalidate but may be stored; no-store belongs to the
    // authenticated routes below them.
    expect(headers).toMatch(/^\/terms\n  Cache-Control: no-cache, must-revalidate$/m);
    expect(headers).not.toMatch(/^\/(?:|ms|pricing|about|connect|privacy|terms)\n  Cache-Control: [^\n]*no-store/m);
    for (const path of PRIVATE_PATHS) {
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(headers).toMatch(new RegExp(`^${escapedPath}\\n(?:  [^\\n]+\\n)*  X-Robots-Tag: noindex, nofollow$`, 'm'));
    }
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).toMatch(/^\/terms\/\s+\/terms\s+301$/m);
    for (const path of INDEXABLE_PATHS) {
      if (path === '/') continue;
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(redirects).toMatch(new RegExp(`^${escaped}\\/\\s+${escaped}\\s+301$`, 'm'));
    }
    expect(redirects).not.toMatch(/^\/\*\s+\/index.html\s+200/m);
  });
});

describe('secondary public pages', () => {
  it('pairs the two landing languages in both directions and leaves untranslated pages alone', () => {
    for (const path of ['/', '/ms']) {
      const links = alternateLinks(path);
      expect(links.map((link) => link.hreflang)).toEqual(['en-MY', 'ms-MY', 'x-default']);
      // Self-reference: Google ignores the whole annotation without it.
      expect(links.some((link) => link.href === `https://jentera.ai${path === '/' ? '/' : path}`)).toBe(true);
      expect(links.find((link) => link.hreflang === 'x-default')!.href).toBe('https://jentera.ai/');
    }
    for (const path of INDEXABLE_PATHS) {
      if (path === '/' || path === '/ms') expect(alternateLinks(path)).toHaveLength(3);
      else expect(alternateLinks(path)).toHaveLength(0);
    }
    expect(pageSeo('/ms').lang).toBe('ms');
    expect(pageSeo('/pricing').lang).toBe('en');
    expect(metaEntries('/ms').find((entry) => entry.key === 'og:locale')!.content).toBe('ms_MY');
  });

  it('gives every indexable path its own title, description and sitemap sources', () => {
    const titles = INDEXABLE_PATHS.map((path) => pageSeo(path).title);
    expect(new Set(titles).size).toBe(titles.length);
    const descriptions = INDEXABLE_PATHS.map((path) => pageSeo(path).description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const path of INDEXABLE_PATHS) {
      expect(pageSeo(path).title).not.toBe('Page not found — Jentera');
      expect(pageSeo(path).description.length).toBeGreaterThan(60);
      expect(pageSeo(path).description.length).toBeLessThan(320);
    }
  });

  it('only publishes a connector page for a connector that works', () => {
    expect(unbackedConnectorPages()).toEqual([]);
    for (const page of CONNECTOR_PAGES) {
      expect(INDEXABLE_PATHS).toContain(`/connect/${page.slug}`);
      expect(page.limits.length).toBeGreaterThan(2);
      expect(page.related.length).toBeGreaterThan(1);
    }
  });

  it('renders the Bahasa Malaysia page without English chrome or an English plan card', () => {
    const ms = renderPublic('/ms');
    // The chrome is the part that gave the page away: a Malay hero under an
    // English skip link, nav and plan card.
    for (const english of ['Skip to content', 'Sign in', 'Main navigation', 'Jentera home', 'by AISAR', 'Get started']) {
      expect(ms).not.toContain(english);
    }
    for (const malay of ['Terus ke kandungan', 'Log masuk', 'Navigasi utama', 'oleh AISAR', 'Mula sekarang']) {
      expect(ms).toContain(malay);
    }
    for (const benefit of launchPlanBenefits) expect(ms).not.toContain(benefit);
    expect(ms).toContain(PLAN_BENEFITS_MS[0]);
    expect(PLAN_BENEFITS_MS).toHaveLength(launchPlanBenefits.length);
    // Same plan, so the same numbers must survive the translation.
    expect(ms).toContain(`RM${launchOffer.monthlyPrice}`);
    expect(ms).toContain(`RM${launchOffer.renewalPrice}`);
    expect(ms).not.toContain(launchOffer.terms);
  });

  it('keeps the pricing page answering the same questions as the landing FAQ', () => {
    expect(pricingFaqs()).toHaveLength(PRICING_QUESTIONS.length);
  });

  it('describes the launch price as a range rather than the introductory month alone', () => {
    const graph = structuredData('/pricing')!['@graph'] as Record<string, unknown>[];
    const product = graph.find((node) => node['@type'] === 'Product') as Record<string, unknown>;
    const offers = product.offers as Record<string, unknown>;
    expect(offers['@type']).toBe('AggregateOffer');
    expect(offers.lowPrice).toBe('99');
    expect(offers.highPrice).toBe('199');
    expect(offers.priceCurrency).toBe('MYR');
  });
});
