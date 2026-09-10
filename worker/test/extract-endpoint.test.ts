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

  it('tolerates a credential staged before its endpoint, because that is the rollout', () => {
    /* The secret must exist before the config that names it, or the first
       request after enabling the endpoint finds no credential. Treating this
       middle state as an error failed 23 upgrade tasks on 2026-09-10 while
       the fleet was mid-rollout exactly as intended. */
    expect(extractEndpoint(env({ AISAR_EXTRACT_KEY: 'a'.repeat(64) }))).toBeNull();
  });

  it('still refuses an endpoint with no credential — the dangerous half', () => {
    expect(() => extractEndpoint(env({ AISAR_EXTRACT_BASE: 'https://extract.kitakod.com' })))
      .toThrow(/credential/);
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

  it('accepts whatever wrangler.toml ships, when it ships one', () => {
    /* The deployed value is a string in a config file; read it rather than
       restate it, so a typo fails here instead of at provisioning time.
       It is legitimately absent while a rollout is in flight: the field can
       only be sent once every sprite runs a bootstrap that allowlists it, so
       the config is commented out between those two releases. */
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const base = toml.match(/^AISAR_EXTRACT_BASE = "([^"]*)"/m)?.[1];
    if (base === undefined) {
      expect(toml).toMatch(/^# AISAR_EXTRACT_BASE = /m);
      return;
    }
    expect(() => extractEndpoint(env({
      AISAR_EXTRACT_BASE: base, AISAR_EXTRACT_KEY: 'k'.repeat(64),
    }))).not.toThrow();
  });

  it('sends no transfer field the bootstrap cannot parse', () => {
    /* 2026-09-10: provision.ts sent EXTRACT_BASE_B64 with no matching `case`
       arm anywhere, so every sprite rejected its transfer and convergence
       stalled. Every field, not just that one — the next should fail here
       rather than on twelve machines.

       This compares the two files at the same commit, which is the cheap half
       and catches a missing arm. It cannot catch the other shape: a
       provision.ts that has outrun RUNTIME_BUNDLE_COMMIT, since the bootstrap
       a sprite runs is curled from the pin, not from HEAD.
       `check-transfer-fields.mjs` covers that as a predeploy hook. */
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const sent = [...read('../src/runtime/provision.ts')
      .matchAll(/field\('([A-Z0-9_]+_B64)'/g)].map((m) => m[1]);
    const allowlisted = new Set([...read('../../runner/bin/bootstrap-runtime.sh')
      .matchAll(/^\s*([A-Z0-9_]+_B64)\)\s*\1=/gm)].map((m) => m[1]));

    /* Guard the parsers themselves: a regex that silently matches nothing
       would make this test pass for the wrong reason. */
    expect(sent.length).toBeGreaterThan(5);
    expect(allowlisted.size).toBeGreaterThan(5);
    expect(sent.filter((f) => !allowlisted.has(f))).toEqual([]);
  });
});
