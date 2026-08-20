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

# A SPA answers 200 for every path, including assets that do not exist —
# the _redirects fallback returns index.html. So checking status codes
# proves nothing. Fetch the real asset URLs out of the served HTML and
# assert they are actually CSS and JS. A cutover once shipped with every
# route returning 200 while the stylesheet was HTML and the whole site
# rendered unstyled.

case "$PROJECT" in
  aisar-jentera) BASE="https://jentera.aisar.ai" ;;
  aisar)         BASE="https://aisar.ai" ;;
  *)             BASE="https://${PROJECT}.pages.dev" ;;
esac

verify_assets() {
  html=$(curl -sS --max-time 20 "$BASE/?cb=$(date +%s)" 2>/dev/null) || return 1
  css=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.css' | head -1)
  js=$(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9_.-]+\.js' | head -1)
  [ -n "$css" ] && [ -n "$js" ] || return 1

  css_body=$(curl -sS --max-time 20 "$BASE$css" 2>/dev/null) || return 1
  js_body=$(curl -sS --max-time 20 "$BASE$js" 2>/dev/null) || return 1

  # The failure mode is an asset URL answering with index.html.
  printf '%s' "$css_body" | head -c 200 | grep -qi "<!doctype\|<html" && return 1
  printf '%s' "$js_body"  | head -c 200 | grep -qi "<!doctype\|<html" && return 1

  # And an empty or truncated bundle is just as broken as an HTML one.
  [ "${#css_body}" -gt 5000 ] || return 1
  [ "${#js_body}"  -gt 5000 ] || return 1
  return 0
}

ok=0
for attempt in 1 2 3 4 5 6; do
  if verify_assets; then ok=1; break; fi
  echo "   assets not ready yet (attempt $attempt) — waiting…"
  sleep 10
done

if [ "$ok" != "1" ]; then
  echo
  echo "❌ VERIFY FAILED: $BASE is serving HTML where CSS or JS should be."
  echo "   The site is live but will render unstyled."
  echo "   Roll back to the previous deployment of the '$PROJECT' project"
  echo "   from the Cloudflare Pages dashboard."
  exit 1
fi

for p in "" /onboard /setup /app; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$BASE$p/" || echo "ERR")
  echo "   $BASE$p → HTTP $code"
done
echo "   assets verified: stylesheet and bundle both served as real files"

echo "✅ Done."
