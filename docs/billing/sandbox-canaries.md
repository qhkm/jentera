# Real Stripe sandbox canaries

This manual command is excluded from the normal test suite. It requires an
authorized Stripe CLI context for an explicitly named sandbox and starts a
throwaway local Docker Postgres. It refuses the production seller, live context,
remote database and production outbound HTTP. It never uses a real card.

Stripe credentials remain in the CLI secure store. The SDK's local transport
delegates serialized requests to the authenticated CLI without key arguments or
extracting keys. The forwarded signing secret stays in test-process memory.
Tests use the real billing handler, signed webhook handler and forced-RLS tables.

Before running, select the sandbox in Stripe and save its public Terms and
Privacy URLs. Sandbox settings are separate from the verified live settings.
Keep mandatory Terms consent enabled; do not bypass it to make a test pass.

Run from `worker/`, substituting the authorized CLI/profile paths and sandbox ID:

```sh
JENTERA_STRIPE_CANARY_CLI=/absolute/path/to/stripe \
JENTERA_STRIPE_CANARY_CONFIG=/absolute/path/to/config.toml \
JENTERA_STRIPE_CANARY_ACCOUNT=acct_YOUR_SANDBOX \
pnpm test:stripe-canary
```

The pricing scenario creates real sandbox invoices with a test clock, verifies
RM99 for three cycles then RM199, simulates a failed renewal, and confirms those
unrelated resources cannot activate the local fictional owner. This pricing
scenario passed on 17 September 2026. An earlier run was interrupted when the
local Docker daemon stopped; it was restarted and the pricing scenario rerun.

The hosted scenario creates checkout through the real launch handler, completes
a fake Visa card in hosted Checkout, receives actual signed CLI-forwarded events,
and checks activation, replay deduplication, four owner-bound invoice receipts,
failed-renewal evidence, period-end cancellation and a partial-refund hold.
Stripe's test clock advances the provider timeline, not Postgres `now()`; future
receipts are checked in the evidence ledger, not presented as real elapsed time.
The hosted scenario passed on 17 September 2026 after the operator configured
the sandbox's public legal URLs. Actual hosted payment and signed callbacks
verified activation and paid-only founder access, invoice deduplication,
9900/9900/9900/19900 minor-MYR receipts, unchanged paid proof after a failed
renewal, period-end cancellation and access/invite withdrawal after a partial
refund. The scenario completed in 111 seconds. No live customer was charged.

The browser canary targets the actual CVC input and required Terms checkbox,
not every element matching a broad label or every checkout checkbox. Database
bigint assertions normalize the driver's text representation. An attached
test clock must reach `ready` before its first explicit advance.

This establishes real hosted sandbox activation, not a live payment receipt.
Actual asynchronous non-card payments and dispute delivery are not claimed by
this scenario; the normal signed-handler tests cover those branches locally.

Sandbox test resources are retained for inspection. Normal Docker harness
cleanup removes only its own throwaway test database, never production data.

Live operator setup may use `POST /api/support/billing-webhook-enable` with
dedicated support bearer authentication and exactly
`{"confirm":"enable-reviewed-billing-webhook"}`. It only enables the reviewed
endpoint after readiness passes, requires live fulfillment already deployed
with purchases explicitly closed, and cannot alter URLs/events or open checkout.
Never invoke it before reviewing the real sandbox results. It does not itself
prove an external live delivery or a live charge.
