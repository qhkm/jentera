#!/usr/bin/env bash
# ============================================================
#  Deploy AISAR (app/) → Cloudflare Pages → aisar.ai
#
#  The React app is the product of record as of the cutover. The
#  old static site (index.html, biz-engine.js and the other root
#  HTML) is still in the repository for reference but is no longer
#  published by anything.
#
#  Preview instead of production:
#    AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "message"
#
#  Rollback: Cloudflare Pages keeps every deployment. The last
#  static-site build is 26460b00 under the `aisar` project and can
#  be restored from the dashboard in one click.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${AISAR_PAGES_PROJECT:-aisar}"
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
sleep 5
if [ "$PROJECT" = "aisar" ]; then
  TARGETS="https://aisar.ai https://aisar.ai/onboard https://aisar.ai/setup https://aisar.ai/app"
else
  TARGETS="https://${PROJECT}.pages.dev"
fi
for url in $TARGETS; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$url" || echo "ERR")
  echo "   $url → HTTP $code"
done

echo
echo "✅ Done."
