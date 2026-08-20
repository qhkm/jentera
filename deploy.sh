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
verify_assets() {
  html=$(curl -sS --max-time 20 "$BASE/?cb=$(date +%s)" 2>/dev/null) || return 1
  SERVED_JS=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.js' | head -1)
  css=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.css' | head -1)
  [ -n "$SERVED_JS" ] && [ -n "$css" ] || return 1

  # The build just published, not merely some build.
  [ "$SERVED_JS" = "$EXPECT_JS" ] || return 1

  css_body=$(curl -sS --max-time 20 "$BASE$css" 2>/dev/null) || return 1
  js_body=$(curl -sS --max-time 20 "$BASE$SERVED_JS" 2>/dev/null) || return 1

  printf '%s' "$css_body" | head -c 200 | grep -qi "<!doctype\|<html" && return 1
  printf '%s' "$js_body"  | head -c 200 | grep -qi "<!doctype\|<html" && return 1

  [ "${#css_body}" -gt 5000 ] || return 1
  [ "${#js_body}"  -gt 5000 ] || return 1
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
  if [ -n "$SERVED_JS" ] && [ "$SERVED_JS" != "$EXPECT_JS" ]; then
    echo "❌ VERIFY FAILED: $BASE is serving a different build."
    echo "     expected $EXPECT_JS"
    echo "     serving  $SERVED_JS"
    echo
    echo "   The deploy itself succeeded, so this is not a build problem."
    echo "   Most likely another project published to the '$PROJECT' Pages"
    echo "   project after this one. Check the deployment list:"
    echo "     npx wrangler pages deployment list --project-name $PROJECT"
  else
    echo "❌ VERIFY FAILED: $BASE is serving HTML where CSS or JS should be."
    echo "   The site is live but will render unstyled."
    echo "   Roll back from the Cloudflare Pages dashboard."
  fi
  exit 1
fi

for p in "" /onboard /setup /app; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$BASE$p/" || echo "ERR")
  echo "   $BASE$p → HTTP $code"
done
echo "   serving $EXPECT_JS — this build, verified by content hash"

echo "✅ Done."
