# The Team plan — reference

How more than one person works in one business on Jentera. Built and
shipped 12 September 2026; the decisions and their order live in
[`plans/2026-09-12-team-features.md`](plans/2026-09-12-team-features.md).
This is the reference: what exists, where it lives, how it behaves, and
how to operate it.

## The model in one paragraph

Every account is one person unless its business is on the **team** plan.
The person who creates a business is its **owner**; everyone invited is
**staff**. Owners decide: connections, approvals, runtime, routines,
business settings, the team itself. Staff sign in as themselves, chat with
Jentera, and see the business's outcomes. A **chat is private** to whoever
opened it unless it was opened inside a **workspace**, a named space with
its own members, whose chats every member may read and continue. The agent
is told who is typing. Owners are told when a colleague's work waits on
them. A staff seat counts only while the business is on the plan.

## Roles and permissions

| | owner | staff |
|---|---|---|
| Chat, read Activity, Files, Alerts | yes | yes |
| Read a colleague's private chat or run | no | no |
| Read and continue a workspace chat | if a member | if a member |
| Connections, approvals, runtime, routines, policies, task review | yes | no |
| Invite, revoke, remove members; create workspaces and their members | yes | no |

Permissions are rows in `worker/src/permissions.ts`; a route asks
`can(identity, 'approvals.decide')`. `permissions.test.ts` reads
`src/routes/` and fails on any hand-written `role !== 'owner'`, so a third
role is a column there and nowhere else. Only `owner` and `staff` exist.

## Data

| Migration | What it adds |
|---|---|
| 033 `business_plan_team` | `business.plan` admits `team` (beside `free`, `pro`) |
| 034 `chat_session` | `chat_session (business_id, id) pk`, `created_by`, `title`; `run.session_id` |
| 035 `invitation` | `invitation` with `token_hash`, `expires_at`, `accepted_at`, `revoked_at`; one open per address per business; `invitation_by_token(text)` security definer |
| 036 `workspace` | `workspace (business_id, id) pk`, `workspace_member (workspace_id, user_id) pk`; `chat_session.workspace_id` |
| 037 `notification_kinds` | `work_needs_you`, `approval_requested` |
| 038 `team_plan_gate` | `business_plan(uuid)` security definer, for session resolution |

Every table is under forced row-level security by `business_id`, like the
rest of the tenant. The two definer functions return one small fact for
one id each: the business behind an invitation token, and a business's
plan. They exist because the accepting person has no tenant yet, and
because `verifySession` runs outside any tenant transaction where
`business` is unreadable.

## Who may read a run

The rule is one SQL fragment, `visibleRunPredicate` in
`worker/src/chat-sessions.ts`, embedded by the run detail, events, trace,
Activity and artifact queries:

- a run with **no chat** (Telegram, a routine, an ingest) is the
  business's — every member may read it;
- a run with a chat may be read by the person who **opened** the chat and
  by every **member of the workspace** it was opened in.

A colleague's private run answers **404**, never 403, so the id alone
confirms nothing. Activity lists every outcome but carries `canOpen` per
row; the app hides "View task" where it is false and shows "by aisha" on a
team. The Files list follows the runs the viewer may read.

What "private" means: private from other people, not from the agent.
Hermes memory and session search are per business profile on the sprite,
so a fact told in a private chat can surface in a colleague's chat.
Namespacing agent memory by person is not done.

## Chats

The app generates a uuid per chat. Each ask sends it as `sessionId`;
`ensureChatSession` creates the row on the first turn — owner, workspace,
title from the first question — and later turns only move its clock.
`POST /api/runs/ask` accepts `workspaceId`: the asker must be a member
(403 otherwise) and the chat must be a real chat id (400). The workspace is
fixed at creation; later turns cannot move the chat.

`GET /api/chats?workspaceId=` lists a workspace's chats to its members,
newest first. `GET /api/chats/:id` returns one chat's turns — question, who
asked, status, the answer read the same way the run detail reads it
(`runtime/answer-text.ts`), its files — to whoever may read the chat. The
app uses these to show a colleague's workspace chats and to import one into
the browser so it can be continued (`useAsk.importSession`).

The agent is told who is typing: `speakerInstructions` in `worker/src/ask.ts`
appends one line to every app-chat run naming the address and role. Staff
are told, in the agent's instructions, that only the owner can approve or
authorise, and that what is learned about them is filed under their name.
Telegram and routines carry no speaker.

## The team surface

`worker/src/routes/team.ts`, `workspaces.ts`, `chats.ts`.

| Route | Who | Plan | Refusals |
|---|---|---|---|
| `GET /api/team` | any member | — | — |
| `POST /api/team/invitations` `{email}` | owner | team (402) | 400 bad address, 409 member or already invited |
| `DELETE /api/team/invitations/:id` | owner | — | 404 |
| `POST /api/team/invitations/accept` `{token}` | signed in | team (402) | 400, 404 unknown, 410 dead, 403 other address, 409 already in a business |
| `DELETE /api/team/members/:userId` | owner | — | 404, 409 the owner |
| `GET /api/workspaces` | any member | — | owner sees all with `member` |
| `POST /api/workspaces` `{name, memberIds}` | owner | team (402) | 400, 404 not a member of the business |
| `POST /api/workspaces/:id/members` `{userId}` | owner | team (402) | 404 |
| `DELETE /api/workspaces/:id/members/:userId` | owner | — | 404 |
| `GET /api/chats?workspaceId=` | workspace member | — | 404 |
| `GET /api/chats/:id` | opener or workspace member | — | 404 |

Cookie-authenticated writes check the `Origin` header against the allowed
origin, the way the task-review route does. `GET /api/me` carries
`features.team` when the plan applies; the app shows the Team tab, the
workspace controls and the shared-chat list only then. The routes enforce
the same answer regardless.

### Invitations

An invitation names an address. The token — 32 random bytes as hex —
travels only in the email; the row keeps its SHA-256, and acceptance is a
conditional UPDATE under a row lock, so a replayed link finds nothing.
Whoever signs in through any of the three doors with that verified address
may accept: every session already belongs to a verified address, so the
match is the check. An account that already belongs to a business is
refused with a message rather than attached to a second one it could never
reach — switching between businesses is deferred.

The email is a plain notice from the same sender as the magic link, with
the link `${APP_ORIGIN}/join?token=…`, valid seven days.

### Joining

`/join` is a public route, prerendered as a private noindex shell like
`/signin`. Signed out, it keeps the token in the browser under
`aisar-join-token` and sends the person to sign in; `/onboard` sends a
membershipless person with a stored token back to `/join`, so an invitee
never builds a business by accident. Signed in with the invited address,
it offers the token and reboots into the business. A different signed-in
address is told to sign in with the invited one and keeps the token; any
other refusal drops it.

### Offboarding

`DELETE /api/team/members/:userId` ends, in one transaction: the
membership, the person's sessions, their push subscriptions and pending
pushes for the business, their workspace seats, and any invitation still
open for their address. Their chats and the work they asked for stay as
history. The owner cannot be removed.

### Leaving the plan

A staff seat counts only while the business is on `team`. `verifySession`
and `authLandingPath` skip staff memberships otherwise, through
`business_plan(uuid)`; staff resolve to no business at once, the owner
keeps everything, and memberships stay in the table so an upgrade restores
them. Team writes answer 402. Reads do not check the plan, so a business
that left it can still see who its members are.

## Notifications on a team

Two kinds beside the routine ones (`worker/src/notifications/work.ts`,
called from the consumer):

- `work_needs_you` — a task someone else asked for ended waiting on the
  owner: needs review, needs input, or blocked;
- `approval_requested` — an action someone else asked for awaits an owner's
  decision.

Both go to every owner **except the one who asked**, once per run and
event, through the same inbox and push outbox; a tap opens the task. A
business of one person, where the owner asks everything, receives none of
them.

## The app

- **Team tab** under My Business (`TeamPanel`, `WorkspacesPanel`): members
  with roles, open invitations with revoke, the invite form, member removal
  behind a confirm step, workspaces with their members, create and
  add/remove.
- **Chat**: shared chats per workspace below the person's own
  (`useSharedChats`, `ConversationList`), "New chat in <workspace>", a badge
  on a shared chat, and a colleague's chat imported to be continued.
- **Activity**: `canOpen` hides the way into a private run; "by aisha" on a
  team.
- **Bottom bar** on a phone: Home, Activity, Alerts and More, with the rest
  behind More (`BottomNav`).
- Copy is in English and Malay except `/join`, which is public and
  English-only like `/signin`.

## Operating it

Put a business on the plan (the same way `pro` is set; nothing sets it
automatically):

```sql
update business set plan = 'team' where id = '<business id>';
```

Apply migrations to production in order with the scripts, each of which
verifies what it did:

```bash
cd worker
AISAR_NEON_OWNER_URL="$(neonctl connection-string --project-id red-haze-10375483 --role-name neondb_owner --pooled)" \
  pnpm db:migrate:business-plan-team   # 033
# then chat-session 034, invitation 035, workspace 036,
# notification-kinds 037, team-plan-gate 038
```

**Order matters.** A worker that writes `run.session_id` needs 034 first;
one that joins the workspace tables needs 036; one that resolves sessions
through `business_plan` needs 038, or every staff session resolves to no
business. Deploy the worker after the migrations, the app after the worker.

Look at it:

```bash
./worker/scripts/stats.sh sql "select plan, count(*) from business group by 1"
./worker/scripts/stats.sh sql "select count(*) from membership m join business b on b.id = m.business_id where m.role = 'staff' and b.plan <> 'team'"   # stranded seats, expect 0
```

On 12 September 2026 after shipping: 17 businesses on `free`, 1 on `team`
(Kitakod Ventures), no invitations yet, no workspaces yet, no stranded
seats.

## Not done, on purpose

- **Telegram for staff.** One private chat is paired per bot; staff on
  Telegram means one pairing per member mapped to a user. Later.
- **Seat limits.** `business.plan` has no seat count. Later.
- **A third role**, and **one person in several businesses**. Deferred
  until asked for; nothing above prevents either.
- **Deleting a workspace.** Its chats would have to go somewhere.
- **Agent memory by person.** See "who may read a run".
