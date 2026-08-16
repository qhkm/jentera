#!/usr/bin/env bash
# Deploy AISAR site → Cloudflare Pages (aisar.ai)
# Zone kitakod.com aktif di Cloudflare → custom domain auto-verify.
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-Deploy AISAR site update}"

echo "── 1/3 Git commit + push ──"
git add -A
if git diff --cached --quiet; then
  echo "   Tiada perubahan — skip commit"
else
  git commit -m "$MSG"
fi
git push origin main || echo "   (push skipped — no remote or offline)"

echo
echo "── 2/3 Wrangler publish (Cloudflare Pages → aisar.ai) ──"
wrangler pages project create aisar --production-branch main 2>/dev/null || true
wrangler pages publish . --project-name aisar
echo "   ✅ Cloudflare Pages deploy"

echo
echo "── 3/3 Verify ──"
sleep 5
# aisar.kitakod.com has no DNS, and aisar.pages.dev belongs to a different
# project (the old AI Agent Builder) — verifying against it reported success
# no matter what this script published. These are the real targets.
for url in https://aisar.ai https://aisar-ez8.pages.dev; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$url" || echo "ERR")
  echo "   $url → HTTP $code"
done
echo
echo "✅ Selesai."
