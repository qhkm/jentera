# Security audit — 2026-08-30

Scope: `aisar-site` (worker/ + app/ + runner/). Full-project review and
remediation record. Deployment state is recorded separately below so staged
headers are not described as enforced or live before they are published.

## Finding summary

- 4 MEDIUM — runner edge auth, status payload leak, SSE subscriber caps, chunked-body limit bypass
- 3 LOW — SSRF redirect re-check, verifySession non-determinism, provider error sanitization
- 2 app hardening — staged security headers, persistent profile-storage gate
- 1 INFO — runner key co-residency, documented as accepted residual risk

The original remediation was authored in `b0e86d6`, then reconciled with later
database and UI fixes before release. The CSP remains deliberately Report-Only;
that staging status is not counted as enforcement.

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
- **LOW — verifySession membership order** (`src/auth.ts`)
  A user may belong to more than one business, but `SELECT … LIMIT 1` had no
  deterministic membership order. The query now selects owner memberships before
  staff memberships, then orders by `business_id`. This does not select the newest
  session; the session hash already identifies one session row.
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
  - `Content-Security-Policy-Report-Only` (not enforced yet):
    `default-src 'self'`; explicit script/style/image/font/connect rules;
    `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`;
    `form-action 'self'`; `upgrade-insecure-requests`.
  - `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` are enforced.
  - `Referrer-Policy: no-referrer` is enforced (stricter than
    `strict-origin-when-cross-origin`).
  - No HSTS header is declared in this repository. HSTS should be added only after
    confirming the policy at the Cloudflare zone and all attached hostnames.
- **Persistent profile-storage gate** — business-profile storage uses
  `localStorage` only under `import.meta.env.DEV`. The production anonymous preview
  uses tab-scoped `sessionStorage`; signed-in business state remains server-backed.
  Theme/preview progress therefore survives navigation in one tab without leaving a
  durable business profile for a later browser session.
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

- worker: `pnpm typecheck && pnpm test` — 318 passed / 25 files
- runner: `node --test` — 21 passed (including edge-token second-factor and
  runner-key-required regressions)
- app: `pnpm typecheck && pnpm test && pnpm build` — 215 passed / 26 files;
  production build clean except for the pre-existing chunk-size warning

## Deploy

- Worker `aisar-api` version `53a334d7-057b-4e74-835c-619cf9220a40` deployed
  from the reconciled release. `/api/health` returns 200 on both hostnames;
  three consecutive database-backed session checks completed without the prior
  cross-request I/O exception; an oversized body without `Content-Length`
  returned 413.
- Frontend Pages deployment `cd712608` is live. `jentera.ai` serves bundle
  `/assets/index-DlS9S_in.js`; `/`, `/onboard`, `/setup`, and `/app` return 200.
- Live `/app` headers verified: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and the
  documented `Content-Security-Policy-Report-Only`. CSP enforcement and HSTS
  remain explicit follow-ups rather than completed controls.

## Accepted / follow-ups

- Re-provision existing Sprite runtimes with `AISAR_EDGE_TOKEN` to enable the runner's
  second auth factor (`provision-sprite.sh` rerun).
- VRS dev endpoint remains plain HTTP for the non-customer smoke (pre-existing,
  documented in runner/README.md); must be HTTPS/private tunnel before customer traffic.
