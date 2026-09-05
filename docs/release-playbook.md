# Jentera / aisar Release Playbook

Standardized procedure for shipping a new runtime release (hermes pin bump,
runner bundle change, or worker change that touches the fleet). Built from the
2026.09.05-1 incident: bootstrap passed a flag the pinned installer had
dropped, all 11 sprites failed deterministically, task re-arm never fired
(transient-only), and exhausted tasks had to be reset by hand.

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
5. **Deploy**: `cd worker && npm run deploy` (or GH Action if billing allows).
6. **Reset exhausted tasks if a previous attempt of this release blocked**:
   ```sql
   update runtime_task set status='queued', attempt=0, lease_token=null,
     lease_expires_at=null, available_at=now() + interval '60 seconds',
     updated_at=now(), last_error=null
   where dedupe_key like 'upgrade:%:RUNTIME_RELEASE' and status='exhausted';
   ```
   (via `unset PGOPTIONS; psql "$(neonctl connection-string ...)"` — stats.sh
   pins the session read-only, which also breaks pooled URLs.)
7. **Watch convergence**: `./worker/scripts/watch-release-converge.sh
   RUNTIME_RELEASE` (background + notify). Converged = all sprites
   `observed_release == desired_release`.

## Rollback

1. Point `RUNTIME_BUNDLE_COMMIT` (and/or `RUNTIME_RELEASE`) back at the last
   good commit, deploy, reset exhausted tasks (step 6), watch (step 7).
2. Rollback to an **older** hermes pin still works: the bootstrap probes the
   installer for `--force-commit` and only passes it when supported (old
   installers guard rollback pins; new ones dropped the flag).

## Rules learned the hard way

- **Never** pass an installer flag unconditionally in bootstrap-runtime.sh —
   probe the checksum-pinned installer first.
- The drift sweep is NOT a repair loop for deterministic errors. A blocked
   release stays blocked until tasks are reset or the failure becomes
   transient.
- Every release touches the bundle commit; if the commit isn't pushed, sprites
   download 404s. The gate's asset checks catch this (after CDN lag).
- Upgrade-task payload carries only `{release, reason}` — the bootstrap script
   is fetched fresh from the bundle commit at execution time, so a redeploy +
   task reset is always sufficient (no stale script on sprites).
