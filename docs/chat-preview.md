# Ten-chat launch preview

Verified new accounts can explore onboarding and the platform without payment.
Each account receives ten lifetime chat requests, shared across conversations,
tabs and businesses. New chats, clearing browser storage or a new billing month
do not reset the allowance.

## What counts

One valid, admitted chat submission counts once, including a submission with a
file. Agent tool calls and status polling do not count as additional chats.
Invalid input and an unready runtime do not consume a request. An admitted
request still counts if subsequent preparation or execution fails.

The server reserves a slot atomically before file conversion or AI execution.
The committed run/task is bound to that slot in the same transaction. A retry
with the same request ID reuses the committed task; pending/failed preparation
cannot repeatedly invoke a converter. No prompt, file content, credential or
payment information is stored in the preview ledger.

After request ten, new work returns HTTP 402 with
`CHAT_PREVIEW_EXHAUSTED`. The composer becomes an upgrade card, but access to
previous results remains available and admitted tasks can finish. Free preview
does not grant recurring/background/Telegram execution: the runtime/model
exception requires a quota-admitted chat task, and model calls require its live
lease. Existing runtime cost/time/token budgets still apply.

Existing operator, active paid and invitation grants are unchanged. Expired or
revoked grants and previously redeemed invitations cannot start a fresh preview.
Only trusted payment activation removes the ten-chat cap; founder WhatsApp
support remains available only after verified payment. Subscription amounts,
Stripe webhook verification and tax settings are unchanged.

## Release order

The preview is **off by default**, behind `CHAT_PREVIEW_ENABLED`. Do not publish
the new ten-free-chat marketing copy before its backend is enabled.

1. Run Worker typecheck and the real-Postgres tests, and frontend typecheck,
   build, unit tests and fictional-account browser QA.
2. Supply the reviewed production owner DSN through `AISAR_NEON_OWNER_URL`
   (never arguments, logs, committed files or browser code), then run
   `pnpm db:migrate:chat-preview` from `worker/`. This applies migration 057
   transactionally and checks the ten-request constraint and app-role privileges.
3. Set `CHAT_PREVIEW_ENABLED = "true"` in the intended Worker release, retain
   `ACCESS_MODE = "waitlist"` and the existing live checkout gates, then deploy.
4. Deploy the matching frontend. Verify a new verified account reaches
   onboarding rather than checkout; request ten finishes; request eleven is
   blocked; results remain readable; a paid account can continue.

Use the scoped release worktrees when the main workspace contains unrelated
unfinished changes. This feature does not require a Hermes/Sprite bundle upgrade
or any production payment for automated QA.

To close the preview, disable its Worker flag. This restores the existing
restricted-access policy; keep the ledger/schema rather than resetting quotas.
The pre-tenant entitlement tables follow the existing session/platform-access
boundary. The app role has no delete/reset privilege. Any future account-deletion
workflow must explicitly handle these audit references and retention policy.

## Verification

- `worker/test/chat-preview.test.ts`: verified identity, concurrency, shared
  quota, duplicate/replay safety, exhausted conversions, invitation/paid
  exemptions, revoked access, exact task admission and model lease requirements.
- `app/src/hooks/__tests__/useChatPreview.test.tsx`: account changes, stale
  responses, display refresh, paid activation and failure behavior.
- Chat/remote/subscription tests: request-ten completion, HTTP 402 refresh,
  try-first navigation, upgrade, server-confirmed logout and public-site exit.
- `CHROME_CHANNEL=chrome node app/scripts/check-launch-funnel.mjs` with the
  preview server on port 4176: fictional accounts only; all API writes fulfilled
  locally, no email, charge, group join or agent/provider execution.

## Production release — 17 September 2026

- Migration `057_chat_preview.sql` applied transactionally to the reviewed
  Neon production branch; app-role privileges, lifetime cap and no-reset trigger
  verified before enabling the feature.
- Worker source `975224a`, version `d9e0e283-74a0-4e74-b661-eda97b6df190`;
  `CHAT_PREVIEW_ENABLED=true`, existing live checkout gates retained.
- Frontend source `e0f0db8`, Pages deployment `a9909d46`, entry bundle
  `index-CqRvTzd-.js`; matching bundle verified on both `jentera.ai` and
  `jentera.aisar.ai`.
- Live authenticated canary verified the ten-chat entitlement, billing quota
  display, read access at zero remaining, rejection of unverified identities,
  private paid-only founder invitation and all Stripe readiness checks.
  Its exact temporary fictional account/session was removed afterward.
- Anonymous `/api/me` and `/api/billing/status` remain HTTP 401. No production
  AI jobs, provisioning, emails or payments were created by these checks.
- Request-ten completion, request-eleven HTTP 402, concurrency, replay and
  paid exemptions were covered by the real-Postgres integration/unit tests;
  live canary coverage is entitlement/readiness only, not ten real AI executions.
- Published frontend browser QA passed all eight mobile/tablet/desktop,
  English/Bahasa and dark/light layouts, including announcement navigation,
  subscription exits and the exhausted-preview upgrade state. API responses
  were fictional/intercepted for browser QA; HTML/assets came from the live site.
- Hermes/Sprite pin and tax configuration are unchanged.
