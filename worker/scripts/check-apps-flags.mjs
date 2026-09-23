#!/usr/bin/env node
/**
 * check-apps-flags.mjs — predeploy guard for the two deploys of worker/.
 *
 * aisar-api ([vars]) and jentera-sites ([env.sites.vars]) each carry the apps
 * pilot flags. If they drift, the pilot is half on: the public page is live
 * while the owner routes answer 404, or the reverse. It also catches three
 * ways the sites deploy can be misconfigured and fail silently in
 * production: a SITES_ORIGIN that does not parse as an https URL, a missing
 * Turnstile site key, and a missing BOOKING_BURST ratelimit binding.
 * Runs in `predeploy` and in `deploy:sites`. Exit 0 = the two deploys agree
 * and jentera-sites is configured; exit 1 = do not deploy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The key = "value" pairs of every [section] — enough for vars. */
export function tomlSections(text) {
  const sections = new Map([['', new Map()]]);
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const pair = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (pair) sections.get(current).set(pair[1], pair[2]);
  }
  return sections;
}

const idSet = (value) =>
  [...new Set((value ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean))].sort().join(',');

/** Is `value` a URL wrangler and a browser will both treat as https? */
function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Does the text contain a `[[env.sites.ratelimits]]` array-of-tables entry
    named BOOKING_BURST? A focused line scan rather than a full TOML parser:
    it tracks whether the current header's dotted path starts with
    "env.sites.ratelimits" — true for the array header itself and for its
    `[env.sites.ratelimits.simple]` sub-table — and looks for a `name = "…"`
    line while that holds. */
function hasBookingBurstRatelimit(text) {
  let inRatelimit = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (header) {
      inRatelimit = header[1].trim().startsWith('env.sites.ratelimits');
      continue;
    }
    if (inRatelimit && /^name\s*=\s*"BOOKING_BURST"/.test(line)) return true;
  }
  return false;
}

export function appsFlagProblems(text) {
  const sections = tomlSections(text);
  const api = sections.get('vars') ?? new Map();
  const sites = sections.get('env.sites.vars');
  if (!sites) return ['[env.sites.vars] is missing from wrangler.toml'];
  const problems = [];
  if ((api.get('APPS_ENABLED') ?? '') !== (sites.get('APPS_ENABLED') ?? '')) {
    problems.push(`APPS_ENABLED differs: [vars] "${api.get('APPS_ENABLED') ?? ''}" vs [env.sites.vars] "${sites.get('APPS_ENABLED') ?? ''}"`);
  }
  if (idSet(api.get('APPS_BUSINESS_IDS')) !== idSet(sites.get('APPS_BUSINESS_IDS'))) {
    problems.push('APPS_BUSINESS_IDS differs between [vars] and [env.sites.vars]');
  }

  const apiOrigin = api.get('SITES_ORIGIN') ?? '';
  const sitesOrigin = sites.get('SITES_ORIGIN') ?? '';
  if (!apiOrigin) problems.push('SITES_ORIGIN is missing from [vars]');
  else if (!isHttpsUrl(apiOrigin)) problems.push(`SITES_ORIGIN in [vars] is not an https URL: "${apiOrigin}"`);
  if (!sitesOrigin) problems.push('SITES_ORIGIN is missing from [env.sites.vars]');
  else if (!isHttpsUrl(sitesOrigin)) problems.push(`SITES_ORIGIN in [env.sites.vars] is not an https URL: "${sitesOrigin}"`);
  if (apiOrigin && sitesOrigin && apiOrigin !== sitesOrigin) problems.push('SITES_ORIGIN differs between [vars] and [env.sites.vars]');

  if (!sites.get('TURNSTILE_SITE_KEY')) problems.push('TURNSTILE_SITE_KEY is missing from [env.sites.vars]');
  if (!hasBookingBurstRatelimit(text)) problems.push('[[env.sites.ratelimits]] has no BOOKING_BURST entry');

  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = appsFlagProblems(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL  ${problem}`);
    process.exit(1);
  }
  console.log('ok    apps flags agree between aisar-api and jentera-sites, and jentera-sites is configured');
}
