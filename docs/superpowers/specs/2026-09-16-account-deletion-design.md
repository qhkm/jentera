# Account deletion

Status: design, 16 September 2026. No code, no migrations, no deployment.

A person must be able to delete their account from inside the app. Apple
requires it of any app that offers account creation (guideline 5.1.1(v)), and
its own FAQ closes the obvious escape: an app that sends people to a browser
to sign up still has to offer deletion in the app. Google Play requires an
in-app path *and* a web URL, and asks about both in the Data safety form.
Neither store will list Jentera without this, so it blocks the mobile release
described in [the mobile apps design](2026-09-14-mobile-apps-design.md).

It is also owed on the web regardless of mobile. Nothing here is mobile work.

## Decisions taken

| Question | Answer |
| --- | --- |
| Deletion model | Lock out immediately, purge after a grace period |
| Owner of a team with members | Refused until the team is empty |
| Mechanism | Cascade-led, with a catalog test that keeps it honest |
| Confirmation | Type the account's email address |
| Cancel | Signed link in the confirmation email |
| Grace period | 7 days |
| Re-signup during grace | Refused, with the cancel path offered |

## Why cascade-led

Every table that references `business(id)` does so `on delete cascade` — 20
migrations' worth, checked on 16 September 2026. Deleting the business row
therefore removes the tenant data without a hand-written list of tables, and
this repo is at migration 049 and still adding tables weekly; a list would go
stale silently, and the failure mode of a stale list is data surviving a
deletion.

The cost is that a cascade is invisible: nobody reviewing the code sees what
it deletes. The answer is not to hand-maintain the list but to test it — see
*Proving it worked* below.

Seven references onto `app_user` do **not** cascade: `run.requested_by`,
`approval.decided_by`, `business_fact.updated_by`, `business_fact.confirmed_by`,
`connection.connected_by`, and `routine.created_by` / `routine.authorised_by`.
Deleting a user today fails on these. They all live in tenant tables, so an
owner's deletion clears them by deleting the business first. A staff member's
deletion cannot, and handles them explicitly.

## What happens, in order

### On request

One transaction sets `business.deleted_at` and `app_user.deleted_at`, revokes
every session, and writes the deletion record. From that moment `verifySession`
refuses, and all three doors refuse the address.

**Access ends at once; the grace period buys back data, not access.** That is
what the store rules actually ask for — deletion rather than deactivation —
and it means a stolen phone cannot be used to reverse the decision.

The sprite is **stopped, not destroyed**. Hermes memory lives on the sprite, so
destroying it here would make the cancel path a lie about what returns. (Sprite
slots are no longer a reason either way: the Fly account moved to the Hero plan
on 16 September 2026, raising the org's concurrent limit from 10 to 100.)

### The deletion record

`account_deletion` is **not** a tenant table and is not reached by the business
cascade. It holds the business id, the user id, the artifact keys, the sprite
id, the connectors to revoke, the stage reached, attempts, and `last_error`.

This is the load-bearing idea. The cascade that makes deletion reliable also
erases the only record of what lives outside Postgres: artifact rows name the
R2 keys, `runtime` names the sprite. Delete the business first and the external
cleanup has nothing to work from — orphaned objects and a live machine with
nothing pointing at them. The record outlives the data it describes, and is
what remains to retry from.

### The purge, after the grace period

Runs from the one-minute cron in `index.ts`, beside `dispatchDueRoutines` and
`sweepPushOutbox`. The due scan is cross-tenant, so it is a `SECURITY DEFINER`
function returning ids only — the same shape, and the same reason, as
`push_outbox_due`.

Every stage is resumable and recorded:

0. **Revoke connectors.** `connect.ts` already calls providers on disconnect
   (`:317`, `:450`). Cascading `connection` rows without this leaves live
   webhooks delivering to a tenant that no longer exists. Best effort, retried.
1. **Delete R2 objects**, from the keys copied into the record. Before any
   cascade.
2. **Destroy the sprite** through the existing `delete` runtime task — not a
   new teardown path.
3. **Delete the business row**, cascading the tenant tables.
4. **Delete the identity.** `app_user` cascades sessions, memberships, OAuth
   identities and chats. Then the email-keyed rows that reference neither
   business nor user and would otherwise survive: `platform_access`,
   `waitlist_entry`, `trial_redemption`, and any open `invitation` for the
   address.

### When an external system will not cooperate

Retry with doubling delays, as the push outbox does. But a sprite that will not
die still holds Hermes memory, which is personal data, so it cannot be quietly
abandoned: after eight attempts the record keeps `last_error` and the failure is
emailed to `SIGNUP_NOTICE_TO`, and a human finishes it. Fly has been unable to
clear an orphaned checkpoint for days at a time (`docs/todo.md`), so this is a
real path, not a theoretical one.

Purging the database and calling it done while a machine still holds the
person's memory is the version that looks finished and isn't.

## Owner versus staff

One button, two operations.

**Owner** destroys the business and the identity. Refused with a clear message
while any other member exists. The owner removes members first through
`DELETE /api/team/members/:userId`, which already ends everything about a
person in one transaction. Self-serve throughout, so the store requirement
still holds.

**Staff** leave the business, then delete the identity. The business survives,
so their rows in it are handled rather than cascaded: `run.requested_by`,
`approval.decided_by`, `business_fact.updated_by` / `confirmed_by` and
`connection.connected_by` are nullable and are nulled, keeping the business's
history with the person removed from it. Their chats cascade and die with them,
which is correct — a private chat is personal data.

`routine.created_by` and `routine.authorised_by` are `not null`, so a departing
member's scheduled jobs cannot lose their author. They are deleted: the
authorisation was personal and nobody else gave it. The confirm screen says so
in plain numbers — "3 scheduled jobs you set up will stop" — rather than
letting the owner discover it when a report fails to arrive.

## Routes and UI

`DELETE /api/me` requests deletion, Origin-checked like the team routes.
`GET /api/account/restore?token=…` cancels during grace: single-use, SHA-256 at
rest, the same shape as the magic link, because it arrives from an email.

Permission is not role-gated — anyone may delete their own account, which is
the store requirement. Ownership only decides which of the two operations runs,
and `permissions.ts` stays the one place that answers it.

Confirmation is **typing the account's email address**, not re-authentication:
two of the three doors have no password to re-enter, so a password prompt is a
dead end for Google and magic-link accounts.

The entry point lives in the app's settings, not only on the web. Both stores
require the path to be reachable inside the app, and the native shell renders
the same React.

Two emails: one on request carrying the cancel link, one when the purge
completes. Resend, like every other sender.

## Proving it worked

The worker suite runs real Postgres in Docker with migrations applied and RLS
live, so the purge is exercised for real. Assert as `aisar_app`, arrange as
owner, per `harness.ts`.

1. **The catalog test.** Read `pg_constraint` for every table with a
   `business_id` column and assert its foreign key is `on delete cascade`. A new
   table with a different rule fails the day it is written, rather than
   surviving a deletion months later. This is what makes the cascade reviewable.
2. **Seed everything, purge, assert nothing.** A fixture per tenant table, with
   a registry the catalog test checks for completeness, so a new table with no
   fixture also fails. The catalog assertion alone would pass vacuously against
   a table nobody populated.
3. **Ordering, proved by breaking it.** Make the R2 fake fail; assert the
   business row is still present and the stage has not advanced. The invariant
   is only provable by failing the external call.
4. **Staff versus owner.** After a staff deletion the business and its history
   survive with `requested_by` null, their chats and routines gone. After an
   owner deletion, both are gone.

And the ones protecting the lockout and the retries: a deleted account refused
at all three doors; the restore token single-use; eight failed sprite destroys
leaving `last_error` and sending the notice through `sendFake`.

**The end-to-end convention bends here.** The repo runs route changes against
the deployed API; a real deletion cannot be. It runs against a throwaway
account created for it, with the sprite and R2 cleanup verified by hand after.

## Not in this design

- **Ownership transfer.** "Refuse until the team is empty" removes the need for
  v1. It stays deferred in `docs/team-plan.md`.
- **Data export.** Deletion and portability are different rights; Malaysia's
  PDPA gives an access right this does not satisfy. Neither store requires it
  for a listing.
- **Admin-initiated deletion** for abuse or takedown.

## Re-signup during grace

The address is still in `app_user` and unique, so a signup would collide. All
three doors refuse it with "an account for this address is being deleted",
naming the cancel path — never silently resurrecting the account, and never
failing in a way that reads as a broken sign-up. The password door already
refuses to say whether an address exists; this message is the deliberate
exception, because the person on the other end is almost always the account's
owner changing their mind, and telling them nothing strands them for 7 days.

## Open questions

1. **Billing.** `stripe-billing` is unmerged. Once money moves, invoices must
   survive deletion — Malaysian tax records run to seven years — which is a real
   exception to "delete everything". Decide it when billing merges, not after
   the first deletion.
