# Waitlist and three-day trials

The release configuration enables restricted access. Apply the migration before
deploying the Worker, then deploy the frontend: its production flag points public
signup to the waitlist. This rollout sends no customer emails and deletes no
accounts or data.

Policy when `ACCESS_MODE=waitlist`:

- Verified `qhkmdev90@gmail.com` retains access. This is not a login bypass.
- Paid access is an explicit, expiring operator grant after payment verification;
  business `pro`/`team` flags are not payment evidence. No checkout/webhook added.
- All other accounts, including existing free accounts, are restricted.
- Invite codes are email-bound, single-use, redeemable within seven days. A trial
  lasts exactly 72 hours from authenticated redemption. A user gets one trial;
  another code cannot extend/reset it. Only hashes are stored. No code in URLs.
- Public password signup closes. Google and email links can establish a verified
  restricted identity solely to redeem a code; this does not grant product access.
- Restricted identities land at `/access`. Existing session cookies do not bypass
  the product API gate. No business is migrated/created from the access page.
- Scheduled routines/reminders and queue admission require an eligible business
  owner; new model-proxy completion calls also check owner access.

## Operator commands

The private `/admin/launch` page is available only to the verified
`qhkmdev90@gmail.com` account. It lists waitlist/invitation recipients in pages
of 25, shows trial redemption and current grants, and can create email-bound
codes. Codes appear once and are not saved in browser storage; copy them for
manual delivery. No invitation email is sent. The first-completed-request
metric is a completed chat run after redemption, not proof of a useful business
outcome; only completion timestamps are shown, never chat contents. Paid grants
and revocation remain operator commands below.

Set `AISAR_NEON_OWNER_URL` securely (the script checks the reviewed production
database). From `worker/`, use `node scripts/manage-access.mjs` with:

```
migrate
invite recipient@example.com
grant-paid customer@example.com 2026-10-13T00:00:00Z payment-reference
revoke customer@example.com
list-waitlist
```

`invite` prints the secret code once. Deliver privately; do not paste into logs,
commit it or send from the app without a separate user request. Waitlist entries
consent to access updates only; no feedback/discount campaign is sent here.

New waitlist entries send an admin-only notification to `SIGNUP_NOTICE_TO`
(production: `qhkmdev90@gmail.com`), using Resend in `waitUntil`. Duplicate
submissions do not send again. The visitor receives no email. Delivery is
best-effort, like signup notices: mail failures do not undo the entry and are
logged, not retried. Existing entries are not emailed retroactively.

The trial-code card is hidden on the normal waitlist and access pages. Invite
recipients can open `/access?invite=1` to redeem; if not signed in, sign in first
and reopen that link. The URL contains no secret code and does not grant access
by itself; all server-side redemption checks still apply.

## Rollout checklist — explicit deployment required

1. Apply migration 041 with `manage-access.mjs migrate` and verify grants.
2. Review paid customers and record their verified paid-through dates. Do not
   grandfather business-plan flags. Verify the owner email is verified.
3. Review active runs, standing browser credentials and always-on VMs before
   enabling. API denial does not stop an already-running shell command, revoke
   a third-party login, or suspend a VM. Handle those with a separate scoped
   operational change; do not delete customer data. Existing open streams may
   finish delivering an in-flight result.
4. Set Worker `ACCESS_MODE=waitlist`, deploy Worker, then deploy Pages with
   `VITE_ACCESS_MODE=waitlist` (already in the staged production frontend config).
5. Smoke-test owner login, blocked existing free login/API, all three auth doors,
   invite wrong email/replay/expiry and expiry after 72 hours, paid expiry, and
   waitlist duplicate submission. Check Telegram and queued work are denied.

Unset `ACCESS_MODE` to roll back restrictions; grants and user data survive.
Unredeemed trial invitations can be revoked by setting `trial_invite.revoked_at`.
Team invitation codes are unrelated and never grant platform access.
