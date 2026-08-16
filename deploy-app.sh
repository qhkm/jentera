#!/usr/bin/env bash
# ============================================================
#  Deploy the React app (app/) to Cloudflare Pages.
#
#  DELIBERATELY NOT a production cutover. This publishes to the
#  `aisar-next` project, so the React rebuild gets its own URL and
#  the live site at aisar.ai is untouched.
#
#  To cut over once you're happy, change PROJECT to "aisar" — that
#  is the whole change. Existing deploy.sh keeps publishing the
#  static root until you delete it.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${AISAR_PAGES_PROJECT:-aisar-next}"
MSG="${1:-Deploy AISAR React app}"

if [ "$PROJECT" = "aisar" ]; then
  echo "⚠️  PROJECT is 'aisar' — this REPLACES the live site at aisar.ai."
  read -r -p "    Type 'cutover' to continue: " confirm
  [ "$confirm" = "cutover" ] || { echo "    Aborted."; exit 1; }
fi

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
sleep 5
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "https://${PROJECT}.pages.dev" || echo "ERR")
echo "   https://${PROJECT}.pages.dev → HTTP $code"

echo
echo "✅ Done. Production (aisar.ai) was not touched."
