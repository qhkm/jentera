import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appsFlagProblems } from './check-apps-flags.mjs';

// Builds a document with [vars] (aisar-api) and [env.sites.vars] (jentera-sites).
// TURNSTILE_SITE_KEY and both sites ratelimits (BOOKING_BURST, SITES_BURST) are
// present by default — pass { turnstileKey: '' } to omit the key, or
// { ratelimits: [...] } to name only the ratelimits the document should carry.
const NAMESPACES = { BOOKING_BURST: '1007', SITES_BURST: '1008' };
const toml = (api, sites, { turnstileKey = 'k', ratelimits = ['BOOKING_BURST', 'SITES_BURST'] } = {}) =>
  `name = "aisar-api"\n[vars]\n${api}\n\n[env.sites]\nname = "jentera-sites"\n\n[env.sites.vars]\n${sites}\n` +
  (turnstileKey ? `TURNSTILE_SITE_KEY = "${turnstileKey}"\n` : '') +
  ratelimits.map((name) =>
    `\n[[env.sites.ratelimits]]\nname = "${name}"\nnamespace_id = "${NAMESPACES[name]}"\n  [env.sites.ratelimits.simple]\n  limit = 10\n  period = 60\n`).join('');
const A = '4e8c2593-2af2-494f-b157-fec0295a50b5';
const B = '11111111-1111-4111-8111-111111111111';
const vars = (enabled, ids, origin = 'https://s.test') =>
  `APPS_ENABLED = "${enabled}"\nAPPS_BUSINESS_IDS = "${ids}"\nSITES_ORIGIN = "${origin}"`;

test('agrees when both deploys carry the same flags, in any order or case', () => {
  assert.deepEqual(appsFlagProblems(toml(vars('false', `${A},${B}`), vars('false', ` ${B.toUpperCase()} , ${A}`))), []);
});

test('fails when the switch, the list or the origin differ, or the sites block is missing', () => {
  assert.equal(appsFlagProblems(toml(vars('true', A), vars('false', A))).length, 1);
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', `${A},${B}`))).length, 1);
  // 'https/other.test' both differs from the api origin AND fails to parse as
  // an https URL, so it reports two problems, not one.
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', A, 'https/other.test'))).length, 2);
  assert.equal(appsFlagProblems(toml(vars('false', A, ''), vars('false', A, ''))).length, 2);
  assert.deepEqual(appsFlagProblems(`[vars]\n${vars('false', A)}\n`), ['[env.sites.vars] is missing from wrangler.toml']);
});

test('reports a SITES_ORIGIN that does not parse as an https URL, per section', () => {
  // http:// is well-formed, just the wrong scheme — still a problem, not
  // merely an unparseable string. Same malformed origin on both sides means
  // no "differs" problem (they agree), but each section is checked and
  // reported on its own, so two problems.
  assert.equal(appsFlagProblems(toml(vars('false', A, 'http://x.test'), vars('false', A, 'http://x.test'))).length, 2);
});

test('reports a missing or empty TURNSTILE_SITE_KEY on the sites deploy', () => {
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', A), { turnstileKey: '' })).length, 1);
});

test('reports a missing BOOKING_BURST ratelimit on the sites deploy', () => {
  assert.deepEqual(appsFlagProblems(toml(vars('false', A), vars('false', A), { ratelimits: ['SITES_BURST'] })),
    ['[[env.sites.ratelimits]] has no BOOKING_BURST entry']);
});

test('reports a missing SITES_BURST ratelimit on the sites deploy', () => {
  assert.deepEqual(appsFlagProblems(toml(vars('false', A), vars('false', A), { ratelimits: ['BOOKING_BURST'] })),
    ['[[env.sites.ratelimits]] has no SITES_BURST entry']);
  assert.equal(appsFlagProblems(toml(vars('false', A), vars('false', A), { ratelimits: [] })).length, 2);
});

test('does not count a ratelimit named on the main deploy as the sites one', () => {
  const text = toml(vars('false', A), vars('false', A), { ratelimits: ['BOOKING_BURST'] }) +
    '\n[[ratelimits]]\nname = "SITES_BURST"\nnamespace_id = "1008"\n';
  assert.deepEqual(appsFlagProblems(text), ['[[env.sites.ratelimits]] has no SITES_BURST entry']);
});

test('the real wrangler.toml agrees, and is fully configured', () => {
  assert.deepEqual(appsFlagProblems(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')), []);
});
