# aisar-api

The Cloudflare Worker control plane behind AISAR. It uses Neon Postgres through
Hyperdrive, derives the active business from an authenticated session, and forces RLS on
tenant-owned tables.

## Local verification

```bash
pnpm install
pnpm typecheck
pnpm test
```

The test suite starts one temporary Postgres 16 container, applies every file in
`migrations/`, and executes application queries as the non-owner `aisar_app` role. Docker
must be running.

## What is real

- magic-link, password, and Google authentication;
- owner/staff membership with a session-derived tenant;
- forced Postgres RLS and server-side repository storage;
- versioned business facts with source, confidence, confirmation, and correction;
- append-only run events and structured work records;
- website ingestion and grounded Ask AISAR through the inline runtime;
- encrypted connector credentials;
- a verified Telegram webhook, real Telegram sends, permissions, approvals, and edited
  drafts; and
- the provider-neutral runtime foundation, Fly Sprites REST provider, durable runtime
  tasks, leases, and Cloudflare Queue consumer.

## What is not live yet

Every customer agent task still runs through `InlineRuntime`. The allow-listed I Run Cafe
business now has one ready production-canary Sprite running the AISAR runner, pinned
Hermes, Chromium, and pinned OpenRouter model `deepseek/deepseek-v4-flash-0731` over
HTTPS. Provisioning is enabled only for that business through four independent gates:
explicit provisioning, secure model transport, immutable production bootstrap, and the
business canary allow-list. The database runtime marker is `hermes-sprite`, but
`runtimeFor()` intentionally continues to select `InlineRuntime` for all customer work.
Hermes task selection stays disabled until the remaining tool-policy, metering,
reconciliation, recovery, and security gates in
`../docs/superpowers/specs/2026-08-26-hermes-sprites-runtime.md` pass.

## Runtime boundaries

`src/runtime/types.ts` is the task-level `RuntimeAdapter`: it reads and reasons but never
writes AISAR state or calls a connector. `src/runtime/provider.ts` owns compute lifecycle.
`src/runtime/tasks.ts` owns durable leases. Queue messages are at-least-once wake-up
signals; `runtime_task` in Postgres is authoritative.

One business gets at most one leased runtime task. Owners and staff share the business
runtime; AISAR does not create one Sprite per login.

## Configuration

Public bindings and variables are in `wrangler.toml`. Secrets are set separately:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CREDENTIAL_KEY
npx wrangler secret put RATE_LIMIT_PEPPER
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SPRITES_TOKEN
npx wrangler secret put AISAR_MODEL_KEY
```

`SPRITES_TOKEN` is a dedicated Sprites API token for the AISAR organization and must never
be placed in a customer runtime or frontend. `RUNTIME_RELEASE` is immutable; never replace
it with `latest`.

Do not use the deprecated `fly auth token` command when creating or rotating Fly
credentials. Create a short-lived, organization-scoped source token with the current CLI:

```bash
flyctl tokens create org --org aisar --name "AISAR Sprites exchange" --expiry 1h
```

Exchange that source token for a dedicated Sprites API token through Fly's Sprites token
API, then pipe the returned Sprite token directly into `wrangler secret put SPRITES_TOKEN`.
Do not print it, put it in shell history, or reuse it as a runtime credential. The deployed
Worker has a dedicated Sprites token, rotated from this scoped flow with the short-lived
exchange token revoked, as of 2026-08-27. See Fly's current
[access-token guidance](https://fly.io/docs/security/tokens/).

Customer provisioning additionally requires `AISAR_MODEL_KEY`. The current canary key is
an inference-only OpenRouter key with a $10 weekly ceiling and an expiry of 2026-09-03;
it must be rotated before expiry. It is injected through Worker secrets and a mode-0600
runtime file, never the repository, browser, queue payload, or logs. Production fleet
rollout requires a management-key workflow that issues a separate capped, expiring key
per runtime rather than copying one shared key into many Sprites.

## Abuse and DDoS protection

The Worker rejects abusive requests before session verification, Hyperdrive, email,
Queues, Sprites, or model calls:

- `AUTH_BURST`: 5 requests/minute for authentication, plus durable daily IP/address caps;
- `API_BURST`: 120 requests/minute for the API hostname, including common bot-scan paths;
- `RUNTIME_MUTATION_BURST`: 3 requests/minute, checked against both session-shaped identity
  and source address before the owner/canary provisioning route; and
- 128 KiB declared-body and 8 KiB request-target ceilings, method restrictions, `429`
  responses with `Retry-After`, no-store error responses, and secret-free bounded logs.

Workers rate-limit bindings execute after a Worker invocation and are per-colo burst
brakes, not exact global quotas. A Cloudflare zone WAF rate-limiting rule for
`api.jentera.ai` is still required to stop floods before invocation. The current Wrangler
OAuth credential has Worker/zone-read access but no WAF ruleset read/edit permission, so
that zone change could not be safely inspected or applied from this rollout.

Before deploying the Queue bindings for the first time, create the primary queue:

```bash
npx wrangler queues create aisar-runtime
npx wrangler queues create aisar-runtime-dlq
```

Both queues were created in the AISAR Cloudflare account on 2026-08-27. The commands are
kept here for a new account or disaster-recovery setup; an already-existing queue should
be treated as success after verifying its exact name.

## Database migrations

Production uses Neon Postgres, not D1. Apply `migrations/*.sql` in filename order using
the database owner. `000_role.sql` must run through `psql` because it creates and grants
the non-owner application role. Never run the Worker through the database owner: owners
bypass RLS unless every table is forced, and using the intended role is part of the
security boundary.

## Deployment checks

After applying migrations and configuring bindings/secrets:

```bash
pnpm typecheck
pnpm test
npx wrangler deploy
curl -fsS https://api.jentera.ai/api/health
```

Do not deploy the runtime Queue configuration until `aisar-runtime` exists. Do not publish
a provisioning producer until the Hermes rollout gates are complete. Migration
`014_runtime_task_execution.sql` was applied to AISAR production as `neondb_owner` and
verified as `aisar_app` on 2026-08-27; it remains required when restoring or creating an
environment.
