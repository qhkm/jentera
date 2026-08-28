#!/usr/bin/env node

/*
 * Idempotently install Jentera's single Free-plan zone rate-limit rule.
 * This deliberately edits one rule by stable `ref`; it never PUTs the whole
 * ruleset, because doing so could erase unrelated dashboard-managed rules.
 */

const API = 'https://api.cloudflare.com/client/v4';
const REF = 'aisar_dynamic_abuse_v1';
const apply = process.argv.includes('--apply');
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

const rule = {
  ref: REF,
  description: 'Jentera: cap non-verified API traffic before Worker invocation',
  // Free rate-limit rules support Path and Verified Bot, but not Host or Method.
  // Restricting to /api keeps this zone-wide rule away from the main Pages site.
  expression: '(not cf.client.bot and (http.request.uri.path eq "/api" or starts_with(http.request.uri.path, "/api/")))',
  action: 'block',
  action_parameters: {
    response: {
      status_code: 429,
      content_type: 'application/json',
      content: '{"ok":false,"err":"too many requests"}',
    },
  },
  ratelimit: {
    characteristics: ['cf.colo.id', 'ip.src'],
    period: 10,
    requests_per_period: 100,
    mitigation_timeout: 10,
  },
  enabled: true,
};

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', rule }, null, 2)}\n`);
  process.exit(0);
}
if (!/^[0-9a-f]{32}$/.test(zoneId ?? '')) {
  throw new Error('CLOUDFLARE_ZONE_ID must be a 32-character zone id');
}
if (!token || token.length < 20) {
  throw new Error('CLOUDFLARE_API_TOKEN with Zone WAF Read and Write is required');
}

const entrypointPath = `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`;
const entrypoint = await request(entrypointPath, { allow404: true });
let result;
if (!entrypoint) {
  result = await request(`/zones/${zoneId}/rulesets`, {
    method: 'POST',
    body: {
      name: 'Jentera zone rate limiting',
      description: 'Rate limits dynamic requests before Workers and origins',
      kind: 'zone',
      phase: 'http_ratelimit',
      rules: [rule],
    },
  });
} else {
  const existing = (entrypoint.rules ?? []).find((candidate) => candidate.ref === REF);
  if (existing) {
    result = await request(
      `/zones/${zoneId}/rulesets/${entrypoint.id}/rules/${existing.id}`,
      { method: 'PATCH', body: rule },
    );
  } else {
    if ((entrypoint.rules ?? []).length >= 1) {
      throw new Error(
        'the Free plan permits one rate-limit rule and a different rule already exists; review it manually',
      );
    }
    result = await request(`/zones/${zoneId}/rulesets/${entrypoint.id}/rules`, {
      method: 'POST',
      body: rule,
    });
  }
}

const installed = (result.rules ?? []).find((candidate) => candidate.ref === REF) ?? result;
process.stdout.write(`${JSON.stringify({
  ok: true,
  ref: installed.ref,
  enabled: installed.enabled,
  action: installed.action,
}, null, 2)}\n`);

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (options.allow404 && response.status === 404) return null;
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.success) {
    const detail = Array.isArray(envelope?.errors)
      ? envelope.errors.map((error) => String(error.message ?? error.code)).join('; ')
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare Rulesets API rejected the request: ${detail.slice(0, 500)}`);
  }
  return envelope.result;
}
