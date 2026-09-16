# Stripe branch → paid launch integration

## Current selective integration — 17 September 2026

The historical sandbox-only findings below are superseded for automatic account
activation by [the scoped release](../billing/automatic-activation.md), not by a
blanket merge of this branch. Backend `d671439` and frontend `a0ad5b5` are deployed;
the billing-status route now exists and returns 401 to anonymous callers.
Production migrations 053–056 were applied and RLS/immutability verified. Deferred
pilot 051, prepaid-credit/trial foundations and unrelated main changes remain
excluded. Live Checkout remains closed pending deployment readiness and real
Stripe canaries. The mandatory legal-policy setting is verified, not blocked.

The replacement Stripe credential and private founder invite are in the Worker
secret vault. The existing support-key-protected readiness route returns only
safe checks, not provider payloads or secrets. Presence/type does not establish
seller permissions, cancellation readiness or successful payment fulfillment.

Reviewed locally on 16 September 2026 against `stripe-billing` at `40e2fcc`.
This is a merge/readiness plan, not evidence of live charging. The branch remains
unmerged. Local hardening work did not provision Stripe or enable Checkout.
The later, explicitly authorized catalog-only follow-up created and verified
one live Product, a MYR 199 monthly Price and a MYR 100 discount for three months.
See `docs/billing/launch-catalog.md` and `launch-catalog.live.json` on the Stripe
branch. No live Checkout, customer subscription, cloud migration or email exists
as a result of that follow-up.

## Authorized checkout follow-up — 16 September 2026

The operator explicitly requested paid checkout and reconfirmed permission to
use the shared live restricted key. A transient, read-only `--inspect` run
successfully authenticated to the expected account and verified the same live
Product, Price and Coupon. Key authorization or validity is not the blocker.
The key was not installed in the Worker or retained in source/process logs.

The Stripe worktree now also contains:

- A single `/api/billing/launch/checkout` contract, with server-validated MYR 199
  monthly Price and MYR 100 discount for the first three months. Renewal disclosure
  and terms consent are required; alternate currencies, custom amounts, trials,
  customer-selected prices and unrestricted promotion codes are rejected.
- First-purchase onboarding for a verified owner without a business. Concurrent
  requests serialize on the same user, creating one private placeholder business
  and the normal specialist profiles. This does not provision a computer, mark
  onboarding complete, grant paid access or issue credits before payment.
- First-purchase discount eligibility against verified payer/account payment
  history, including other businesses, through additive migration 056. Returning
  payers are offered RM199 without restarting the introductory discount.
- Thirty launch-checkout integration tests with isolated Postgres and mocked
  outbound Stripe requests. Worker/test typechecks and seven billing-focused
  suites passed **113 tests**. These are not real Stripe payment canaries.

All payment routes remain deliberately local-sandbox-only and reject live keys.
Migration 056 has not been applied to the cloud. No live Customer, Checkout
Session, Subscription, webhook endpoint or charge was created by this follow-up.
The announced monthly AI allowance still needs the operator's decision; a US$5
monthly AI budget was proposed, not accepted or installed as a customer promise.

The separate announcement/welcome frontend was released to `aisar-jentera` as
deployment `89a09013`, local release commit `425dcf8`. It does not include this
Stripe worktree, deploy a Worker or enable checkout. Both live hostnames serve
the verified release assets; `/api/billing/status` still returns 404.

## Local foundation follow-up

Changes are in the existing `stripe-billing` worktree, not merged into main:

- SDK 22.6.2 / API 2026-08-26.dahlia, request-local fetch client, bounded timeout,
  secret-free provider errors and signature rotation support.
- Explicit sandbox enablement plus a test-key gate. Live keys are rejected even
  if the flag is enabled. This slice also requires an isolated local Postgres/API
  target and rejects production database naming: sandbox payments must never
  grant real customer entitlements. Automatic tax remains blocked pending review.
- Server-created customer/Checkout ownership, stable request idempotency and a
  business row lock prevent duplicate simultaneous Checkout creation.
- Completion and delayed success reconcile confirmed Invoice → Subscription →
  saved Checkout ownership. Positive MYR payment must be confirmed by an
  InvoicePayment/PaymentIntent and a captured, non-refunded, non-disputed charge.
  Trial, zero-value and unrelated manual invoices do not grant access.
- Payment evidence, paid access, appreciation intent, configured included credits
  and event deduplication commit atomically. Failures roll back the claim too.
  Invoice failure preserves subscription identity and the item period.
- Forced-RLS internal credit buckets separate expiring included allowance from
  purchased credits. Reservations/settlements are idempotent and serialized;
  insufficient funds and usage above the reserved maximum fail closed. The
  application role cannot update/delete the ledger or stored payment evidence.
- Account-bound trial counter defaults to 10, supports a server-set 5, reserves
  in-flight requests and never resets the existing allowance on device/business
  changes. Completed requests count once; proven platform failures can be released.
  Uncertain/billed cancellations are not a free-compute refund mechanism.

These are foundations, not production prepaid billing: **credit and trial
helpers are not yet connected to chat, model, computer or tool execution**.
There is no live top-up Checkout, automatic email sender, or customer-facing
upgrade prompt yet. Existing inference safeguards remain intact. Metronome is
the Stripe skill's recommendation for new prepaid usage billing; commercial fit
and integration have not been evaluated/provisioned. No Billing Meters integration
was introduced.

Additive migrations 053–056 preserve the branch's existing 051. Before merge,
reconcile 051 with the deferred external-trigger restoration manifest without
restoring that pilot. Never apply the whole branch blindly.

The launch offer, resubscription eligibility and first-purchase onboarding now
exist as sandbox implementations only. Still required before a paid release:
compatible production integration, verified pricing/FX/all-in cost rating, the
operator-approved included allowance, all paid entry points' admission
and settlement, low-balance/upgrade UI, top-up receipts, refund/dispute reversals
and reconciliation, appreciation delivery, tax and cancellation/credit terms,
then isolated Stripe sandbox canaries.

At the operator's explicit request, the shared restricted live credential was
used transiently for account/catalog reads and Product/Price/Coupon creation.
It was not persisted in repository files, printed in process output or installed
in the Worker. Rotate it now before runtime configuration and review its request
logs. Do not paste its replacement into chat or commit it; deposit it directly
into the platform's secrets vault. Hosted Checkout needs no frontend publishable key.

## Existing branch and current launch

The branch contains owner-only Checkout/Customer Portal endpoints, a signed
webhook, business-scoped subscription fields and event-id deduplication.
Its original checkout offers Pro/Team, monthly/annual prices. The later local
sandbox launch endpoint implements the single RM99 monthly offer for three
billing periods, then RM199 from period four; it is not enabled in production.
Automatic payment-triggered founder-support delivery remains unfinished.

Current main uses email-scoped `platform_access` for restricted access and
background work. A business plan flag cannot unlock platform access. The founder
invite also requires verified identity, an active paid grant and an
operator-recorded payment reference. A reference means the operator attested to
payment; the API does not contact Stripe to verify it.

## Original merge blockers found at 40e2fcc

- `handleInvoiceStatus` passes null subscription ID and paid-through date to
  `writeSubscriptionState`, which overwrites both stored fields. Invoice success
  or failure must preserve or reconcile subscription ownership and paid coverage.
- Checkout completion does not check `payment_status`. Paid activation must use
  confirmed payment; free trials and unpaid/delayed checkout must not qualify.
  Reconcile asynchronous success and failure explicitly.
- Customer-only invoice mapping can apply unrelated invoices to a business. Resolve
  the invoice's subscription and match the saved subscription/business boundary;
  validate qualifying product, currency, positive collected payment and coverage.
- Subscription status alone changes plan; it is not evidence of a first successful
  paid charge. Store payment evidence separately from subscription state.
- The configured API-version period parsing reads a top-level subscription period
  field. Verify against version-matched fixtures and reconcile subscription-item
  periods rather than assuming a non-null paid-through date.
- Invoice failures record `past_due` without a defined access/grace policy. Canceled
  subscriptions set plan free but main's existing paid grant can remain active.
  Unify foreground access, background work and invitation eligibility. Cancellation
  at period end should retain already-paid access until its paid-through date;
  immediate cancellation, refunds/disputes and suspension need explicit policy.
- `stripe_event` is claimed in a separate transaction before state is written.
  A crash can leave an unprocessed claim that every retry acknowledges. Use an
  atomic durable event application or retryable processing state/lease, not an
  acknowledged permanent pre-processing claim. Test duplicate deliveries while
  processing and crash recovery, as well as ordering.
- Tests currently cover signatures only, not payment, lifecycle, ownership,
  entitlement or email fulfilment. Those integration tests are launch blockers.
- Billing's migration uses number 051, reserved in the deferred external-trigger
  restoration. Keep that pilot excluded and reconcile numbering/schema dependencies
  deliberately before merge; do not silently reuse a conflicting migration ID.

## Stable founder invitation contract

The app calls authenticated `GET /api/access` and renders only a validated
`founderGroup: { url }` response. Missing/null hides the card and request failures
never block onboarding. Keep the invite server-side and responses `no-store`.
Do not ship the URL in landing HTML, waitlist notices, local storage, analytics
or a browser `paid=true`/success-page flag.

When billing is integrated, replace the manual-only eligibility evidence with
durable server-confirmed paid invoices linked through first-class Stripe IDs.
Resolve the paying owner account explicitly: do not grant every staff member
founder-group access just because their business has a paid plan. Decide and
document team membership eligibility separately if desired. Avoid automatically
clearing an operator security revocation when a renewal webhook arrives.

The thank-you wording: “Thank you for supporting Jentera early. You're helping
us build something awesome. We'd love to work together and listen to your
feedback. Join our Founder WhatsApp Group for direct access to the founder—share
ideas, report an issue, or get help with your first workflow. Joining is optional.”
Include the group profile/sharing privacy notice. A shared group link remains
forwardable; application gating does not eject prior members or revoke a saved
invite. Use group admission controls and a documented support eligibility policy.

## Payment and email implementation sequence

1. Verify branch compatibility, migrations and business/account ownership before
   merge. Keep billing disabled until server and UI gates are tested together.
2. Model the one-plan RM99 → RM199 offer server-side with exact three monthly
   cycles. Verify prices/currency, disclose renewal before subscription consent,
   and protect promotion eligibility from repeat checkout/re-subscribe resets.
3. Reconcile signed subscription/invoice events into durable payment evidence,
   paid coverage and main's access checks. Reject test/live mismatches and invalid
   ownership; no fulfilment from the checkout success page.
4. Create a deduplicated appreciation-email outbox entry after the first eligible
   successful payment, in the same durable application of that event. Send only
   to the verified paying owner; retry safely and never re-invite on each renewal.
   Re-check eligibility before delivery if a refund/suspension arrives first.
5. Return the invitation in-platform from that same eligibility source; delivery
   or WhatsApp failure must not delay provisioning or the first workflow.
6. Test initial/failed/delayed/zero-value payment, three discounted cycles then
   normal renewal, retries, ordering, concurrent checkout, crash recovery,
   cancellation timing, expiry, refunds/disputes, cross-account access, revocation
   and email retries in an isolated sandbox before any paid release.

Tax, cancellation/refund terms, usage limits and support expectations must be
confirmed before live billing. Do not enable automatic tax based only on a flag
without checking applicable obligations and active registrations.
