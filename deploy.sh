#!/usr/bin/env bash
# ============================================================
#  Deploy AISAR (app/) → Cloudflare Pages → jentera.aisar.ai
#
#  The React app is the product of record as of the cutover. The
#  old static site (index.html, biz-engine.js and the other root
#  HTML) is still in the repository for reference but is no longer
#  published by anything.
#
#  This script publishes to the `aisar-jentera` project, which is
#  the only project serving jentera.aisar.ai. The apex aisar.ai is
#  a separate project (`aisar`) and is NOT touched by this script.
#
#  Preview instead:
#    AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "message"
#
#  Publishing to the apex is deliberately manual — set
#  AISAR_PAGES_PROJECT=aisar only when you mean to change aisar.ai.
#
#  Rollback: Cloudflare Pages keeps every deployment; restore an
#  earlier one from the dashboard in one click.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${AISAR_PAGES_PROJECT:-aisar-jentera}"
MSG="${1:-Deploy AISAR React app}"

echo "── 1/4 Install ──"
cd app
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo
echo "── 2/4 Typecheck + build ──"
pnpm build

echo
echo "── 3/4 Publish → Cloudflare Pages (project: $PROJECT) ──"
npx wrangler pages project create "$PROJECT" --production-branch main 2>/dev/null || true
# Deploy as the production branch so the stable <project>.pages.dev URL
# serves it. Without --branch, wrangler uses the current git branch and
# publishes a preview-only deployment whose apex URL 404s.
npx wrangler pages deploy dist \
  --project-name "$PROJECT" \
  --branch main \
  --commit-message "$MSG"

echo
echo "── 4/4 Verify ──"

# Asset filenames are content-hashed, so the bundle just built is a
# fingerprint of this exact deploy. Asserting the live HTML references THAT
# file is what separates "our build is live" from merely "a build is live".
#
# The previous check only proved the served assets were real files rather
# than SPA-fallback HTML. That passed while aisar.ai served a build
# published by a different repository — ~/ios/aisar.ai deploys with no
# --project-name and had landed on the `aisar` project — so four
# consecutive deploys reported success while the apex served none of them.
EXPECT_JS=$(grep -oE '/assets/[A-Za-z0-9_.-]+\.js' dist/index.html | head -1)
if [ -z "$EXPECT_JS" ]; then
  echo "❌ could not read the built bundle name out of dist/index.html"
  exit 1
fi
echo "   expecting $EXPECT_JS"

# FALLBACK is the project's own pages.dev, used when the custom domain is
# not attached yet. Note aisar's is aisar-ez8 — plain aisar.pages.dev is a
# different project entirely and answers 200 no matter what we publish.
case "$PROJECT" in
  aisar-jentera) BASE="https://jentera.aisar.ai";     FALLBACK="https://aisar-jentera.pages.dev" ;;
  aisar)         BASE="https://aisar.ai";             FALLBACK="https://aisar-ez8.pages.dev" ;;
  *)             BASE="https://${PROJECT}.pages.dev"; FALLBACK="" ;;
esac

# Fail over immediately rather than burning six retries on a hostname that
# has no DNS record.
if ! curl -sS --max-time 10 -o /dev/null "$BASE/" 2>/dev/null; then
  if [ -n "$FALLBACK" ]; then
    echo "   ⚠️  $BASE unreachable — custom domain not attached to '$PROJECT'."
    echo "      Verifying $FALLBACK instead. Attach the domain in the"
    echo "      Cloudflare Pages dashboard to make $BASE serve this."
    BASE="$FALLBACK"
  else
    echo "❌ $BASE is unreachable and there is no fallback host to check."
    exit 1
  fi
fi

SERVED_JS=""
BAD_ASSET=""
BAD_REASON=""

# An asset is "real" if it is not the SPA shell and not a stub. Both
# failure modes answer 200, which is why status codes prove nothing here.
asset_real() {
  body=$(curl -sS --max-time 30 "$1" 2>/dev/null) || return 1
  printf '%s' "$body" | head -c 200 | grep -qi "<!doctype\|<html" && return 1
  [ "${#body}" -gt 5000 ] || return 1
  return 0
}

verify_assets() {
  BAD_ASSET=""; BAD_REASON=""
  html=$(curl -sS --max-time 20 "$BASE/?cb=$(date +%s)" 2>/dev/null) || return 1
  SERVED_JS=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.js' | head -1)
  css=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.css' | head -1)
  [ -n "$SERVED_JS" ] && [ -n "$css" ] || return 1

  # The build just published, not merely some build.
  [ "$SERVED_JS" = "$EXPECT_JS" ] || { BAD_REASON=other-build; return 1; }

  # Fetch the way a browser would — no cache-buster — so a poisoned edge
  # entry is caught rather than skipped past.
  for a in "$css" "$SERVED_JS"; do
    asset_real "$BASE$a" && continue
    BAD_ASSET="$a"
    # Same URL, cache-bypassed. If that comes back real, the file is
    # fine at origin and only the edge copy is wrong.
    if asset_real "$BASE$a?cb=$(date +%s)"; then
      BAD_REASON=stale-edge
    else
      BAD_REASON=missing
    fi
    return 1
  done
  return 0
}

ok=0
for attempt in 1 2 3 4 5 6; do
  if verify_assets; then ok=1; break; fi
  echo "   not live yet (attempt $attempt, serving ${SERVED_JS:-nothing}) — waiting…"
  sleep 10
done

if [ "$ok" != "1" ]; then
  echo
  case "$BAD_REASON" in
    other-build)
      echo "❌ VERIFY FAILED: $BASE is serving a different build."
      echo "     expected $EXPECT_JS"
      echo "     serving  $SERVED_JS"
      echo
      echo "   The deploy itself succeeded, so this is not a build problem."
      echo "   Most likely another project published to the '$PROJECT' Pages"
      echo "   project after this one. Check the deployment list:"
      echo "     npx wrangler pages deployment list --project-name $PROJECT"
      ;;
    stale-edge)
      echo "❌ VERIFY FAILED: $BASE$BAD_ASSET is HTML at the edge but correct at origin."
      echo
      echo "   Cloudflare cached the SPA fallback under that asset URL while the"
      echo "   file was briefly absent, and _headers marks /assets/* immutable —"
      echo "   so the bad copy is pinned for a year. Rolling back does NOT fix"
      echo "   this: the deployment is fine, the cache is not. Either:"
      echo "     • purge it — Caching → Configuration → Purge Custom URL:"
      echo "         $BASE$BAD_ASSET"
      echo "     • or move the bundle to a fresh hash (bump the rev in the"
      echo "       banner at the top of app/src/styles/index.css) and redeploy."
      ;;
    *)
      echo "❌ VERIFY FAILED: ${BAD_ASSET:-an asset} is missing from the deployment."
      echo "   $BASE serves the SPA fallback for it, so the site renders unstyled."
      echo "   wrangler skips uploads it believes are already stored, so a plain"
      echo "   re-run of this script is the first thing to try."
      ;;
  esac
  exit 1
fi

for p in "" /onboard /setup /app; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$BASE$p/" || echo "ERR")
  echo "   $BASE$p → HTTP $code"
done
echo "   serving $EXPECT_JS — this build, verified by content hash"

echo "✅ Done."
