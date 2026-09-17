# Clean Sprite spare pool

Deployed on 2026-09-17. **Not enabled in production yet.** Migration 059
was applied and its restricted permissions verified before the runtime release.
The matching Worker and runtime bundle are live. The isolated clean preparation,
activation, real-task and pool-off retry pilot passed. General enablement and
automatic replenishment are the remaining rollout checks.

## Deployment evidence

- Feature commit: `8ce92c8497af0732ebd1b7bc1280d1968db93710`.
- Release commit: `bcd5514d719bfdf0d888f002fac2d5ffe683c04c`.
- Runtime release: `2026.09.17-3`, using that feature commit as the bundle.
- Worker version: `ec43b4bb-69be-47ea-9ed6-0c6a78fade0b`, deployed at
  09:44 UTC. The deployed version's bindings confirm pool enabled `false`,
  target `2`, and the exact release/bundle above.
- By 09:50 UTC, all 21 live runtime rows were ready and converged. The standard
  release script's DB-backed fleet verification passed 21/21: runtime file
  release, authenticated `/readyz` release, dependency verification, and both
  `hermes` and `aisar-runner` services running. One upgrade recovered from a
  network disconnect through its normal retry; no manual Sprite patching.
- The API health endpoint returned HTTP 200. Signed-out desktop and mobile
  smoke checks covered `/`, `/onboard`, `/setup`, and `/app`, with no page
  errors or horizontal overflow.
- At the initial rollout, production spare inventory was empty. Existing founder test businesses
  already have runtimes; use a separate, real private operator test workspace
  for the activation pilot, not replacement or recycling of one of those
  existing workspaces. General enablement has **not** been verified yet.
- A private preparation completed in 262,841 ms at 10:13 UTC, using the actual
  production preparation code against the published release. Inventory entry
  `aa39ec7b-8d8e-447a-8560-e8b8d012600d` was ready, unassigned and checkpointed
  as `v1`. Read-only inspection verified a `prepared` marker with exact release,
  bundle and Hermes pins, mode `0600`, no tenant environment/config/output files,
  no services and no browser/agent/keepalive processes. The closed metadata
  transfer was removed by the bootstrap's normal exit trap. Dependency patch
  verification passed. No installed runtime files were modified by hand.
- The full backend regression suite passed: 104 files, 1,257 tests, including
  restricted-role inventory concurrency/rollback tests and private-pilot guards.
- Private founder-owned business `f30b5ae5-d73c-42e6-848d-85ab682646c7` claimed
  that exact spare through the restricted tenant transaction. Its normal durable
  provisioning task completed, sealed credentials were present, authenticated
  readiness passed on the target release, and checkpoint `v2` was saved.
  Structured provisioning time was 61,378 ms; the whole private HTTP activation
  request took 67,509 ms. Bootstrap stages were install 1 s, npm 8 s, browser
  checks 2 s, configuration 3 s and smokes 30 s. This is one pilot, not a signup
  latency percentile or an instant-activation promise.
- A deduplicated no-tools AI task completed through the normal consumer and
  model proxy with the requested `POOL_PILOT_OK` response. Hermes started at
  1,718 ms and terminal status was recorded at 3,151 ms from the request.
  The remote-development preview could not publish to its SQLite Durable Object;
  this proves task execution, not the production chat-stream UI.
- Reconciliation with the pool flag off returned ready on the same exact
  resource with unchanged runner/Hermes credentials (40,394 ms). The temporary
  remote-development entry point was stopped after the pilot.

This release changes backend/runtime code only. The existing Pages deployment,
billing configuration, and separately disabled desktop-streaming feature remain
unchanged. Keep the pool flag off until the safe-rollout pilot below passes.

## What changes

Maintain up to two independently created, never-used Sprites. Install the
reviewed Hermes version, dependency patches and Chromium before a customer
arrives. Do not configure a business or start an agent or browser session.

The next verified business's existing provisioning job can claim a ready
spare. Reservation and creation of its `agent_runtime` row happen in one
tenant transaction. Row locks prevent double assignment; transaction rollback
returns an unused reservation. Generate tenant credentials at assignment,
perform the same configuration and authenticated readiness checks as normal,
then take the business's baseline checkpoint.

The minute cron queues replacement preparations in the existing runtime
queue. If no eligible spare exists, or the inventory transaction fails, use
the existing cold-provisioning path. Existing businesses keep their Sprites;
this does not migrate or recycle customer workspaces.

This removes the cold installer and browser download from the customer's
critical path when a spare is available. It does **not** promise instantaneous
activation: queueing, wake, configuration, model/browser health checks and the
final checkpoint still take time. Measure these before quoting a new setup
time. Historical measurements are in [provisioning-time.md](provisioning-time.md).

## Isolation and authority

- Spares have random `aisar-p-<32 lowercase hex>` names, not a fake tenant.
- Preparation transfers only release and Hermes pin metadata. No business ID,
  inference key, runner key, connector credentials, profiles or customer files.
- The filesystem marker refuses any previous Hermes installation at the start
  and checks for sessions, cookies, memories and unexpected files before
  assignment. Only known generic templates from that fresh installer are
  removed, individually. Never sanitize an existing customer's workspace.
- The inventory stores resource identity and lifecycle metadata, not secrets.
  `aisar_app` cannot directly read or mutate it. Narrow security-definer
  functions handle inventory; tenant assignment derives its business ID from
  `withTenant`'s transaction GUC, never a request-supplied override.
- Assigned rows remain permanent once-used tombstones, even after account
  deletion. Reusing a deleted customer's Sprite name is forbidden.
- Pooled inference credentials retain the same signature checks, tenant lookup,
  billing limits and model-proxy enforcement. An unassigned spare cannot infer.
- A missing or dirty assigned spare fails closed **before credential transfer**.
  It is not returned to the pool or silently replaced under the same name.
- Readiness and production Hermes pin remain unchanged:
  `v2026.9.8 @ ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413`.
- No runner/agent service, browser session, public application endpoint or
  keepalive is started during spare preparation. The installed spare is
  allowed to sleep; it is not an always-running computer pool.

## Bounds and failure handling

| Control | Bound |
| --- | --- |
| Target inventory | 1 or 2; default 2 |
| Simultaneous preparations | 1 |
| New preparations per rolling hour | 4, including already-assigned resources |
| Bundle download deadline | 180 seconds + 10-second kill grace |
| Installation deadline | 600 seconds + 10-second kill grace |
| Preparation database lease | 20 minutes, token-fenced completion |
| Ready inventory age | Less than 24 hours |
| Eligible release | Exact current release and bundle commit |

Deadlines run on the Sprite process group, so abandoning an HTTP response
does not leave the download/installer running indefinitely. Provider creation
and checkpoint calls are outside those process deadlines; an expired DB
lease still cannot publish a late preparation as ready.

Duplicate queue deliveries cannot prepare the same entry twice. Failed queue
publishes retain queued rows for a later cron retry. A preparation failure,
expired lease, obsolete pin or expired ready entry is quarantined and still
occupies its inventory budget. This intentionally stops repeated creation
after failures instead of hiding orphan resources or accumulating bills.

V1 does **not** automatically retire or delete quarantined resources. An
operator must review them, confirm the exact provider identity and that the
entry is unassigned, then remove that resource through the provider's normal
management path before explicitly retiring its inventory entry with the
owner role. For an interrupted create where the provider ID was not saved,
resolve the exact recorded random name first; absence of an ID is not proof
that no resource exists. Never retire an assigned entry, never remove a
customer Sprite, and never modify installed runtime files by hand.

Do this review when a release changes or ready spares expire. Quarantine
stops pool replenishment, not normal customer provisioning. Automatic safe
retirement is a separate follow-up, not implemented here.

## Safe rollout

Keep these settings in `worker/wrangler.toml` while publishing and testing:

```toml
RUNTIME_SPARE_POOL_ENABLED = "false"
RUNTIME_SPARE_POOL_TARGET = "2"
```

1. Run Worker typechecks/tests, runner tests and the migration command's
   negative-target tests. Worker tests use an isolated Docker Postgres with
   the real restricted application role, not the production database.
2. Apply migration 059 using `cd worker && pnpm db:migrate:runtime-spares`
   with `AISAR_NEON_OWNER_URL` supplied securely. The command refuses an
   unreviewed owner target, verifies permissions and creates **no compute**.
3. Commit and push only the pool changes. Publish the matching bundle and
   Worker through `worker/scripts/ship-runtime.sh` and its release gate.
   Do **not** deploy the new Worker against the previous bundle: the bundle
   must contain `spare-state.mjs` and the new bootstrap preparation mode.
   Desktop streaming remains governed by its separate, disabled flag.
4. Before general enablement, run a controlled pilot of one clean Sprite
   against that exact published bundle using the preparation code. Inspect
   the closed transfer, prepared marker, fixed Hermes pin, absence of tenant
   files/services/keepalive and versioned checkpoint. Use a private operator
   test business to claim it through the real tenant transaction and verify
   fresh credentials, model-proxy mapping, authenticated readiness and a
   successful task. Also verify retry and pool-off behavior. Do not invent a
   fake business or a hand-patched tenant installation for the pilot.
5. Enable with target **1** only after the pilot passes. Confirm provider
   capacity and actual compute/storage cost. Watch real signup latency and
   refill; raise the target to **2** after observing a healthy replenishment.

Changing only the global pool flag/target does not change any bootstrap input.
Preserve the pilot's exact release and bundle pins for this enablement. After
the flag-only commit is pushed, `ship-runtime.sh --resume` can deploy that
reviewed configuration and run its normal drift sweep, convergence watch and
DB-backed fleet verification without unnecessarily invalidating the spare.
Changes to bootstrap inputs or runtime code still require a new runtime release.

The feature also requires the existing provisioning, bootstrap and model
transport flags, Sprites token, queue binding and strict release/bundle pins.
An incomplete configuration is inert. Enabling the flag authorizes background
creation, so it is a separate deliberate rollout step, not a harmless UI toggle.

## Monitoring and rollback

### Private pilot tooling

`worker/scripts/runtime-spare-pilot.ts` is an operator-only **remote-development
entry point**, not the production Worker main or a public customer API. It
uses the deployed Worker's inherited secrets without returning them, and the
existing Hyperdrive binding as `aisar_app`. Its dedicated support-key check,
closed confirmation bodies and founder-ownership checks run before mutations.
The global production flag stays off throughout the pilot.

Run from `worker/`, with an explicitly reviewed, verified founder user UUID
and a newly generated private business UUID starting with `f`:

```sh
pnpm exec wrangler dev scripts/runtime-spare-pilot.ts --remote \
  --ip 127.0.0.1 --port 8795 --inspector-port 9295 \
  --show-interactive-dev-session false \
  --var SPARE_PILOT_MODE:operator-only \
  --var SPARE_PILOT_OWNER_USER_ID:FOUNDER_USER_UUID \
  --var SPARE_PILOT_BUSINESS_ID:NEW_PRIVATE_BUSINESS_UUID
```

Do not change production `main` or deploy this entry point. Keep the local
proxy loopback-only and stop it after testing. Read the support credential
from its private operator file into request headers in memory, never a URL,
command argument, log or checked-in configuration. HTTP errors must be checked.

The authenticated `GET /status` reports only safe metadata and secret presence.
The following `POST` bodies contain only the indicated confirmation:

| Path | `confirm` | What it proves |
| --- | --- | --- |
| `/prepare` | `prepare-one-clean-spare` | Calls production preparation code with an isolated, captured queue and target 1; never publishes to the public queue |
| `/activate` | `activate-private-pilot` | Creates a real separate founder-owned business and consumes its normal durable provision task; reports success only for a ready pooled runtime with a versioned checkpoint |
| `/run` | `run-private-smoke` | Runs one deduplicated, metered no-tools task through the normal consumer; poll until completed and `responseOk` is true |
| `/retry` | `retry-with-pool-off` | Reconciles the assigned resource with the pool off; requires the same resource and tenant credentials to remain ready |

Inspect the exact unassigned Sprite's clean marker, files, fixed Hermes pin,
services and checkpoint **between preparation and activation**, using read-only
provider commands and the owner-only inventory query. The wrapper cannot read
the global inventory directly as `aisar_app`. A failed/uncertain preparation
must be reviewed rather than repeatedly replaced. The wrapper has no cron,
does not delegate through `SELF`, and captures queue sends instead of creating
a remote development consumer on the production queue.

The private business must be free and have only the existing verified founder
as owner. Name/collision checks refuse other workspaces. Its UUID must sort
after the founder's current default owner workspace, so adding this test
membership cannot change `verifySession`'s default business. Existing business
data, credentials, connections and runtimes are never copied into the pilot.

### Production monitoring

Structured logs report preparation duration and completed provisioning source
(`spare`, `cold`, `upgrade`) plus elapsed milliseconds. The minute cron reports
queued counts and quarantined review counts. These new logs contain no tenant
identity, input text, transfer contents or provider exception bodies.

An owner-only, read-only aggregate inventory check:

```sql
select status, count(*) as entries, min(created_at) as oldest_created_at
from public.runtime_spare
group by status
order by status;
```

For complete tenant fleet checks, use `watch-release-converge.sh` and
`fleet-verify.sh` with the default DB-backed inventory. Old checks that filter
the provider list by `aisar-b-` (including the legacy DB-free watch and
`fleet-exec.sh --from-sprites`) omit assigned `aisar-p-` customers. Do not use
those checks as proof that the entire fleet is healthy or converged. Do not
blindly probe every provider-listed `aisar-p-` name: most are unassigned spares
without a runner, and probing would wake them unnecessarily.

Turning `RUNTIME_SPARE_POOL_ENABLED` off stops new reservations and refill.
Already-assigned customers continue through their recorded resource identity;
installation retries and future upgrades do not require the pool to be on.
In-progress preparation is fenced and bounded but is not instantly cancelled
by a flag change; any resulting unused resource still needs review.

**Do not roll back to a pre-pool Worker after assigning a pooled customer.**
That code rejects the new runtime-name grammar and cannot resolve the spare.
Rollback means leaving pool-aware code and migration 059 installed with the
feature flag off. Never drop its tombstones or substitute another customer's
resource as a recovery shortcut.
