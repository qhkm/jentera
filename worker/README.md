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
- website ingestion and fast grounded Ask AISAR through the inline runtime, plus an
  explicit durable "Work on this" path through each business's Hermes runtime;
- encrypted connector credentials;
- a verified Telegram webhook, real Telegram sends, permissions, approvals, edited
  drafts, and durable Hermes replies for businesses with ready runtimes; and
- the provider-neutral runtime foundation, Fly Sprites REST provider, durable runtime
  tasks, leases, and Cloudflare Queue consumer.

## Ask versus durable work

**Ordinary Ask AISAR remains inline for every business.** It answers a grounded question
in about 1.5 seconds and never wakes a Sprite. The separate **Work on this** action is
guarded by the fleet emergency switch, requires that business's ready runtime, and creates
an idempotent durable Hermes task.

The browser receives lifecycle progress over an authenticated, tenant-scoped hibernating
WebSocket: `queued`, `waking`, `working`, `retrying`, then a terminal state. It makes one
final tenant-scoped HTTP read for the result; bounded polling is recovery only when the
WebSocket cannot be established or is interrupted. The browser Work path currently
streams lifecycle rather than tokens; automatic private Telegram replies use ephemeral
Telegram live drafts for incremental Hermes output.

The pinned Hermes runtime advertises `run_events_sse`, `tool_progress_events`, and real
message deltas. The runner is the sole subscriber to Hermes's destructive event queue and
allow-lists only bounded `message.delta` text into process memory. It discards
`reasoning.available`, tool/approval events, unknown events, and the terminal transcript
before the Worker can see them. Chat is an interface; `run`, `run_event`, and
`work_record` remain the queryable source of truth.

Every production business runtime boots in `full-tools` mode with the complete tool bundle resolved
from the pinned Hermes release. This includes live web research, code execution, terminal,
files, browser, memory, skills, delegation, and any other API-server tools in that pin.
The runner exposes assistant text and bounded native-style tool lifecycle previews; raw
reasoning, full tool arguments/results, and terminal transcripts do not cross the runtime
boundary. Hermes-native approval requests
are not yet forwarded, so an operation that pauses for approval cannot be resumed through
Telegram. Completing onboarding atomically records the business as onboarded and enqueues
one release-deduplicated provisioning task. Provisioning remains fail-closed behind explicit
enablement, secure model transport, immutable production bootstrap, provider credentials,
and a fleet-wide execution emergency switch.

## Runtime boundaries

`src/runtime/types.ts` is the task-level `RuntimeAdapter`: it reads and reasons but never
writes AISAR state or calls a connector. `src/runtime/provider.ts` owns compute lifecycle.
`src/runtime/tasks.ts` owns durable leases. Queue messages are at-least-once wake-up
signals; `runtime_task` in Postgres is authoritative.

One business gets at most one leased runtime task. Owners and staff share the business
runtime; AISAR does not create one Sprite per login.

Successful status polls do not consume an attempt. Only a real dispatch failure or an
expired lease increments the five-attempt budget. The runner identity is persisted before
the first poll so terminal exhaustion and owner cancellation can stop and meter the remote
run. Primary Queue retries are backed by a DLQ consumer; Postgres leases remain the source
of truth for replay. Terminal usage and run finalization occur only when the exhaustion
compare-and-set proves that worker still owns the lease.

## Customer interaction path

Customers interact with AISAR, never with a Sprite or Hermes endpoint. When an
owner with a ready runtime explicitly chooses Work on this, or when that business's
verified Telegram webhook receives a text message, the control plane creates an
idempotent durable `run` and `runtime_task` and sends only a business/task wake-up signal
to the Queue. Telegram uses connection, chat, and message ids for admission and dedupe;
webhook retries cannot create a second paid Hermes run. The send policy is checked again
when Hermes finishes, before the control plane sends, blocks, or creates an approval. Ordinary
Ask stays inline; Telegram falls back inline only while its runtime is not ready or execution
is globally paused.

The control plane never accepts a business id from the browser for this decision. Queue
messages are wake-up hints only: task kind, payload, run id, and tenant all come from the
leased Postgres row. Each runtime receives a signed five-minute wildcard tool grant bound
to its business and task. Incremental approval translation remains required before tools
that pause for Hermes-native approval can be resumed through Telegram.

Production verification on 2026-08-28 submitted run
`7b3eef5e-95cf-49f5-ad85-532d9641a334` through the same authenticated HTTP path used by
the browser. It completed through `hermes-sprite`, returned a non-empty answer, and
finalized 1,426 input tokens, 109 output tokens, and 99 micro-USD. One transient failure
recovered before completion; healthy polls do not consume the attempt counter.

WebSocket production verification then submitted explicit Work run
`423ee728-c692-427e-99f3-8d75bc4c2a49`. One uninterrupted socket observed
`queued → waking → working → completed`, every frame contained only `version`, `seq`,
`type`, and `at`, and the final tenant-scoped read returned a 242-character answer. Usage
finalized 1,313 input tokens, 122 output tokens, 118,277 runtime milliseconds, and 94
micro-USD. The short-lived verification session was deleted afterward.

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
```

`SPRITES_TOKEN` is a dedicated Sprites API token for the AISAR organization and must never
be placed in a customer runtime or frontend. It authenticates at Fly's edge; authenticated
readiness must report `edgeAuthorizationForwarded: false`, proving the bearer header was
removed before the request reached tenant code. Bootstrap fails before checkpointing,
marking ready, or revoking an old model key if this invariant changes. `RUNTIME_RELEASE`
is immutable; never replace it with `latest`.

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
on-demand rotation before the next active run, post-readiness prior-key revocation with durable retry, and
deletion-time revocation. Plaintext inference
keys are transferred through the authenticated Sprites filesystem API into a mode-0600
runtime file; they never enter the repository, browser, queue payload, or logs. See
OpenRouter's official [create](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
and [delete](https://openrouter.ai/docs/api/api-reference/api-keys/delete-keys) contracts.

The temporary shared `AISAR_MODEL_KEY` bridge was removed from production on 2026-08-28
after the canary received and proved its dedicated key. The old shared key was revoked.

## Abuse and DDoS protection

The Worker rejects abusive requests before session verification, Hyperdrive, email,
Queues, Sprites, or model calls:

- `AUTH_BURST`: 5 requests/minute for authentication, plus durable daily IP/address caps;
- `API_BURST`: 120 requests/minute, checked against both the unverified session-shaped
  identity and source address so rotating fake cookies cannot bypass the IP brake;
- `RUNTIME_MUTATION_BURST`: 3 requests/minute, checked against both session-shaped identity
  and source address before provision, reconcile, upgrade, cancel, or delete; and
- `AGENT_RUN_BURST`: 10 Ask AISAR starts/minute, checked against both keys and failed
  closed because each accepted start can buy compute and model tokens;
- `RUN_STREAM_BURST`: 12 WebSocket handshakes/minute, checked against both keys and failed
  closed, followed by exact limits of eight sockets per run and two per authenticated
  user inside the Durable Object; and
- 128 KiB declared-body and 8 KiB request-target ceilings, method restrictions, `429`
  responses with `Retry-After`, no-store error responses, and secret-free bounded logs.

Workers rate-limit bindings execute after a Worker invocation and are per-colo burst
brakes, not exact global quotas. Failure of the broad binding fails open so health and
ordinary reads remain available; failure of either paid-operation binding fails closed
before provider or model work.

The run-stream Durable Object is reachable only through its Worker binding. The public
upgrade route additionally requires the session, exact browser `Origin`, tenant ownership,
and a Hermes run. Sockets are server-to-browser only, replay at most 64 content-free state
events, reject client messages, and expire after 24 hours. The implementation uses
Cloudflare's [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
so idle connections do not keep object compute active. Rate-limit bindings are a
[per-colo, eventually consistent brake](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
so the exact per-object socket caps remain necessary.

Automatic Telegram replies show activity immediately. Inline replies use
`sendChatAction(typing)` every four seconds with a 30-second cap; durable Hermes replies
refresh typing on each queue poll for group chats. In private chats they preserve the
separate typing status throughout the active stream while mirroring Hermes's native
Telegram presentation: an empty rich `Thinking…` draft, then cumulative rich Markdown
frames sent immediately and thereafter at its 800 ms or 24-new-character threshold. Each
run derives a fresh random 49-bit draft id from its durable task id, and the completed
response replaces the ephemeral preview with one persistent rich message.
Explicit Bot API rejection falls back to the ordinary draft/text methods. Approval-gated
replies never stream because no immediate customer reply has been authorized.

Hermes deltas remain in bounded process memory only: after delivery the task payload is
scrubbed and its result contains delivery metadata, while the final customer-visible
reply is retained once in the structured work audit. The runner accepts only
`message.delta` plus bounded tool lifecycle presentation events and also applies Hermes's
streaming think-tag scrubber across chunk boundaries. Telegram receives native-style tool
start bubbles, while reasoning, full tool arguments/results, and terminal transcripts
never cross the runtime boundary.

Production verification on 2026-08-28 routed Telegram run
`283e203c-f379-4e0c-8bc5-9c8d87557e78` through `hermes-sprite`. Telegram accepted one
reply, usage finalized at 1,501 input and 56 output tokens, the task payload was scrubbed,
and the task retained only `{ "delivery": "sent" }` rather than the Hermes output.

`pnpm waf:dry-run` renders the reviewed Free-plan rule. `pnpm waf:apply` installs or
updates only its stable rule reference and refuses to overwrite another Free-plan rule.
Application requires `CLOUDFLARE_ZONE_ID` and a `CLOUDFLARE_API_TOKEN` with Zone WAF Read
and Write. Stable rule `aisar_dynamic_abuse_v1` was applied on 2026-08-28 and caps
non-verified `/api` traffic at 100 requests per 10 seconds per IP/colo before Worker
invocation. Cloudflare Free rate-limit expressions expose Path and Verified Bot, but not
Host or Method, so the zone rule cannot add an `http.host` clause or exempt `OPTIONS`.
Restricting it to `/api` keeps it away from ordinary Pages routes; stricter route-specific
limits and CORS responses remain inside the Worker.

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
owner target and prints no connection details. Migration 015 was applied transactionally
to production on 2026-08-28. A rollback-only probe then verified the `aisar_app` role sees
zero unscoped rows and exactly its tenant row under forced RLS.

## Deployment checks

After applying migrations and configuring bindings/secrets:

```bash
pnpm typecheck
pnpm test
npx wrangler deploy
curl -fsS https://api.jentera.ai/api/health
```

Onboarding completion is the customer provisioning producer: its business update and
release-deduplicated task are one transaction, followed by a retry-safe Queue signal.
Both runtime queues exist and the Worker consumes the primary and DLQ. Migration
`014_runtime_task_execution.sql` was applied to AISAR production as `neondb_owner` and
verified as `aisar_app` on 2026-08-27; it remains required when restoring or creating an
environment.
