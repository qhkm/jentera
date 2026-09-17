# Jentera / aisar Release Playbook

Standardized procedure for shipping a new runtime release (hermes pin bump,
runner bundle change, or worker change that touches the fleet). Built from the
2026.09.05-1 incident: bootstrap passed a flag the pinned installer had
dropped, all 11 sprites failed deterministically, task re-arm never fired
(transient-only), and exhausted tasks had to be reset by hand.

## The script

`worker/scripts/ship-runtime.sh -m "why this release"` runs every step below
in order and stops at the first failure, naming it. `--dry-run` does only the
pin edit and the gate; `--reset-exhausted` is step 6; `--no-sweep` leaves the
trigger to the cron. The steps stay written out here so a run that fails in
the middle can be finished by hand, and so rollback has a recipe.

## The moving parts

- **`worker/wrangler.toml`** — `RUNTIME_RELEASE` (fleet target) and
  `RUNTIME_BUNDLE_COMMIT` (runner asset pin, 40-hex, must exist on GitHub).
- **`worker/src/runtime/provision.ts`** — `HERMES_TAG_B64` / `HERMES_COMMIT_B64`
  (hermes pin), model pins, and the asset list downloaded from
  `raw.githubusercontent.com/qhkm/jentera/<bundle-commit>/...` on **every**
  provision/upgrade run (never cached).
- **`runner/bin/bootstrap-runtime.sh`** — sprite-side bootstrap; bakes
  `hermes_installer_sha256` pin for the installer fetched from hermes commit.
- **Drift sweep** (`*/15 * * * *`) — publishes `upgrade:<biz>:<release>` tasks
  for drifted runtimes. Exhausted tasks re-arm **only** when `last_error`
  matches `TRANSIENT_TASK_ERROR_RE` (`src/runtime/tasks.ts`) — deterministic
  bootstrap failures DO NOT re-arm.

## Release steps

1. **Bump the hermes pin** in `worker/src/runtime/provision.ts` (tag + full
   commit). Update `runner/bin/bootstrap-runtime.sh`'s installer sha256 pin if
   the installer changed (run step 3 to find out).
2. **Commit** — conventional prefix (`fix(runtime):`, `chore(release):`).
3. **Run the gate**: `node worker/scripts/validate-release.mjs` — MUST print
   `GATE PASSED`. It verifies: bundle commit exists, Herbs tag resolves to the
   pinned commit, installer sha256 matches the bootstrap pin, and every flag
   the bootstrap passes is accepted by the pinned installer (the
   `--force-commit` bug class fails here).
4. **Push the branch.** Note: raw.githubusercontent.com can 404 new SHAs for
   ~2 min after push (object index lag) — re-run the gate if it 404s.
5. **Deploy**: `cd worker && pnpm exec wrangler deploy`.
6. **Reset exhausted tasks if a previous attempt of this release blocked**:
   ```sql
   update runtime_task set status='queued', attempt=0, lease_token=null,
     lease_expires_at=null, available_at=now() + interval '60 seconds',
     updated_at=now(), last_error=null
   where kind='upgrade' and status='exhausted'
     and (dedupe_key like 'upgrade:%:RUNTIME_RELEASE' or dedupe_key like 'upgrade:%:RUNTIME_RELEASE:%');
   ```
   (via `unset PGOPTIONS; psql "$(neonctl connection-string ...)"` — stats.sh
   pins the session read-only, which also breaks pooled URLs.)
7. **Trigger the sweep** instead of waiting up to 15 minutes for the cron:
   `curl -X POST https://api.jentera.ai/api/support/drift-sweep -H "Authorization: Bearer $AISAR_SUPPORT_KEY"`.
8. **Watch convergence**: `./worker/scripts/watch-release-converge.sh
   RUNTIME_RELEASE` (background + notify). Converged = every live runtime
   `observed_release == desired_release`.
9. **Verify every sprite**: `./worker/scripts/fleet-verify.sh RUNTIME_RELEASE`
   checks runtime.env, the runner's /readyz release, the Hermes patch verify,
   and that hermes and aisar-runner are running.

## Clean spare inventory after a release

Assigned pooled runtimes (`aisar-p-<32 hex>`) are ordinary customer runtimes:
the DB-backed sweep, convergence watch and fleet verification include them.
The legacy `--from-sprites` path filters only `aisar-b-` and cannot prove fleet
health once pooled runtimes are assigned.

Unassigned inventory is separate from `agent_runtime` and is **not** upgraded
by the tenant drift sweep. Claiming requires the exact current release and
bundle. On a pin change, the pool refill quarantines obsolete entries, which
still occupy its bounded budget. Normal signups fall back to cold provisioning;
do not force assignment of a stale spare or relax the pin check.

The release policy is discard/refill, not re-bootstrap or reuse. With migration
060 and `RUNTIME_SPARE_POOL_RECOVERY_ENABLED=true`, bounded queue jobs attest
clean prepared state, delete only never-assigned unused resources, and confirm
provider absence before freeing inventory. `ship-runtime.sh` then also waits
for current-pin ready inventory to reach the configured target. Unsafe or
uncertain resources stay quarantined and generate a throttled operator alert;
those still require manual review. Resolve their exact identity and remove only
the unused resource before explicitly retiring its entry with the owner role.
Do not retire first and assume cleanup happened, and never delete or retire an
assigned resource. See
[runtime-spare-pool.md](runtime-spare-pool.md) for the bounds, safe pilot,
monitoring and manual cleanup requirements. Recovery is separately gated;
without it, include manual cleanup review in every release while the pool is on.

## Rollback

1. Point `RUNTIME_BUNDLE_COMMIT` (and/or `RUNTIME_RELEASE`) back at the last
   good commit, deploy, reset exhausted tasks (step 6), watch (step 7).
2. Rollback to an **older** hermes pin still works: the bootstrap probes the
   installer for `--force-commit` and only passes it when supported (old
   installers guard rollback pins; new ones dropped the flag).
3. After assigning a pooled runtime, retain pool-aware Worker code, migration
   059 and its once-used tombstones. Disable the global pool flag to stop new
   claims/refill; never roll the Worker back to pre-pool code or an unsupported
   bundle. Already-assigned customers must retain their recorded resource
   identity and tenant credentials. Review leftover unassigned resources
   separately; turning the flag off does not delete them or cancel installation
   already in progress.

## Rules learned the hard way

- **Never** pass an installer flag unconditionally in bootstrap-runtime.sh —
   probe the checksum-pinned installer first.
- The drift sweep is NOT a repair loop for deterministic errors. A blocked
   release stays blocked until tasks are reset or the failure becomes
   transient.
- A tenant at its monthly model cap gets 429 `budget_exceeded` from our own
   proxy on every call, including the bootstrap's model smoke. Until release
   2026.09.09-2 that read as broken inference and the capped business could
   not take a release (NEOREKA, 2026-09-09). `model-smoke.py` now treats that
   exact refusal, from our proxy only, as endpoint-and-credential proven.
- Every release touches the bundle commit; if the commit isn't pushed, sprites
   download 404s. The gate's asset checks catch this (after CDN lag).
- Upgrade-task payload carries only `{release, reason}` — the bootstrap script
   is fetched fresh from the bundle commit at execution time, so a redeploy +
   task reset is always sufficient (no stale script on sprites).
