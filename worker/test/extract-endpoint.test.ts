import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractEndpoint } from '../src/runtime/provision';
import type { Env } from '../src/env';

const env = (over: Record<string, unknown>) => over as unknown as Env;

describe('the web-extraction endpoint handed to a sprite', () => {
  it('is absent when neither field is set, leaving the search-only backend alone', () => {
    /* Every sprite ran this way until 2026-09-10: ddgs answers search and
       cannot read a page, so web_extract failed and the agent drove a
       browser instead. Absent config must keep working, not throw. */
    expect(extractEndpoint(env({}))).toBeNull();
    expect(extractEndpoint(env({ AISAR_EXTRACT_BASE: '  ', AISAR_EXTRACT_KEY: '' }))).toBeNull();
  });

  it('carries both fields when both are set', () => {
    expect(extractEndpoint(env({
      AISAR_EXTRACT_BASE: 'https://extract.kitakod.com',
      AISAR_EXTRACT_KEY: 'a'.repeat(64),
    }))).toEqual({ base: 'https://extract.kitakod.com', key: 'a'.repeat(64) });
  });

  it('refuses an endpoint with no credential', () => {
    /* Firecrawl self-hosted has no authentication of its own, so the bearer
       the proxy checks is the whole boundary. An endpoint without one would
       publish an open fetch-any-URL relay to every sprite. */
    expect(() => extractEndpoint(env({ AISAR_EXTRACT_BASE: 'https://extract.kitakod.com' })))
      .toThrow(/credential/);
  });

  it('refuses a credential with no endpoint, rather than configuring nothing', () => {
    expect(() => extractEndpoint(env({ AISAR_EXTRACT_KEY: 'a'.repeat(64) })))
      .toThrow(/endpoint/);
  });

  it.each([
    ['http://extract.kitakod.com', 'plaintext'],
    ['https://extract.kitakod.com/v2', 'a path'],
    ['https://user:pw@extract.kitakod.com', 'credentials'],
    ['https://extract.kitakod.com?x=1', 'a query'],
    ['extract.kitakod.com', 'no scheme'],
  ])('refuses %s (%s)', (base) => {
    expect(() => extractEndpoint(env({ AISAR_EXTRACT_BASE: base, AISAR_EXTRACT_KEY: 'k'.repeat(64) })))
      .toThrow(/https origin/);
  });

  it('matches what wrangler.toml actually ships', () => {
    /* The deployed value is a string in a config file; read it rather than
       restate it, so a typo fails here instead of at provisioning time. */
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const base = toml.match(/^AISAR_EXTRACT_BASE = "([^"]*)"/m)?.[1];
    expect(base).toBeTruthy();
    expect(() => extractEndpoint(env({
      AISAR_EXTRACT_BASE: base, AISAR_EXTRACT_KEY: 'k'.repeat(64),
    }))).not.toThrow();
  });
});
