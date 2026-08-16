#!/usr/bin/env bash
# Deploy JENTERA site → Cloudflare Pages (jentera.ai)
# Zone kitakod.com aktif di Cloudflare → custom domain auto-verify.
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-Deploy JENTERA site update}"

echo "── 1/3 Git commit + push ──"
git add -A
if git diff --cached --quiet; then
  echo "   Tiada perubahan — skip commit"
else
  git commit -m "$MSG"
fi
git push origin main || echo "   (push skipped — no remote or offline)"

echo
echo "── 2/3 Wrangler publish (Cloudflare Pages → jentera.ai) ──"
wrangler pages project create jentera --production-branch main 2>/dev/null || true
wrangler pages publish . --project-name jentera
echo "   ✅ Cloudflare Pages deploy"

echo
echo "── 3/3 Verify ──"
sleep 5
for url in https://jentera.ai https://jentera.pages.dev; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "$url" || echo "ERR")
  echo "   $url → HTTP $code"
done
echo
echo "✅ Selesai."
