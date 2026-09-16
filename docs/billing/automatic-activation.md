# Automatic payment → account activation

Implemented on 17 September 2026. Treat protected production readiness and
deployment read-back as the source of truth for current purchase availability.

## Purchase and ownership

The public launch entry is `https://jentera.ai/signin`. After verified sign-in,
an unpaid account continues to the internal `/subscribe` plan step only when
server checkout is enabled; existing paid/trial accounts enter their workspace.
Explicit waitlist visits and private trial invitations keep their existing flows.
The plan step creates a server-bound Stripe Checkout Session, not an
anonymous shared Payment Link. A verified new payer can create one private
onboarding business without provisioning a computer or getting product access.

The server selects the monthly MYR 199 Price and applies the product-scoped
MYR 100 discount for three months for first purchases only. Account-wide payment
history prevents resetting the launch promotion through another business.
Returning payers see MYR 199 before subscribing. The client cannot choose a Price,
amount, billing interval or promotion code. Terms consent is mandatory and FX
adaptive pricing is disabled. Dynamic payment methods remain enabled.

## Activation and lifecycle

Signed Checkout completion/delayed-success and invoice-paid callbacks verify:

1. The configured seller, API version and live/test environment.
2. Saved Checkout → Subscription → customer/business/paying-owner ownership.
3. A positive qualifying MYR invoice, its service period and single licensed item.
4. Its paid InvoicePayment, successful PaymentIntent and captured Charge, with
   matching customer, currency and amount and no refund or dispute.

Durable payment proof, subscription state, the expiring `platform_access` grant,
appreciation intent and event claim commit together. The paying owner then passes
the existing foreground and background access checks. Other accounts do not.
The success URL can only trigger read-only status polling; it never grants access.
Onboarding and computer provisioning still require their normal subsequent steps.

Renewal extends verified coverage. Payment failure does not invent a grace period.
Cancellation at period end keeps paid coverage; immediate cancellation/unpaid/
paused subscriptions expire Stripe-owned access. Operator security revocations
are never cleared by a callback. Refunds, including partial refunds, and disputes
put billing into a review hold. Reordered/closed-dispute or renewal events cannot
automatically remove that hold. No customer data or browser credentials are deleted.

Closing `STRIPE_CHECKOUT_ENABLED` stops new purchases, not ongoing signed
fulfillment or customer-portal cancellation. Do not roll back to a Worker without
the handler after subscriptions exist: disable purchases while keeping lifecycle
processing available. Review existing in-flight runtime work separately; an
expired grant does not forcibly kill an already-running remote command.

## Infrastructure prepared

Additive migrations 053–056 were applied and safety-verified on the reviewed
`jentera` production database on 17 September. Migration 051 stays reserved for
the deferred external-trigger pilot; that pilot was not restored. Payment,
adjustment, checkout, event and appreciation tables have forced tenant RLS.
Payment/adjustment evidence and processed event claims are not deletable by the app.
No access grant, customer subscription or charge was created by the migrations.

The live webhook `we_1UGLbFHuvvz49fq3KyDg81LF` was created **disabled** for
`https://api.jentera.ai/api/webhooks/stripe`, pinned to `2026-08-26.dahlia` and
the 12 handled event types. Its signing secret was piped directly into Cloudflare's
Worker secret vault; it was not printed or committed. Checkout remains disabled.

The public legal-policy setting was subsequently verified by a fresh versioned
Stripe request. Mandatory terms consent succeeded, creating inactive draft
Payment Link `plink_1UGLfoHuvvz49fq3ObHRInVe`; it is not the account-bound purchase
entry and must not be published/activated as a substitute for `/subscribe`.

The scoped backend release `d671439` is deployed. The restored original hero
and account-bound subscription frontend shipped as `a0ad5b5`, Pages deployment
`d6a05f68`, on both Jentera hostnames. `/subscribe` is no-store/noindex, and both
hosts serve byte-identical release JS/CSS. It does not unlock from a success URL.

The operator installed `STRIPE_SECRET_KEY` directly in the Worker secret vault.
The protected `/api/support/billing-readiness` check confirms a live restricted
credential type without returning it. It is read-only, uses existing support-key
authentication and does not open deployment gates or grant any entitlement.
Live verification passed for the expected seller, MYR launch catalog, payment-
evidence read permissions and the prepared signed endpoint's configuration.
The endpoint is still disabled. After the operator saved its settings, the
default live Customer Portal passed readiness for cancellation at period end
without proration, payment-method updates and invoice history.
The private founder invite was also installed directly in the secret vault;
anonymous `/api/access` still returns `founderGroup: null`.

Live verification found that Hyperdrive exposes an opaque gateway database name
in its per-request transport URI. `1669eb0` fixes the production boundary to
recognize the platform's native gateway transport and query the actual database
and role before live provider operations. Production read-back confirmed
`current_database() = neondb` and `current_user = aisar_app`; test databases and
RLS-bypassing roles are refused before provider calls. The reviewed Hyperdrive
config still points to the intended Neon origin with query caching disabled.
Worker version `9d9c3e79-3ece-4b20-a1b2-371a9c475c97` is deployed with all three
billing/purchase flags false. Runtime release and bundle pin are unchanged.

The sign-in-first UI update `3672f3e`, Pages deployment `db8a88ff`, is now live
on both hostnames with matching release JS/CSS. Its focused suites passed 73
tests, main's frontend passed 950, and eight synthetic live layouts passed.
Real Stripe CLI authorization succeeded for `acct_1UG91RH4SFQG9B5v`, test mode.
The real test-clock pricing/failure scenario passed, verifying 9900, 9900, 9900,
19900 minor MYR invoices and a failed renewal with no entitlement for unrelated
resources. This is not hosted Checkout activation proof: the hosted scenario
was refused at creation because the sandbox had no Terms URL. The verified
live public policy settings do not automatically configure the sandbox.
See [sandbox-canaries.md](sandbox-canaries.md) for the opt-in test and boundaries.

Operator setup/canary release `5ba65a7` is deployed as Worker version
`381c0b52-e78f-4966-bc33-01c54b6207fb`. Eight focused suites passed 158 tests;
main's Worker typecheck and three support/readiness/CORS suites passed 48 tests.
Production read-back still shows all billing/purchase flags false, the reviewed
webhook disabled and portal controls valid. The new setup endpoint returns 401
without authentication and 409 for a correctly authenticated request while live
fulfillment is off, without changing delivery or opening checkout. A fresh hosted
sandbox retry again returned Stripe's missing-Terms-URL error; no hosted payment
or activation canary is claimed. The pricing-only sandbox scenario passed.

## Go-live requirements

After the hosted scenario passed, the scoped backend's complete suite passed
1,143 tests in 95 files, and its source/test typecheck passed. Release
`d472709` deployed as Worker version
`5a902000-cc02-4aa4-8ff2-49f347128ffb` enabled live fulfillment while keeping
sandbox mode and new purchases off. The dedicated operator setup call then
enabled only the reviewed live endpoint. Protected read-back returned
`ready: true` with all checks passing; a public unsigned notification returned
400 `invalid signature`, and anonymous billing status remained 401.

The independent purchase gate shipped last as `c49ef7e`, Worker version
`9706e73e-d3a8-4146-a6bb-d79e06bf4109`, under the user's existing authorization
to enable paid checkout. Production read-back confirms `checkoutEnabled: true`
and `ready: true`, with every billing check passing. Anonymous access still
has no founder invite; billing status/Checkout creation are 401 without a real
session, and an unsigned callback is 400. No runtime pin or fleet was changed.

This is configuration/transport proof plus real hosted sandbox fulfillment,
not proof of a real live customer charge or Stripe-originated delivery to
production. The first real purchase must be completed voluntarily by its
account owner and checked end-to-end. No live card was used by the agent.
Actual non-card/dispute deliveries and appreciation email delivery remain
unclaimed; normal tests cover the signed-handler branches.

For the live acceptance check, use an unpaid verified account at
`https://jentera.ai/signin`, review the RM99 subscription step, voluntarily
complete Stripe Checkout, and verify the server-confirmed return to the
workspace and paid-only founder-support invitation. Existing paid/trial or
owner-exempt accounts enter the workspace instead of being forced to buy.

The hosted sandbox scenario subsequently passed after its legal URLs were saved.
It verified real fake-card Checkout payment, actual signed delivery, owner
activation and paid-only founder access, replay deduplication, all four
owner-bound invoice amounts, failed-renewal coverage, period-end cancellation
and a partial-refund review hold. No real card or production entitlement was
used. Actual asynchronous non-card and dispute deliveries are not claimed.
See the sandbox document for the 111-second hosted run and test boundaries.

- Keep the verified Terms URL `https://jentera.ai/terms` and privacy URL
  `https://jentera.ai/privacy` in public business details. The earlier missing-
  policy retry was a cached idempotent replay, not a failed operator update.
- Keep the verified replacement restricted credential in the Worker vault.
  Do not paste it into chat, a committed environment file, CLI arguments or a
  frontend variable. Real canaries must still verify payment writes and receipt
  fulfillment; live read permissions alone do not establish them. Sandbox
  hosted payment writes/fulfillment have passed. The replacement live key's
  reviewed endpoint update also succeeded; a real owner's first Checkout
  creation/payment remains an operational acceptance check.
- Keep the passing real isolated Stripe payment/renewal/cancellation/refund
  canaries. Extend provider canaries for asynchronous non-card payments and
  disputes before advertising those as independently verified. Their local
  signed-handler tests are not real Stripe payment canaries.
  CLI automatic sandbox creation was attempted in an isolated temporary profile;
  Stripe required browser authentication instead. The authorized isolated
  sandbox subsequently passed the pricing and hosted activation scenarios.
- Keep the verified Customer Portal controls enabled. Exercise cancellation and
  payment-method updates in the real isolated payment canaries before opening
  checkout; passing configuration checks alone is not a payment canary.
- Confirm the commercial included-usage allowance and enforce it before promising
  prepaid credits/top-ups. This slice adds no credit quantity or unlimited usage.
- Review applicable Malaysian/overseas tax obligations and active registrations.
  Automatic Tax was not enabled without that review.
- Deploy verified code/configuration, enable the reviewed live endpoint, verify
  readiness and public transport/signature rejection, then open the purchase
  gate last. Verify the first Stripe-originated production receipt against the
  voluntarily completed owner purchase; a configuration check is not that
  receipt. No customer is charged by merely opening the subscription page.

In-platform founder support uses the existing authenticated `/api/access` contract
and the verified active paid grant. Its shared invite remains private server
configuration. Appreciation email delivery, credit top-ups, trial-query admission
and periodic billing reconciliation are not claimed as implemented by this slice.

## Verification

Main's full Worker suite passed 1,153 tests in 98 suites, including the independent
purchase brake and protected readiness check. Main's full frontend suite passed
945 tests. Both app and Worker/test typechecks passed. The scoped backend's support,
readiness, Stripe and CORS suites passed 61 tests. Eight synthetic browser layouts
passed against the new live frontend with all authentication/API calls intercepted.
After the native-gateway/actual-database correction, both main and the isolated
backend passed typecheck and eight billing/support/Stripe/CORS suites, 143 tests.
Production-release focused tests and synthetic browser checks are recorded in
the launch-day release notes. These earlier release checks did not include a
real Stripe payment; the subsequently passing sandbox scenarios are recorded
above. No live customer/card payment is claimed.
