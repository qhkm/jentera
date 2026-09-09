import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router';
import { PageMetadata } from '@/components/PageMetadata';
import { INDEXABLE_PATHS, PRIVATE_PATHS, SOCIAL_IMAGE, metaEntries, pageSeo, seoHead, structuredData } from '../seo';
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
    expect(landing).toContain('You already built the business.');
    expect(landing).toContain('href="/connect"');
    expect(landing).toContain('<h1');
    expect(renderPublic('/connect')).toContain('MyInvois submission and e-invoicing are not currently available');
    expect(renderPublic('/404')).toContain('Page not found');
    expect(() => renderPublic('/app')).toThrow('Cannot prerender a private route');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Cloudflare private headers and removes the blanket soft-404 rewrite', () => {
    const headers = readFileSync('public/_headers', 'utf8');
    for (const path of PRIVATE_PATHS) expect(headers).toContain(`${path}\n  X-Robots-Tag: noindex, nofollow`);
    const redirects = readFileSync('public/_redirects', 'utf8');
    expect(redirects).not.toMatch(/^\/\*\s+\/index.html\s+200/m);
  });
});
