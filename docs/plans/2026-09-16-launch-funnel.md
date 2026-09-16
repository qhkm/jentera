# Jentera launch funnel — 16 September 2026

The owner's latest launch brief supersedes the older multi-tier/Q4 marketing
plan for this launch. This is a delivery plan, not evidence that billing,
support, routines or lifecycle emails are live.

## Offer

Hire your first AI Staff for RM99/month. One launch plan: RM99 for the first
three monthly billing periods, then RM199/month from period four. Show both
prices before consent to subscribe, and use the actual subscription's billing
dates for renewal notices, not a hard-coded 16 December date or 90-day clock.

Includes the dedicated business computer, included standard AI usage (limits
must be specified before checkout), founder WhatsApp support, and free Automation
Mapping to identify three potential workflows. Early access is a secondary bonus.
Mapping is not a promise that every proposed integration or workflow is supported.

Pending: offer closing date, fair-use quantities, support expectations, payment
provider/account readiness, cancellation/refund conditions and applicable tax
obligations. Payment secrets must remain server-side. No charges or live
subscription changes are authorised by editing this copy.

## Funnel and release gates

Traffic → outcome-focused landing → verified account → limited trial →
explicit paid upgrade → verified payment → provision/continue computer →
choose first workflow → first useful result → recurring use → value summary →
RM199 renewal. Offer the optional founder group immediately after verified
payment, without blocking provisioning or the first job.

Current CTA still opens the existing no-payment waitlist. It explicitly says
checkout is not open. Do not claim a paying customer, grant paid access, start a
paid subscription or show a post-purchase success screen from that action.
Checkout and signed, deduplicated subscription lifecycle webhooks are required
before paid launch. Test initial payment, failed payment, renewal, cancellation,
delayed/duplicate/out-of-order events and cross-account ownership.

## Trial → RM99 upgrade (latest owner addition)

Start with **10 trial questions**, configurable down to 5 on the server. Treat
this as a query-limited product trial, not unlimited use or a free paid plan.

- Require a verified account; store allowance and usage server-side. Refreshing,
  changing devices or moving the account to another business must not reset it.
- Reserve in-flight requests atomically before paid provider work. Idempotent
  retries consume one request, not a second question. Completed work counts once;
  proven platform failures can return their slot. Unknown/billed cancellations
  need reconciliation and must not become an unlimited free-compute loophole.
- Apply an independent hard spending cap, bounded task duration and tools, and
  provisioning abuse controls. Ten questions alone do not bound computer/API cost.
- Show remaining trial questions in Chat. At exhaustion, preserve history,
  downloads and connection management, but block new paid agent execution on every
  entry point (app, Telegram, schedules/resumes), not only the composer.
- Present an inline, clear **Upgrade — RM99/month** action, with “RM99/month for
  your first 3 monthly billing periods; RM199/month thereafter” before consent.
  Never automatically charge or subscribe when the trial ends.
- Retain the unfinished draft; do not automatically re-submit it after payment.
  Resume only after verified entitlement and an explicit owner action.
- The founder WhatsApp invite remains payment-only, never part of free-trial
  signup. Existing invitation-controlled 72-hour trials remain unchanged until
  the self-serve trial's time limits and abuse controls are deliberately enabled.

Local Stripe-branch account-counter helpers and tests exist, but are **not wired
into chat or public trial activation** yet. Live billing, the upgrade prompt and
self-serve trial rollout are pending the integration/readiness gates above.

Workflow choice is currently offered before business introduction so customers
can state their goal without waiting for provisioning. Source review remains
required. The chosen task stays in the mounted form until the owner confirms it
alongside the business details; existing tenant-scoped facts carry it to Setup.
It prepares an editable first-workflow brief, not an active routine. Running
that brief requires an explicit owner click. Nothing is sent or scheduled by
selection, confirmation or opening Chat.

The four ready checks appear only after the existing release-matched readiness
gate passes. Existing server-observed setup stages remain the progress source;
there are no timer-driven success checks. An idle verified computer can still
need to wake when a job starts.

Recurring routines remain production-canary restricted. Before advertising
routines as available to every paying customer, deliberately validate and roll
out the existing routines capability. Do not remove its gates for marketing.
WhatsApp founder support is human support, not the unavailable AI WhatsApp
connector. Do not imply Shopee, Gmail or spreadsheet connectors are live.

## Primary activation measure

**Percentage of paying customers with one verified business workflow result
within 48 hours of their first successful payment.**

Use a paid customer/cohort identity from server-confirmed payment, an agreed
workflow id, a linked successful execution, and owner acceptance of the useful
business result. A drafted brief, setup completion, enabled routine, assistant
claim or message count does not establish useful automation.

Count distinct operational workflows separately from tasks and routine runs.
Always show the numerator, denominator and observation window. Until payment
and workflow acceptance data exist, show metrics as unavailable, not zero or
invented conversion rates. Decide whether the unit is the business subscription
or paying account before implementing the dashboard; never count staff seats
as separate paid customers by accident.

Working hypotheses, not industry benchmarks: paid→first task 80%; paid→first
automation 60%; first automation within 48h 50%; 3+ workflows by day 30 30%;
introductory→RM199 retention 50%. Prioritise the 48-hour metric over traffic.

## Founder-led activation and retention

- Day 0: agree one repetitive task; run a real first job.
- Days 1–2: personally help configure, execute and verify the first workflow.
- Day 3: introduce recurring routines where enabled, with reviewed schedules.
- Day 5: suggest one additional suitable workflow; do not enable it silently.
- Day 7: deliver a summary from verified tasks and routine executions.
- Day 30: report completed outcomes, distinct workflows and estimated time saved.
- Month 2: map more opportunities; suggestions are not autonomous authorisation.
- Before month 4: show real value and the exact next RM199 charge date.

Hours saved must be labelled estimates and use a disclosed, owner-reviewed
manual-time baseline. Failed, skipped, approval-waiting and duplicate work do
not count as completed results. Never present illustrative ROI numbers as a
customer's real usage. Obtain consent before publishing identifiable case studies.

Workflow-count health hypotheses: 0 at risk; 1 activated; 3 healthy; 5+ embedded.
Counts do not replace quality, reliability, safety or actual retention evidence.

## Founder group and implementation giveaway

The owner's invite URL is held in a gitignored local configuration for the
`LAUNCH_FOUNDER_GROUP_URL` Worker secret; it has not been uploaded or deployed.
Missing configuration hides the optional card. The platform appreciation
card thanks early supporters, invites them to build the product together and
listen to feedback, and offers direct founder access for ideas, issues or help.
It is visible in onboarding, Setup and My Business → Profile only after an
operator verifies payment and records a reference on an active paid grant.
This is manual payment attestation, not automatic Stripe receipt verification.
Trials, owner exceptions, paid grants without references, revoked/expired access
and open access alone do not qualify. No invite URL is shipped in the public app.
Joining is explicit and optional; do not open WhatsApp automatically or copy
customer business data into it. Explain that other group members can see
information they share. An eligible recipient can forward a shared invite URL:
use WhatsApp group admission controls; this is not a non-transferable entitlement.
Ask:
“Apa benda yang paling repetitive dalam business sekarang?”

Keep `/api/access` as the invitation contract when integrating the separate
Stripe branch. Signed, successfully processed payment evidence must establish
eligibility, not a checkout redirect or `business.plan`. See
[`2026-09-16-stripe-launch-integration.md`](2026-09-16-stripe-launch-integration.md).
An optional thank-you email is a later, once-per-first-paid-customer outbox job:
verified recipient, confirmed payment, deduplication, retry-safe delivery and no
sending on failed or unpaid checkout. Do not reuse waitlist announcement emails
as proof of payment or send them the private invite.

Every launch buyer gets Mapping. Proposed extra: three recipients get three
workflows implemented together, stated value RM900. Keep this out of public
copy until eligibility, closing/draw dates, selection method, fulfilment scope
and applicable promotion requirements have been reviewed and published.

A random lucky draw and hand-selected diverse case-study recipients are
different promotions. Choose and disclose the actual method; do not advertise
random selection then privately hand-pick winners.

## Launch essentials remain in scope

Before public paid release: safe log redaction, alerts tested end-to-end, latency
visibility, spend caps, security/approval and cross-tenant checks, real chat and
photo/Excel canaries, backup restore and rollback checks, and billing readiness.
External triggers remain physically excluded; this funnel does not restore them.

Not implemented by the marketing/onboarding slice: payment processing,
automatic payment-triggered email delivery, scheduled lifecycle communications, verified
workflow-acceptance instrumentation, ROI dashboard and actual founder services.

## Local verification

The announcement/welcome and launch-preparation follow-up has a separate
current readiness snapshot and verification record in
[`launch-day-kit-2026-09-16.md`](../marketing/launch-day-kit-2026-09-16.md).
The results below describe the earlier funnel slice, not a fresh full regression
of every concurrent worktree change.

- App: 101 test files / 925 tests passed; production build, typecheck and static
  SEO verification passed. The actual group invite is absent from app source and
  built output; its local configuration is gitignored.
- Worker: typecheck and 36 focused real-Postgres/auth/link-validation tests passed.
- Browser: `/`, `/waitlist`, `/onboard`, `/setup` and `/app` checked at 320, 390,
  768 and 1440px, plus BM and light mode. Verified no horizontal overflow, eligible
  paid invitation, trial exclusion, editable confirmed task and readiness checks.
  Accounts, Turnstile, provisioning and wake responses were local fixtures only;
  no Stripe payment, provider login, agent execution, group join or email occurred.
- Not deployed; no live payment setting, Worker secret or cloud migration changed.
