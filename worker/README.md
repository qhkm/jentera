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

Every customer agent task still runs through `InlineRuntime`. A private development Sprite
now runs the AISAR runner and pinned Hermes, but has no model-provider credential and is
not connected to a customer. The runtime foundation creates no customer resources by
itself and exposes no provisioning endpoint. Hermes selection stays disabled until the
remaining readiness, browser, automated bootstrap, tool-policy, metering, and recovery
gates in
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
```

`SPRITES_TOKEN` is an organization-scoped API token and must never be placed in a customer
runtime or frontend. `RUNTIME_RELEASE` is immutable; never replace it with `latest`.

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
a provisioning producer until the Hermes rollout gates are complete.
