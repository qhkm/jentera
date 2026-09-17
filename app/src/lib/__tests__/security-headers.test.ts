import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headers = readFileSync('public/_headers', 'utf8');
const policies = [...headers.matchAll(/^  Content-Security-Policy-Report-Only: (.+)$/gm)];
const directives = new Map(policies[0][1].split(';').map((part) => {
  const [name, ...sources] = part.trim().split(/\s+/);
  return [name, sources] as const;
}));

describe('Google-compatible security headers', () => {
  it('keeps one report-only policy without silently enforcing the unvalidated app policy', () => {
    expect(policies).toHaveLength(1);
    expect(headers).not.toMatch(/^  Content-Security-Policy:/m);
    for (const line of headers.split('\n')) expect(line.length).toBeLessThanOrEqual(2_000);
    const names = policies[0][1].split(';').map((part) => part.trim().split(/\s+/)[0]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('allows the modern SDK and debugger for script elements without allowing eval or remote Google workers', () => {
    expect(directives.get('script-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
    expect(directives.get('script-src-elem')).toEqual([
      "'self'", 'https://challenges.cloudflare.com',
      'https://www.googletagmanager.com', 'https://tagmanager.google.com',
    ]);
    expect(policies[0][1]).not.toMatch(/unsafe-eval|script-src(?:-elem)?[^;]*unsafe-inline/);
  });

  it('allows regional analytics collection and preserves the business API and vault endpoints', () => {
    expect(directives.get('connect-src')).toEqual([
      "'self'", 'https://api.jentera.ai', 'wss://api.jentera.ai',
      'https://aisar-api.qhkmdev90.workers.dev', 'wss://aisar-api.qhkmdev90.workers.dev',
      'https://aisar-vault-deposit.qhkmdev90.workers.dev', 'https://www.googletagmanager.com',
      'https://*.google-analytics.com', 'https://analytics.google.com', 'https://*.analytics.google.com',
    ]);
    expect(policies[0][1]).not.toMatch(/doubleclick|googlesyndication|googleadservices|https:\/\/\*\.google\.com/);
  });

  it('allows the documented preview styles and fonts without widening script access', () => {
    expect(directives.get('style-src')).toEqual([
      "'self'", "'unsafe-inline'", 'https://www.googletagmanager.com',
      'https://tagmanager.google.com', 'https://fonts.googleapis.com',
    ]);
    expect(directives.get('font-src')).toEqual(["'self'", 'data:', 'https://fonts.gstatic.com']);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'https:']);
  });

  it('retains embedding, base URL, form submission and MIME protections', () => {
    expect(directives.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(headers).toContain('  X-Frame-Options: DENY');
    expect(headers).toContain('  X-Content-Type-Options: nosniff');
  });
});
