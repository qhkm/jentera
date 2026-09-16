# Consolidated launch release — 17 September 2026

The owner requested committing and deploying all completed launch work after
the sectioned sidebar was found missing from the isolated frontend release.
This release consolidates the previously verified frontend and billing trees
into main, rather than publishing an older branch over current paid access.

## Included

- Desktop Overview / Work / Workspace sidebar sections, EN/BM headings,
  keyboard navigation and scrolling on short desktop screens.
- Existing responsive connector directory and refined check/disconnect actions,
  with confirmation controls centred clear of phone navigation.
- Calendar/browser/missing-details recovery in private Chat and Activity:
  bounded read-only checks, then a reviewable continuation draft. It never sends
  automatically, grants approval, or claims/releases browser control.
- Current launch offer, original hero, slim announcement, workflow-first
  onboarding, signed-in account email, live Checkout and ten-chat preview.
- Operator-only waitlist announcement preview/send controls and sanitised email
  diagnostics. Deploying does not send an announcement.

The external-trigger prototype is hash-verified and archived in
`future/external-triggers`, outside active app/Worker/schema inputs. Its launch
exclusion test remains enabled. It is not deployed or activated.

## Pre-release verification

- App typecheck and production build pass; full app suite: 104 files / 980 tests.
- Worker source and test typechecks pass; full Worker suite: 99 files / 1,187 tests.
- After tightening announcement-table grants, five focused Worker files / 91
  tests pass, including an application-role append-only permission assertion.
- Four standalone webhook-setup helper tests pass without provider writes.
- Eight connector/sidebar/recovery browser cases pass, including 320–1440px,
  EN/BM, dark/light and 1024/1280px short desktops.
- Eight launch-funnel browser cases pass from 320–2048px, including account email,
  original hero, offer navigation, trial exhaustion and paid-only invitation.

Browser checks serve real built app assets with fictional API responses. No real
account login, charge, email, group join, provider call or agent execution occurs.
Screenshots are in `/private/tmp/jentera-consolidated-qa.5OjMsl`; desktop sidebar
and phone connector cards were visually inspected.
These checks are not an independent security audit or proof of every live AI task.

## Database and runtime

Only additive migration `052_waitlist_notice.sql` was newly applied to the
reviewed production branch. The first attempt rolled back because default table
privileges violated the append-only check. Explicit revocation fixed it; the
second attempt and a read-only production verification pass. No email was sent.
Existing billing migrations 053–056 and preview migration 057 were already live.

Read-only diagnostics now explicitly target Neon's `production` branch and
use the direct endpoint, preserving the read-only startup option.

Hermes/runtime pins remain release `2026.09.16-4`, bundle
`dc2f75c43f675a9444488abd88bcb10a97a601ae`. The pinned transfer-field check passes.
No Sprite bootstrap, runtime fleet change, credential rotation or OAuth-scope
change is part of this release. Existing live Stripe secrets are preserved.

## Publication

Source commits include `ab6d71e` (billing/preview), `c6c1a8f` (announcements),
`21e25c4` (launch onboarding), `40669bc` (account email), `311d002` (sidebar),
`0da5116` (recovery), and `65defb7` (phone confirmation layout).
Both services were published from source revision `dac64d2`:

- Pages deployment: `4c3ff751` (`aisar-jentera`, production branch main).
- Worker version: `d910f733-ed3e-41aa-b4e8-170229a8339e` (`aisar-api`).
- Main asset: `index-DKyGPq0S.js`; shared CSS: `index-C8-3zUom.css`;
  Dashboard: `Dashboard-C1tPFFl5.js` / `Dashboard-GeKzflRM.css`.

Six main/shared/Dashboard assets on each of `jentera.ai` and `jentera.aisar.ai`
match local build bytes by SHA-256. The published API reports checkout enabled,
keeps the founder invite private, and answers 404 for anonymous admin access.
The real preview/payment-readiness canary passes: verified ten-chat preview,
exhausted read access, unverified denial and all live Stripe readiness checks.
It creates no payment or AI request and removes its exact temporary fixture.
All eight launch-funnel browser cases also pass against published assets with
fictional APIs. All eight published connector/sidebar/recovery browser cases
pass as well, including both short desktop layouts. No customer account was
changed by these checks.

Deployment targets are only `aisar-jentera` Pages and the existing `aisar-api`
Worker. The separate `aisar.ai` Pages project and native store builds are untouched.
Installed PWAs retain their explicit update prompt; no mid-reply forced refresh.
The release retains the existing `/subscribe` no-store/noindex cache rules and
does not add storage keys beyond the already verified launch/preview changes.

Rollback uses the previous Pages deployment `9034b68d` and Worker version
`d9e0e283-74a0-4e74-b661-eda97b6df190`. Keep the additive announcement table;
do not remove evidence or roll back existing paid-access migrations.
