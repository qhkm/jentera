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
Hermes task selection stays disabled until the remaining per-runtime model-key,
event/approval-bridge, database-migration, and edge-WAF gates in
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
# Fleet key issuer; use a dedicated OpenRouter management key.
npx wrangler secret put AISAR_OPENROUTER_MANAGEMENT_KEY
# Temporary inference-only key for the single named canary bridge.
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

Customer provisioning requires `AISAR_OPENROUTER_MANAGEMENT_KEY`. The control plane uses
it only against OpenRouter's HTTPS management API to issue one inference key per runtime:
$5 monthly hard limit, 90-day UTC expiry, encrypted-at-rest storage, seven-day rotation,
durable prior-key revocation retry, and deletion-time revocation. Plaintext inference
keys are transferred through the authenticated Sprites filesystem API into a mode-0600
runtime file; they never enter the repository, browser, queue payload, or logs. See
OpenRouter's official [create](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
and [delete](https://openrouter.ai/docs/api/api-reference/api-keys/delete-keys) contracts.

`AISAR_MODEL_KEY` is only a temporary bridge for the exact business UUID in
`RUNTIME_SHARED_MODEL_KEY_BUSINESS_IDS`. The current canary key has a $10 weekly ceiling
and expires on 2026-09-03. Adding a business to the runtime provisioning allow-list does
not grant access to this shared bridge; new fleet provisioning fails closed until the
management secret is configured.

## Abuse and DDoS protection

The Worker rejects abusive requests before session verification, Hyperdrive, email,
Queues, Sprites, or model calls:

- `AUTH_BURST`: 5 requests/minute for authentication, plus durable daily IP/address caps;
- `API_BURST`: 120 requests/minute for the API hostname, including common bot-scan paths;
- `RUNTIME_MUTATION_BURST`: 3 requests/minute, checked against both session-shaped identity
  and source address before provision, reconcile, upgrade, cancel, or delete; and
- 128 KiB declared-body and 8 KiB request-target ceilings, method restrictions, `429`
  responses with `Retry-After`, no-store error responses, and secret-free bounded logs.

Workers rate-limit bindings execute after a Worker invocation and are per-colo burst
brakes, not exact global quotas. A Cloudflare zone WAF rate-limiting rule for
`api.jentera.ai` is still required to stop floods before invocation. The current Wrangler
OAuth credential has Worker/zone-read access but no WAF ruleset read/edit permission, so
that zone change could not be safely inspected or applied from this rollout.

`pnpm waf:dry-run` renders the reviewed Free-plan rule. `pnpm waf:apply` installs or
updates only its stable rule reference and refuses to overwrite another Free-plan rule.
Application requires `CLOUDFLARE_ZONE_ID` and a `CLOUDFLARE_API_TOKEN` with Zone WAF Read
and Write. The rule caps non-verified, non-static traffic at 100 requests per 10 seconds
per IP/colo before Worker invocation; stricter route-specific limits remain inside the
Worker.

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

Migration `015_runtime_safety.sql` adds RLS-protected per-business budgets and usage,
terminal retry exhaustion, durable cancellation, and encrypted per-runtime model-key
metadata with tracked revocation. Apply it transactionally with the reviewed target guard:

```bash
AISAR_NEON_OWNER_URL='postgresql://neondb_owner:...@.../neondb?sslmode=require' \
  pnpm db:migrate:runtime-safety
```

The script refuses any host, database, or username other than AISAR's reviewed production
owner target and prints no connection details. As of 2026-08-28, migration 015 is ready
but not applied because this workstation has no saved owner password. Do not deploy the
Worker safety release until it succeeds.

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
