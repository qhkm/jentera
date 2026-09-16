# Sign-in-first launch entry

The public launch CTA opens `/signin`, not the subscription page. A signed-in
account with existing access enters the workspace through the existing gates.
For a verified account without access, `/access` continues to the internal
`/subscribe` plan step only when `/api/access` confirms checkout is enabled.
Google, password and email-link sign-in retain their existing server callbacks;
the access step handles their common restricted-account destination.

Explicit `/waitlist` visits and trial invitations remain available. Trial
redemption, creating checkout and submitting payment still require explicit user
actions. Query parameters cannot establish identity, payment or entitlement.
The payment-return page only reads server-confirmed activation status.

No storage keys, cache headers, billing gates, runtime pins or fleet configuration
changed in this routing release. Existing purchase gates remain closed until real
isolated Stripe payment canaries and live signed delivery verification pass.

Verification on 17 September 2026: app typecheck/build passed; six focused release
suites passed 73 tests; the main frontend passed 950 tests in 103 suites. Eight
synthetic browser layouts passed, covering sign-in-first entry, authenticated
restricted-account forwarding, pending payment, onboarding, setup and paid-only
founder invitation. All API/authentication/provider calls were intercepted;
these checks did not create an account, deliver an email or charge a card.
