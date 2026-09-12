# Team features — what the tenancy model already gives us, and what it does not

Status: **assessment**. Prepared 12 September 2026 against `main` at b420104.
Every table, column, route and check named below was read in the code; the
production figures come from `stats.sh`. Nothing here changes production by
being written down.

## The request, as understood

More than one person in a business uses Jentera: the owner invites staff,
each person signs in as themselves, everyone sees the business's work, the
right people are asked for approvals, and each person is notified about
their own things. Possibly: a person who belongs to several businesses.

## Decisions taken on 12 September

- **Roles.** The person who creates the business is its owner (the
  "admin"); everyone invited is staff. Two roles at launch. Owner-only
  writes stay exactly as they are.
- **Privacy.** A staff member's chats are private by default. A chat is
  shared only when it lives in a **workspace** — a named space inside the
  business with its own members, whose chats every member can read and
  continue. Business outcomes (Activity, approvals, notifications) stay
  business-wide by role, as today.
- **Team is a plan, not a default.** Every account is one person unless
  the business is on a `team` plan, the way OpenAI sells Team above Plus.
  This is being built for a specific request; nobody else's account
  changes.
- **Telegram for staff:** later. **Seat limits:** later.

## Verdict

The current backend design supports it without a redesign. The tenancy
model is already a many-to-many between people and businesses with a role
on the edge, row-level security is per business (which is what a team
wants), and every record that matters already carries the person who acted.
What is missing is a way in (there is no invite), a way to switch business
(there is no switcher), telling the agent who is speaking, and choosing
notification recipients by role. None of it touches the two load-bearing
invariants in `CLAUDE.md`: `resolveTenant` stays the only source of a
business id, and RLS stays forced on every tenant table.

The decision that costs the most is private chats. RLS scopes by
business, so today any member reaches any run of the business through any
route that reads one, and the chat list itself lives only in the browser
(`useAsk.ts` keeps sessions in `localStorage` keyed by user). Private and
shared chats therefore need two things the design does not have yet: a
server-side chat session, and a visibility rule applied on every route
that reads a run. That rule is per-route filtering, not RLS — RLS stays
the business boundary — and the section below names each route. It is
additive work, not a redesign.

One honest limit to disclose in the product: "private" is private from
other people, not from the agent. Hermes memory and session search are
per business profile on the sprite, so a fact a staff member tells the
agent in a private chat can surface in another member's chat. Namespacing
agent memory by person is not cheap and is not proposed for v1.

## What exists today, verified

| Piece | Where | State |
|---|---|---|
| People ↔ businesses | `membership (user_id, business_id, role)`, primary key on the pair, `role in ('owner','staff')` — `001_identity.sql` | Many people per business and many businesses per person are allowed by schema |
| Tenant boundary | RLS by `app.business_id` on every tenant table (`002_rls.sql`, `003_state.sql`, `007_run_spine.sql`) | Per business, not per person |
| Role enforcement | `id.role !== 'owner'` at 14 sites: connections (`connect.ts`), approval decide, business/knowledge edits (`repo.ts`), runtime mutations (`runtime.ts`), browser, routines writes, task review (`runs.ts:329`) | Owner-only writes. Staff can sign in, chat (`POST /api/runs/ask` has no role gate), read Activity and notifications |
| Who acted | `run.requested_by`, `approval.decided_by`, `routine.created_by`, `outcome.observed.reviewedBy` | Written on every write, never shown in the app |
| Per-person delivery | `notification.recipient_user_id`, `push_subscription.user_id`, `push_outbox.user_id` (migrations 029–031) | Already per recipient; recipients are chosen only by `routine.created_by` today |
| Identity to the app | `GET /api/me` returns `...identity` including `role` and `businessId` | The app's `MeResponse` type ignores `role`, so nothing is hidden from staff |
| Session → business | `verifySession` (`auth.ts:344`) joins memberships, orders owner first, `limit 1` | A person in two businesses always lands in one; `session.business_id` exists in the schema and nothing writes it |
| Signing in with no business | `/app` sends the person to onboarding, which `POST /api/state/business` turns into a *new* business | The only path for a second person creates a second business |
| Tests | `task-review-route.test.ts` signs in a `staff` member and asserts 403 | The staff role is live in the harness |
| Production | 18 businesses, 18 memberships | No business has two members. Team mode has never run |

## What is missing

1. **A way in.** No invitation exists anywhere in `worker/`, `app/` or the
   migrations. Needed: an `invitation` table (business, email, role, token
   hash, expiry, invited_by, accepted_at), owner-only routes to create,
   list and revoke, acceptance on sign-in through all three entry points
   (magic link, password, Google — they converge on the same cookie, and
   `email_verified` is the anchor: an invite is consumed only when the
   signed-in address is verified and matches), a `membership` insert on
   accept, and in the app a Team tab under My Business plus a
   "you were invited to X" landing for a signed-in person with no business.
2. **Business switching.** `verifySession` ignores `session.business_id`.
   Needed only if one person can belong to several businesses: write the
   column on sign-in and on switch, prefer it in `verifySession`, add
   `POST /api/session/business`, a switcher in the account menu, and key
   the per-browser Ask history by user *and* business (today it is by
   user alone: `useAsk.ts` `sessionsKey(account)`).
3. **Who is speaking.** `prepareHermesAgent` (`ask.ts:316`) never names the
   person; the agent's prompt says "the owner". Hermes memory is per
   business profile, so a staff member's preferences would be saved as
   the owner's, and a staff request could read as owner authorisation.
   Needed: the speaker's name and role in the run instructions, and
   `requested_by` surfaced in Activity ("by Aisha") once a business has
   more than one member.
4. **Recipients by role.** Outcomes that need the owner (needs input,
   needs review, approvals) should notify every owner; a run a staff
   member asked for should notify that member. The outbox already delivers
   per recipient; the addition is a `recipientsFor(tx, businessId, …)`
   helper over `membership`.
5. **Permission map before more roles.** Owner-or-not is checked at 14
   sites by hand. Adding an `admin` or `viewer` role today is 14 edits.
   Replace them with one `can(identity, 'connections.write')` helper and
   a table of role → permissions first; the behaviour does not change,
   and a third role becomes a row.
6. **Offboarding.** Removing a membership must also revoke that person's
   sessions for the business (possible once `session.business_id` is
   written), delete their `push_subscription` rows for the business (they
   cascade only on user deletion today), and void their open invitations.
7. **Seats.** `business.plan` is `free | pro` (migration 016) with no seat
   count. Decide limits and enforce them where an invitation is created.
8. **Telegram.** One private chat is paired per bot
   (`telegram-internal-chat:<chatId>` scope, `connections.ts:146–202`);
   any other chat is refused. Staff on Telegram means one pairing per
   member mapped to a user, so `requested_by` is right and an inline
   approval button pressed by staff is refused. This is the largest
   piece and the least certain to be wanted; defer to v2.
9. **Web push across businesses.** The subscription endpoint is unique
   across tenants by design (409 → the app takes a fresh endpoint). A
   browser can be subscribed under one business at a time; switching
   moves it. Acceptable, worth knowing.

## The team plan — gate

`business.plan` is `free | pro` (migration 016), read by
`getBusinessPlan` in `agent-runtime.ts`. It is a control-plane fact:
nothing in the code writes it, an operator sets it by SQL against the
owner connection, and `apply-business-plan.mjs` exists to apply the
migration to production. In production today: 17 businesses on `free`,
1 on `pro`. Note that the always-on hold is not tied to the plan in code
today: `keepaliveGraceHours` reads `AISAR_KEEPALIVE_GRACE_HOURS`, set to
0 since 2026-09-09, and `getBusinessPlan` had no caller until this work.

The team tier is a third value, `team`, and it includes `pro`: when the
hold is tied back to the plan, `team` counts as `pro`. Concretely:

- Migration 033 widens the check to `('free', 'pro', 'team')` and
  `getBusinessPlan` returns the third value (`BusinessPlan`).
- Every team route — create or revoke an invitation, manage members,
  create a workspace or its members — checks the plan inside the same
  tenant transaction and answers 402 with "This business is not on the
  Team plan" otherwise. Reading is not gated: a business that leaves the
  plan can still see who its members are.
- `GET /api/me` grows `features.team`, the same capability-discovery shape
  Routines uses (`features.routines`), and the app shows the Team tab and
  "new chat in workspace" only when it is present. The routes enforce the
  same answer on every write, so the flag is a courtesy, not the gate.
- Setting the plan for the requesting business is the same operator SQL
  as `pro` today. Billing that sets it automatically is a separate piece
  of work and not proposed here.
- Leaving the plan: memberships stay in the table so an upgrade restores
  them, but a staff member's session to a business that is no longer on
  `team` resolves to no business, so staff lose access on downgrade and the
  owner keeps everything. Invitations still open are voided.

## Private chats and workspaces — design

**Server-side chat sessions.** A `chat_session` table (business, id,
`created_by`, `workspace_id` nullable, title, created/last-activity) and
a `session_id` column on `run` (today the id travels only inside
`trigger_ref`). The app creates the session row when a chat starts and
lists chats from the server instead of `localStorage`. Side benefit: chat
history follows the person across devices, which it does not today.

**Visibility rule.** A run is readable by a person when its session is
theirs (`created_by`), or belongs to a workspace they are a member of, or
the run has no session (Telegram, routines, ingest — business-wide as
now). One helper, `visibleRunFilter(identity)`, used by every route that
reads a run:

| Route | Today | With the rule |
|---|---|---|
| `GET /api/runs/:id`, `/events`, `/trace` | any member | filtered |
| `GET /api/artifacts`, `/api/artifacts/:id` | any member | follow the run |
| `GET /api/runs/activity` (work records) | any member | unchanged — outcomes are business-wide |
| approvals | owner decides | unchanged; the owner sees the approval, not the chat |
| notifications | per recipient | unchanged |

**Workspaces.** `workspace (business, id, name, created_by)` and
`workspace_member (workspace_id, user_id)`. Owner-only to create and to
manage members. A chat is personal or opened inside a workspace; it does
not move afterwards. Everyone in the workspace may continue its chats,
which means one Hermes session with several speakers — the speaker's
name and role in the run instructions (item 3 above) stops being a
nicety and becomes required.

**What does not change.** RLS, `withTenant`, the runtime, the outbox.
`run.requested_by` is already written on every ask.

## Suggested order

Each step lands on its own with tests, in the shape the repo already uses
(assert as `aisar_app`, arrange as owner).

0. The `team` plan value, `getBusinessPlan` and the keepalive gate,
   `features.team` on `/api/me`, and a `requireTeamPlan(tx)` helper the
   later steps call. No visible change for anyone not on the plan.
1. Permission helper replacing the 14 owner checks. No visible change.
2. Server-side chat sessions: migration 033 (`chat_session`,
   `run.session_id`), the app lists and creates chats through the API,
   `visibleRunFilter` on the run, events, trace and artifact routes. With
   one member per business this changes nothing visible except that chat
   history follows the person across devices.
3. Invitations: migration 034, owner routes, accept-on-sign-in through all
   three entry points, Team tab under My Business, the "you were invited"
   landing.
4. Speaker identity in the agent instructions; "by Aisha" in Activity.
5. Workspaces: migration 035, owner routes, "new chat in workspace" in the
   app, shared visibility through the same filter.
6. Recipients helper: owners for needs-you and approvals, the requester for
   their own outcomes.
7. Offboarding: removing a member revokes their sessions, drops their push
   subscriptions for the business, voids their invitations.

Later, as decided: Telegram pairing per member; seat limits on plan.
Deferred until asked for: a third role, one person in several businesses.

## Still open

- Downgrade behaviour: staff lose access when the plan leaves `team`
  (proposed above) — or keep read access? OpenAI removes members.

- Can the owner read a staff member's private chat? Proposed: no. The
  owner sees the outcomes in Activity and every approval; a private chat
  is private. Say if the requester expects otherwise.
- Do people belong to several businesses? Nothing above prevents it, but
  switching is not built until someone needs it.
