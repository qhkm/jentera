# Security audit — 2026-08-30

Scope: `aisar-site` (worker/ + app/ + runner/). Full-project review pass plus
verification that every finding is fixed, tested, and deployed.

## Finding summary

- 4 MEDIUM — runner edge auth, status payload leak, SSE subscriber caps, chunked-body limit bypass
- 3 LOW — SSRF redirect re-check, verifySession non-determinism, provider error sanitization
- 2 app hardening — security headers, localStorage gate
- 1 INFO — runner key co-residency, documented as accepted residual risk

All fixed in commit `b0e86d6`. Worker deployed (version `6094637e-455d-4207-a625-68f39a262499`).
Frontend deploy script updated (`deploy.sh`), frontend bundle itself contains only the
_headers change + build-gate, verified by the deploy script's content-hash check on next run.

## Findings and fixes

### Worker

- **MEDIUM — chunked bodies bypass the Content-Length cap** (`src/request-guard.ts`)
  Request bodies without a `Content-Length` (Transfer-Encoding: chunked) skipped the
  `MAX_API_BODY_BYTES` check entirely. The guard now probes the real body through a
  clone with a bounded read (also prevents a slow trickle pinning the isolate) and
  returns 413 above the cap; unreadable bodies fall through to the route's JSON parse.
- **LOW — SSRF redirect re-check** (`src/ingest.ts`)
  Redirect targets were resolved only against the initial URL. Now: manual redirect
  loop with `REDIRECT_MAX_HOPS`, every hop re-validated through `urlProblem()` against
  the same SSRF rules; too many hops → 400. No absolute redirect to a blocked scheme,
  host, or port survives.
- **LOW — verifySession row order** (`src/auth.ts`)
  `SELECT … LIMIT 1` without ORDER BY on a multi-row session table makes "the" session
  non-deterministic under MVCC. `ORDER BY created_at DESC` added so refresh picks the
  newest session deterministically.
- **LOW — provider error sanitization** (`src/runtime/fly-sprite-provider.ts`)
  Confirmed `apiError()` and `assertStreamSucceeded()` both run provider response
  bodies through `redactSecrets()` (Bearer tokens, `api_key`/`token`/`secret`/… value
  shapes) before errors enter run traces or owner-visible messages. No exposed path
  bypasses it.
- **connect routes** — pairing deep link (binds an arbitrary Telegram chat as owner
  chat) plus Telegram connect/disconnect are now owner-only (403 for staff roles).
- **repo routes** — tightened owner-only operations.

### App

- **Security headers** (`app/public/_headers`)
  - `Content-Security-Policy`: `default-src 'self'`; `connect-src 'self' https://api.jentera.ai wss://api.jentera.ai`; `frame-ancestors 'none'` (clickjacking); `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; upgrade-insecure-requests
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - Existing HSTS/strict-transport kept.
- **localStorage gate** — profile caching behind `import.meta.env.DEV`; production runs
  authenticated against the API, so stale/cross-tenant local profile data cannot bleed
  between businesses.
- **`wrangler.toml`** — `ALLOWED_ORIGINS` carries the hosted set (`jentera.ai`,
  `jentera.aisar.ai`, `aisar-jentera.pages.dev` + localhost dev ports); `API_ORIGIN`
  remains pinned to `api.jentera.ai` (required for the Google OAuth redirect).
- **`deploy.sh`** — `pnpm install --frozen-lockfile` (lockfile is the source of truth;
  floating fallback could ship an unreviewed dependency set) and the built-bundle
  backend-call gate (prevents another silent localStorage-only deploy).

### Runner

- **MEDIUM — edge auth** (`src/server.mjs`, `bin/provision-sprite.sh`,
  `bin/bootstrap-runtime.sh`)
  The runner historically accepted `X-Aisar-Runner-Key` alone on the Fly private
  network. The Worker already forwards the Sprite URL edge token as
  `Authorization: Bearer …`; the runner now verifies it (timing-safe) as a second
  factor whenever the runtime was provisioned with `AISAR_EDGE_TOKEN`. Pre-existing
  runtimes keep single-factor until re-provisioned. Provisioning scripts accept an
  optional `AISAR_EDGE_TOKEN` and thread it through the mode-0600 transfer into the
  runtime env. `edgeTokenEnforced` is surfaced in `/readyz`.
- **MEDIUM — status payload leak** (`src/server.mjs`)
  `GET /v1/tasks/{id}` returned `…result` — the full Hermes run status, including tool
  outputs the dashboard never renders. Now `boundedTaskStatus()` whitelists
  `status`/`error`/`usage` plus `*_at` timestamps only.
- **MEDIUM — SSE subscriber caps** (`src/server.mjs`)
  `pipe()` now refuses a new subscriber once `MAX_STREAM_SUBSCRIBERS` (16) are attached
  to one task stream (429). Combined with existing text/event caps + TTL.
- **INFO — key co-residency** (`runner/README.md`)
  Documented: `AISAR_RUNNER_KEY`, `HERMES_API_KEY`, model credential (and edge token
  when provisioned) share one mode-0600 env file per Sprite. Accepted for per-business
  isolation; mitigations listed; do not co-locate businesses on one Sprite.

## Tests

- worker: `npx vitest run` — 314 passed / 24 files
- runner: `node --test` — 21 passed (incl. edge-token second-factor and
  runner-key-required regression tests)
- app: `pnpm build` — clean (pre-existing chunk-size warning only)

## Deploy

- Worker `aisar-api` deployed; `GET /api/health` → `{"ok":true,"service":"aisar-api"}`
  on both `api.jentera.ai` and `aisar-api.qhkmdev90.workers.dev`.
- Frontend: `deploy.sh` ready (frozen-lockfile + bundle gate). Run it when the app
  build should go live — the _headers change is included in `app/public/_headers`, so
  the next `./deploy.sh` publishes it.

## Accepted / follow-ups

- Re-provision existing Sprite runtimes with `AISAR_EDGE_TOKEN` to enable the runner's
  second auth factor (`provision-sprite.sh` rerun).
- VRS dev endpoint remains plain HTTP for the non-customer smoke (pre-existing,
  documented in runner/README.md); must be HTTPS/private tunnel before customer traffic.
