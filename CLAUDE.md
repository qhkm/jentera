# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` carries the same house rules in shorter form. `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md` and `TECHNICAL_ARCHITECTURE.md` carry product direction — read those before changing what the product *does*, not just how it's built.

## React rebuild (`app/`)

```bash
cd app && pnpm install
pnpm dev        # :5173
pnpm build      # tsc -b && vite build
pnpm typecheck
```

Deploy with `./deploy.sh "msg"` — builds `app/` and publishes to the **`aisar-jentera`** project, live at `jentera.ai`. That project serves two hostnames, `jentera.ai` and `jentera.aisar.ai`, from the same deployment; `deploy.sh` verifies the first. Preview instead with `AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "msg"`. The script verifies the served CSS and JS are real assets, not the SPA fallback HTML, and fails loudly if they are not.

`app/README.md` has the detail. The parts worth knowing here:

- `app/src/lib/data/` is hand-maintained TypeScript. Add a playbook with `scripts/add-playbook.mjs`, which edits `playbooks.ts` directly — don't hand-merge.
- Controls share `--control-h` / `--control-pad-y`. A `text-*` or `py-*` utility on a `.btn`/`.input` overrides the component and breaks the shared height — this caused three separate visual bugs. Let components own their type and padding.
- The old static engine wrote work-done indices as **strings**; the app reads either format and writes strings, so existing users' approvals survive the cutover.
- **Playbook figures are for the anonymous demo only.** Every playbook carries plausible counters, work items and customer conversations; they are the same for every business of a type and move for nobody. Shown to a signed-in owner they are lies, and they were shipped as lies three times: a "4 connections" badge for an account with one, a dashboard that read 82% handled, and an inbox naming customers who do not exist. `useActivity` answers `real` / `pending` / `demo` — branch on `demo` before borrowing anything, and treat `pending` as the real layout with nothing in it. A boolean is what caused this: "not real yet" and "show the demo" are different answers.

## localStorage keys

The full persisted surface. Changing or adding one affects the flow gates, so call it out in the commit.

| Key | Meaning |
|---|---|
| `aisar-onboarded-v1` | `'1'` = onboarding done; `/app` redirects without it |
| `aisar-setup-done-v1` | `'1'` = setup done; drives command-centre stage |
| `aisar-biz-type` | Playbook key |
| `aisar-biz-name`, `aisar-biz-loc` | User overrides on playbook defaults |
| `aisar-channels` | JSON array from onboarding step 4 |
| `aisar-conns` | JSON array of connected connectors (seeded from playbook) |
| `aisar-country`, `aisar-lang` | `'MY'` etc. / `'en'` \| `'bm'` |
| `aisar-approvals` | JSON queue of pending agent actions |
| `aisar-work-done:{bizType}` | Per-playbook completed work, **string indices** |
| `aisar-learn:{key}` | Self-improving demo — counts of user picks |

## Adding a playbook

```bash
node scripts/add-playbook.mjs --file spec.json
```

Only `key` (lowercase/underscore, not `generic`) and `keywords` (3–8 terms, BM + EN) are required. The script injects the new entry into `app/src/lib/data/playbooks.ts` ahead of `generic`, typechecks, and asserts every keyword infers back to the new key.

## Backend (`worker/`)

A Cloudflare Worker serving the `Repository` interface, deployed at
`https://aisar-api.qhkmdev90.workers.dev`. State lives in **Neon Postgres**
(ap-southeast-1) reached through Hyperdrive — not D1; that was the earlier
design. The app still runs fully without it, on `LocalRepository`; setting
`VITE_API_URL` routes through the Worker instead.

Two invariants hold the tenancy model up, and both are load-bearing:

- **`resolveTenant` is the only source of a business id.** No route may read
  one from a request body. That was the hole this replaced.
- **RLS is forced on every tenant table**, scoped by a transaction-local
  `app.business_id` that only `withTenant` sets. The predicates in route SQL
  are deliberate belt-and-braces, not the actual boundary.

**Hyperdrive query caching is disabled on the `aisar-db` config, and must
stay disabled.** It is on by default and caches plain SELECTs for ~60s.
`verifySession`, `resolveTenant` and the password lookup all run outside a
transaction, so all three were cacheable — meaning a logout would not take
effect until the entry expired, and a revoked session kept authenticating.
It surfaced as a freshly verified account still being told it was
unverified; the database said one thing and the Worker read another.
Hyperdrive is here for connection pooling, which is unaffected.

There are three ways in — magic link, password, and Google — and all three
converge on the same session cookie, so nothing downstream distinguishes
them. `email_verified` is what keeps them safe together: a password alone
never proves ownership of an address, only consuming a link or Google
asserting it does. Signing up on an address that already exists never
overwrites its password and never says so, and Google claiming an
*unverified* account clears whatever password it held — otherwise someone
could register against a stranger's address and wait for them to arrive.

Auth is a magic link: the token is stored SHA-256 hashed, single-use via a
conditional UPDATE, and exchanged for an HttpOnly/Secure/SameSite=Lax session
cookie. Because the cookie travels cross-origin, `ALLOWED_ORIGINS` must list
each origin exactly — a wildcard is rejected by the browser outright.

`/api/auth/request` is rate limited three ways: an edge burst binding
(5/60s per IP), and Postgres counters of 50/24h per IP and 10/24h per
address. IP limits answer 429; the per-address one answers 204, because
its counter includes requests made by anyone for that address and a 429
would leak third-party activity. `MAX_OUTSTANDING` in `auth.ts` is a
separate, stricter short-range brake on concurrent live links.

**Still missing, and known:** connector execution is stubbed in
`src/connectors.ts` for everything but Telegram, pending OAuth
registrations. `app/src/lib/live-connectors.ts` mirrors that list, and
its test reads this directory rather than restating it, so the
Connections tab offers a working button only where something is behind
it.

Webhook verification is done — this line used to say it was not.
`verifyWebhook` compares a stored per-connection secret in constant
time. Stored rather than derived from `CREDENTIAL_KEY`, because
deriving it would break every live webhook on a key rotation.

### Where work runs

`src/runtime/` is the seam. `run.runtime` and `run.model` are snapshots
taken from whichever adapter executed the work, so history stays
truthful after a runtime change — never look them up live.

An adapter reads and reasons; it never writes AISAR data or sends
anything. The control plane decides what to persist and what needs
approval. A runtime that could act directly would be a runtime that
could bypass the approval gate.

`test/orchestration.test.ts` exercises the real control-plane path:
`testEnv()` points Hyperdrive at the test container, so `withTenant`,
RLS and the transactions all run for real. Only the model and outbound
HTTP are faked — the two things that would otherwise leave the machine.
Prefer that over stubbing the data layer; the bugs here have all been
in the seams a stub would hide.

The queue consumer runs far from Neon: `placement.region` covers HTTP
invocations only, and a tenant transaction that costs 60 ms in a route
cost 1.1 to 2.3 s there (measured 2026-09-10). Anything on the reply's
critical path therefore runs in the placed HTTP handler — the app intake
runs the first slice of a run itself and hands the rest to the queue — and
the consumer is for what can afford to be slow: long runs, retries,
recovery.

`docs/reply-latency.md` is where reply time and channel parity live: the
path a message takes, what Telegram and app chat share, dated measurements
and the levers tried. `worker/scripts/reply-latency.sh` reproduces its
numbers; re-run it before quoting them.

`test/runtime.test.ts` runs a contract over every adapter in one list.
A new runtime is added there and either passes or is not finished.

The spec (`2026-08-26-hermes-sprites-runtime.md`) specifies
`startRun/resumeRun/cancelRun/streamEvents`. Those describe a runtime
that outlives its request; the inline one cannot implement them
meaningfully, so they arrive with the first adapter that needs them
rather than as stubs nothing verifies. `mode` is how a caller will tell
the two apart.

### Shipping to sprites

One path, no exceptions. A fleet change lands on main, then
`worker/scripts/ship-runtime.sh -m "why"` pins that commit as the bundle,
bumps `RUNTIME_RELEASE`, runs the release gate, commits, pushes, deploys the
worker, triggers the drift sweep, waits for convergence, and runs
`fleet-verify.sh` on every sprite. `--dry-run` stops after the gate.
`docs/release-playbook.md` is the same procedure written out, with rollback.

Nothing is applied to a sprite by hand. A sprite's Hermes checkout and
runner directory survive re-bootstrap exactly as they are, so a hand-applied
change is invisible to the next release and a removed one lingers:
background review had to be switched off on twelve sprites before it was
pinned in `configure-model-provider.py`, and retiring the wire-order patch
needed an explicit unpatch stage because the patched files were still there.
If it must be true on every sprite, it goes in the bundle. `fleet-exec.sh
'snippet'` is for reading state and for one-off cleanups the next release
makes permanent; it iterates correctly under zsh and closes stdin, which the
ad hoc loops it replaces did not.

### Routines

Owner-scheduled jobs, v1 deterministic (SQL over the tenant's own records,
no model, no sprite). Postgres is the scheduler: `routine.next_run_at` is
the clock, the one-minute cron in `index.ts` calls `dispatchDueRoutines`,
and the cross-tenant due scan is a `SECURITY DEFINER` function that returns
nothing but ids. Everything else runs inside `withTenant` under a row lock.
Behind `ROUTINES_ENABLED` and `AISAR_ROUTINES_BUSINESS_IDS`; the contract,
amendments and acceptance gate live in `docs/plans/2026-09-09-routines-api-v1.md`.

### Looking at production

```bash
./worker/scripts/stats.sh            # signups, businesses, runs, connections
./worker/scripts/stats.sh users      # per-account: playbook, plan, runs, conns
./worker/scripts/stats.sh runs 20 | runtimes | usage
./worker/scripts/stats.sh sql "select ..."
```

Credentials come from `neonctl` (already logged in) or `AISAR_NEON_OWNER_URL`.
It connects as `neondb_owner` on purpose — RLS scopes every tenant table to
`app.business_id`, so `aisar_app` outside `withTenant` counts nothing. The
session sets `default_transaction_read_only`, so the owner connection cannot
write; that's a server-side guard, not a regex over the query.

### Testing the worker

```bash
cd worker && pnpm test     # needs Docker running
```

The suite runs a throwaway Postgres in Docker and applies `migrations/`
in order, including `000_role.sql`, which is the only description
anywhere of the `aisar_app` role and its grants.

**Assert as `aisar_app`, arrange as `owner`.** `harness.ts` hands out
both. RLS does not exist for a superuser, so a test that asserts as the
owner passes while production leaks — that split is the point of the
harness, not a convenience.

Tests import the production queries (`claimGoogleIdentity`,
`countAndRecord` take a connection rather than an `Env` for this
reason) instead of copying the SQL. A copied query is a test that keeps
passing while the real one drifts.

Still worth an end-to-end run against the deployed API for anything
touching routes, asserting status codes on every write — sending them
to `/dev/null` hid a 500 on every policy write for two full runs.

Magic links are really delivered. `RESEND_API_KEY` holds a key scoped to
`sending_access` on jentera.ai alone, so a leak cannot send as the other
domains on that Resend account. jentera.ai carries SPF, DKIM and DMARC
(`p=quarantine` since 2026-09-09, aggregate reports to
admin@kitakodventures.com). Resend is the only sender: the apex has no MX
and no SPF, DKIM is signed as jentera.ai with the `resend` selector, and the
return path is send.jentera.ai, which aligns under relaxed SPF. Gmail's
Authentication-Results on a real magic link read dkim=pass, spf=pass,
dmarc=pass before the flip. Any new sender must go through Resend or carry
its own aligned DKIM, or its mail lands in spam.

Unsetting the secret falls back to logging the link to `npx wrangler tail`,
which is how to test without sending. Resend's `delivered@resend.dev`
simulates a delivery and is the right recipient for load tests: a bounce
from a made-up address would damage the sending reputation being tested.

## Conventions

- TypeScript + React under `app/`, two-space indent, semicolons, single quotes, camelCase.
- Import shared modules via the `@/` alias rather than long relative paths.
- Preserve `prefers-reduced-motion` handling and accessibility labels.
- Commits: Conventional Commit subjects, one visible behaviour per commit.

## Gotchas

- `_next/static/` are deployed artifacts from an upstream Next.js build that is **not in this repo**. Treat as opaque. The React app does not load them — its design system was extracted into `design-system/` and reimplemented.
- The landing page is English-only; only the dashboard is bilingual.
