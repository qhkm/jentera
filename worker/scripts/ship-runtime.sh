#!/usr/bin/env bash
# ship-runtime.sh — the one way a change reaches every sprite.
#
# A sprite change is anything under runner/ (bootstrap, configure, patch
# script, server) or a pin in worker/src/runtime/provision.ts. Nothing is
# applied to a sprite by hand. The change lands on main; this script pins
# main's commit as the bundle, bumps RUNTIME_RELEASE, runs the release gate,
# commits, pushes, deploys the worker, asks the control plane to sweep now,
# waits for the fleet to converge, and verifies every sprite. It stops at the
# first failing step and names it. Every step is the same as the manual
# procedure in docs/release-playbook.md; this is that document, executable.
#
# Usage:
#   worker/scripts/ship-runtime.sh -m "why this release" [options]
#     -m, --message TEXT    one line for the release commit subject (required)
#     -r, --release ID      release id (default: today's date, next sequence)
#     -b, --bundle SHA      bundle commit (default: origin/main; must be pushed)
#     --dry-run             edit pins in a scratch worktree and run the gate only
#     --no-sweep            do not trigger the drift sweep (wait for the */15 cron)
#     --no-watch            stop after deploy (skip converge and verify)
#     --reset-exhausted     re-queue exhausted upgrade tasks for this release first
#                           (a release blocked by a deterministic bootstrap error
#                           stays blocked until this runs; see the playbook)
#
# Needs: git with push rights on main, node, pnpm or npx, wrangler auth,
#        psql plus AISAR_NEON_OWNER_URL (or a logged-in neonctl) for the
#        watch, verify and reset steps, and the support key in
#        AISAR_SUPPORT_KEY or ~/.config/jentera/support-key for sweep-now.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MESSAGE=""
RELEASE=""
BUNDLE=""
DRY_RUN=0
SWEEP=1
WATCH=1
RESET_EXHAUSTED=0

usage() { sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "ship-runtime: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) MESSAGE="${2:?}"; shift 2 ;;
    -r|--release) RELEASE="${2:?}"; shift 2 ;;
    -b|--bundle) BUNDLE="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-sweep) SWEEP=0; shift ;;
    --no-watch) WATCH=0; shift ;;
    --reset-exhausted) RESET_EXHAUSTED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ship-runtime: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$MESSAGE" ]] || { usage >&2; die "-m/--message is required"; }
[[ "$MESSAGE" == *$'\n'* ]] && die "message must be one line"

# ---- 0. what main says right now ------------------------------------------
step "preflight"
git -C "$ROOT" fetch -q origin || die "git fetch failed"
MAIN_SHA="$(git -C "$ROOT" rev-parse origin/main)"
if [[ -z "$BUNDLE" ]]; then
  BUNDLE="$MAIN_SHA"
else
  BUNDLE="$(git -C "$ROOT" rev-parse --verify "$BUNDLE^{commit}" 2>/dev/null)" \
    || die "bundle commit not found locally"
  git -C "$ROOT" merge-base --is-ancestor "$BUNDLE" origin/main \
    || die "bundle $BUNDLE is not on origin/main; sprites download from GitHub, so push it first"
fi
CURRENT_TOML="$(git -C "$ROOT" show origin/main:worker/wrangler.toml)"
CURRENT_RELEASE="$(sed -n 's/^RUNTIME_RELEASE = "\(.*\)"$/\1/p' <<<"$CURRENT_TOML")"
CURRENT_BUNDLE="$(sed -n 's/^RUNTIME_BUNDLE_COMMIT = "\(.*\)"$/\1/p' <<<"$CURRENT_TOML")"
[[ -n "$CURRENT_RELEASE" && -n "$CURRENT_BUNDLE" ]] || die "could not read the pins from origin/main's wrangler.toml"
API_ORIGIN="$(sed -n 's/^API_ORIGIN = "\(.*\)"$/\1/p' <<<"$CURRENT_TOML")"

if [[ -z "$RELEASE" ]]; then
  today="$(date +%Y.%m.%d)"
  last=0
  for id in "$CURRENT_RELEASE" $(git -C "$ROOT" log --format=%s -200 origin/main | grep -o "$today-[0-9]\{1,3\}"); do
    [[ "$id" == "$today-"* ]] || continue
    n="${id##*-}"
    (( n > last )) && last=$n
  done
  RELEASE="$today-$((last + 1))"
fi
[[ "$RELEASE" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{1,3}$ ]] || die "release id must look like 2026.09.09-1, got $RELEASE"
[[ "$RELEASE" != "$CURRENT_RELEASE" ]] || die "release $RELEASE is already the fleet target; pass a new -r"
if [[ "$BUNDLE" == "$CURRENT_BUNDLE" ]]; then
  echo "note: bundle $BUNDLE is already pinned; this release re-cuts it (worker-side change only)"
fi

echo "release:  $CURRENT_RELEASE -> $RELEASE"
echo "bundle:   $CURRENT_BUNDLE -> $BUNDLE"
echo "subject:  release(runtime): $RELEASE $MESSAGE"
git -C "$ROOT" log --format='          %h %s' "$CURRENT_BUNDLE..$BUNDLE" -- runner worker/src/runtime | head -20

# ---- 1. scratch worktree, so a dirty checkout cannot leak into the release --
step "scratch worktree"
WT="$(mktemp -d "${TMPDIR:-/tmp}/ship-runtime.XXXXXX")"
rmdir "$WT"
cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1; git -C "$ROOT" worktree prune >/dev/null 2>&1; }
trap cleanup EXIT
git -C "$ROOT" worktree add -q --detach "$WT" origin/main || die "worktree add failed"
[[ -d "$ROOT/worker/node_modules" ]] && ln -s "$ROOT/worker/node_modules" "$WT/worker/node_modules"
[[ -d "$ROOT/node_modules" ]] && ln -s "$ROOT/node_modules" "$WT/node_modules"
TOML="$WT/worker/wrangler.toml"
sed -i.bak \
  -e "s/^RUNTIME_RELEASE = \"$CURRENT_RELEASE\"\$/RUNTIME_RELEASE = \"$RELEASE\"/" \
  -e "s/^RUNTIME_BUNDLE_COMMIT = \"$CURRENT_BUNDLE\"\$/RUNTIME_BUNDLE_COMMIT = \"$BUNDLE\"/" \
  "$TOML" && rm -f "$TOML.bak"
grep -q "^RUNTIME_RELEASE = \"$RELEASE\"\$" "$TOML" || die "RUNTIME_RELEASE edit did not take"
grep -q "^RUNTIME_BUNDLE_COMMIT = \"$BUNDLE\"\$" "$TOML" || die "RUNTIME_BUNDLE_COMMIT edit did not take"
echo "pins written to $TOML"

# ---- 2. the gate: bundle, installer pin, flags, assets, all against GitHub ---
step "release gate"
gate_ok=0
for attempt in 1 2 3; do
  if node "$WT/worker/scripts/validate-release.mjs"; then gate_ok=1; break; fi
  if [[ $attempt -lt 3 ]]; then
    echo "gate failed (attempt $attempt); raw.githubusercontent lags new SHAs and throttles bursts, retrying in 45s"
    sleep 45
  fi
done
[[ $gate_ok == 1 ]] || die "release gate failed three times; not shipping"

if [[ $DRY_RUN == 1 ]]; then
  step "dry run: stopping before commit"
  git -C "$WT" --no-pager diff -- worker/wrangler.toml
  exit 0
fi

# ---- 3. commit and push main ------------------------------------------------
step "commit and push"
git -C "$WT" add worker/wrangler.toml
git -C "$WT" commit -q -m "release(runtime): $RELEASE $MESSAGE" -m "Bundle pinned to $BUNDLE." \
  || die "commit failed"
pushed=0
for attempt in 1 2 3; do
  git -C "$WT" fetch -q origin
  git -C "$WT" rebase -q origin/main || { git -C "$WT" rebase --abort; die "rebase onto origin/main failed"; }
  if git -C "$WT" push -q origin HEAD:main; then pushed=1; break; fi
  echo "push rejected (attempt $attempt), main moved; retrying"
  sleep 3
done
[[ $pushed == 1 ]] || die "could not push main"
RELEASE_SHA="$(git -C "$WT" rev-parse HEAD)"
echo "main is now $RELEASE_SHA"

# ---- 4. deploy the worker ---------------------------------------------------
step "deploy worker"
if command -v pnpm >/dev/null 2>&1; then
  (cd "$WT/worker" && pnpm exec wrangler deploy) || die "wrangler deploy failed"
else
  (cd "$WT/worker" && npx wrangler deploy) || die "wrangler deploy failed"
fi

# ---- 5. optional: unblock a release that failed deterministically before ----
neon_url() {
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then printf '%s' "$AISAR_NEON_OWNER_URL"; return; fi
  neonctl connection-string --project-id "${AISAR_NEON_PROJECT_ID:-red-haze-10375483}" --role-name neondb_owner
}
if [[ $RESET_EXHAUSTED == 1 ]]; then
  step "reset exhausted upgrade tasks for $RELEASE"
  PGOPTIONS= psql "$(neon_url)" -X -q -v ON_ERROR_STOP=1 -c "
    update runtime_task
       set status = 'queued', attempt = 0, lease_token = null, lease_expires_at = null,
           available_at = now() + interval '60 seconds', updated_at = now(), last_error = null
     where kind = 'upgrade' and status = 'exhausted'
       and (dedupe_key like 'upgrade:%:$RELEASE' or dedupe_key like 'upgrade:%:$RELEASE:%');" \
    || die "task reset failed"
fi

# ---- 6. ask the control plane to sweep now instead of at the next */15 -----
if [[ $SWEEP == 1 ]]; then
  step "drift sweep now"
  KEY="${AISAR_SUPPORT_KEY:-}"
  [[ -z "$KEY" && -s "$HOME/.config/jentera/support-key" ]] && KEY="$(cat "$HOME/.config/jentera/support-key")"
  if [[ -z "$KEY" || -z "$API_ORIGIN" ]]; then
    echo "no support key or API_ORIGIN; the */15 cron will sweep within 15 minutes"
  elif ! curl -sS -m 60 -X POST "$API_ORIGIN/api/support/drift-sweep" -H "Authorization: Bearer $KEY"; then
    echo; echo "sweep request failed; the */15 cron will sweep within 15 minutes"
  else
    echo
  fi
fi

[[ $WATCH == 1 ]] || { step "done (no watch)"; exit 0; }

# ---- 7. converge, then prove it ----------------------------------------------
step "watch convergence"
"$ROOT/worker/scripts/watch-release-converge.sh" "$RELEASE" || die "fleet did not converge; see docs/release-playbook.md (rollback, task reset)"

step "verify every sprite"
"$ROOT/worker/scripts/fleet-verify.sh" "$RELEASE" || die "converged but verification failed on at least one sprite"

step "shipped $RELEASE (bundle $BUNDLE, main $RELEASE_SHA)"
