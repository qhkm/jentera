# OpenMausBot: what Jentera can take from it

Recorded: 23 September 2026, against
[milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) at
`039aed8`. Owner decisions added 24 September 2026.
Status: reference. Nothing here is built. The actionable rows live in
[`docs/todo.md`](todo.md), under **Gaps in what is live** and
**Post-launch: OpenMausBot-inspired improvements**; this document is the
reasoning behind them.

## Summary

OpenMausBot is an open-source, local-first desktop app that is itself a clone
of Grok Bot: a chat app where every contact is an AI agent. Our infrastructure
is ahead of it: queue, scheduler, budget enforcement, approval integrity,
push. What it has that we lack is a set of owner-facing conveniences, about a
dozen of them, most of them small.

The comparison also turned up four gaps in what Jentera has live. Those matter
more than anything to copy:

1. The agent cannot reach Bukku, and a Bukku write cannot be approved.
2. A Telegram voice note gets no reply.
3. A business of one is never pushed when an approval or a result is waiting.
4. An approval expires after 60 seconds. That one is a known, documented
   trade-off rather than a bug.

The owner decided on 24 September to keep two things for later expansion that
the first reading had set aside: specialists working together, and Composio
for connector breadth. Both appear below with the preconditions that make them
safe to build.

## What OpenMausBot is

An Electron app for macOS, Windows and Ubuntu, with a harness server on
`127.0.0.1:8799` that owns every agent process. Each "bot" runs on a coding CLI
installed on the user's own machine (`claude`, `codex`, `grok`, or any
ACP/OpenAI-compatible engine), with:

- its own model and personality;
- a computer: a cloud Linux desktop from box.ascii.dev, a local VM, or the host
  itself;
- connected apps through Composio.

Around that sit several further features:

- channels;
- a Chief of Staff bot that routes and triages;
- routines;
- voice replies and calls;
- a stdio MCP server for outside clients;
- one-file team packages, published through BotMRR and the `openmausbot-teams`
  repository.

It is built for **one person on one machine**. State lives in files under
`~/.openmausbot` and in in-memory maps inside a single process. Keep that in
mind when reading its code: many of its shortcuts are safe only because there
is one owner and one process, and neither is true of Jentera. There are
several tenants under RLS, a control plane on Workers, and a runtime on a
remote sprite.

## Licence

Apache-2.0, © 2026 Milind Soni and OpenMausBot contributors. The exception is
`enterprise/`, which is source-available under its own licence. **Copy nothing
from `enterprise/`**, including the hosted Slack logic, whose open part is only
a deep link.

Porting code is allowed. A ported file keeps a header that names OpenMausBot,
its copyright and the Apache-2.0 licence. Jentera has no `NOTICE` or
third-party notices file yet, so the first port should add one at the repo
root. Their own `NOTICE` lists MIT and CC0 material inside the project (T3
Code, hpke-js, Simple Icons, Lobe Icons). None of it sits in the files this
document suggests porting.

## Gaps this found in Jentera

Each of these was confirmed in our code, not taken from the comparison.

### The agent cannot reach Bukku

Bukku is in `LIVE_CONNECTORS`, and `POST /v1/runtime/connector` exists
(`worker/src/routes/runtime-connector.ts`). But nothing on a sprite calls it:

- `RUNTIME_CONNECTOR_PATH` is referenced only by its own route;
- there is no wrapper beside `jentera-calendar` and `jentera-gws`;
- `ask.ts` does not mention it;
- the only Bukku code in the runner is the connect recipe in
  `runner/src/browser-recipes.mjs`.

The route has a second problem. It decides with `riskOf` (line 91), not
`policyFor`, so:

- the owner's Permissions settings do not govern it;
- anything above low risk answers 403 `needs_approval` ("cannot be asked for
  from here yet") instead of queueing an `approval` row the way Google
  Calendar does;
- after approval, `routes/repo.ts` can execute only Calendar `create_event`.

This is the approve-then-execute path that every further connector, Composio
included, needs first.

### Telegram voice notes get no reply

`parseUpdate` in `worker/src/connectors/telegram.ts` returns null for any
message without `text`. That silence is deliberate: an error would make
Telegram redeliver forever. The result is that a voice note gets no reply and
leaves no trace, and Malaysian owners send voice notes constantly, often in BM.

The pieces for a fix are mostly in place. Workers AI is already bound as `AI`,
so Whisper is available. The one catch is that Telegram's file URL carries the
bot token, so the download belongs in the vault Worker behind a new
allow-listed route. OpenMausBot's rule is worth keeping: an approval is never
inferred from speech.

### A solo owner is never pushed

`worker/src/notifications/work.ts` sends `approval_requested` and
`work_needs_you` to owners `except` the requester, and returns 0 when a run has
no requester. `notifications/recipients.ts` gives the reason: the requester "is
watching the answer land". That is true on the web only while the tab stays
open. In a business of one, an owner who asks and puts the phone away hears
nothing.

OpenMausBot notifies on "needs approval" and "has a question" always, and on
"finished" when there is a summary (`server/notify.ts`). When we build it,
decide on the server whether the requester was still connected. Don't decide
in the service worker: Chrome allows a push with no visible notification only
while a window is focused, and Safari may cancel subscriptions that receive
silent pushes.

### Approvals expire after 60 seconds

This is a trade-off, not a bug. [`plans/2026-09-10-web-chat-approvals.md`](plans/2026-09-10-web-chat-approvals.md)
§3 keeps `HERMES_APPROVAL_WAIT_SECONDS = 60` (`runtime/consumer.ts:195`) for
two reasons:

- **Three clocks run through the wait, and none can tell waiting from working:**
  - the reservation deadline;
  - the runner's task-age limit;
  - Hermes's own `approvals.timeout`, set to 90 s in
    `configure-model-provider.py`.
- **The whole business blocks.** The `approval_wait` predicate blocks every
  other lease for the business while an approval waits.

Even so, an approval works only while the owner is looking at the chat.
OpenMausBot waits 15 minutes (`APPROVAL_TIMEOUT_MS` in `server/peer-approval.ts`),
and its stall watchdog skips a turn that is waiting on a person
(`setWaitingOnHuman` in `server/turn-watchdog.ts`). It can afford to, because
it has no business-wide slot to block.

The shape that suits us:

- end the Hermes run when it asks;
- persist the pending action;
- resume with a one-shot grant when the owner decides.

Nothing waits in the meantime. Do this after the push fix above.

## Ideas worth taking

Ranked within each area. Effort: S is days, M is a week or two, L is longer or
needs a Hermes change.

### Approvals, safety and spend

| Idea | OpenMausBot | Jentera today | Take |
|---|---|---|---|
| Credit meter and 80% warning (S) | Warns once a month at 80% and once at the cap (`server/spend.ts`, `DEFAULT_WARN_AT_PERCENT = 80`); usage ledger by bot, model, person and day with CSV (`server/usage-ledger.ts`) | Enforcement is strong, but `runtimeBudgetSnapshot` is returned by `routes/runtime.ts` and nothing in `app/src` reads it. The owner first hears about spend from `CREDIT_CAP_NOTICE`, after work has stopped | A meter in the app. One notification at 80% per month keyed `credit_warn:YYYY-MM`: `createNotification` already does `on conflict (business_id, recipient_user_id, source_key) do nothing`. A breakdown later, through `runtime_usage` → `runtime_task` → run |
| Secret redaction (S) | `shared/redact.ts`, 66 lines, no dependencies: `sk-`, `AKIA`, `ghp_`, JWTs, PEM keys, passwords in URLs, `--token`, `KEY=` | The runner's `safeToolPreview` catches `Bearer` and `key=value`; `sanitizePublicRuntimeText` rewrites paths only. Nothing scrubs customer-bound Telegram text when `send` is automatic | Port the file with attribution into the Worker and the runner. Apply it to customer-bound Telegram text, approval previews and notification bodies |
| Credential request that resumes the task (M) | A fixed list of credential targets; `SecretRequestCard` saves the key and resumes the turn without the bot seeing it (`shared/credential-request.ts`) | Same fixed-list principle for `google_calendar` only (`app/src/lib/connection-handoff.ts`); resuming is manual | The idea, through the vault deposit Worker, for Bukku's API token first |
| "Always allow" for one action on one target (M) | `allowKey` scoped to one action and one target (`server/peer-approval.ts`) | Policy per operation for the whole business only (`policy.ts`, `PermissionsPanel`) | "Don't ask again for this customer or calendar", listed and revocable in Permissions |
| Why an action went through (S) | `server/decision-log.ts`: who decided, which rule, whether anyone was watching | `action.executed` does not say whether policy or an owner approved it | Add the decision source to the event |

### Orchestration, queueing, routines and notifications

| Idea | OpenMausBot | Jentera today | Take |
|---|---|---|---|
| Routines proposed from chat (M) | A tool call becomes a confirmation card with the rule, the time zone and the next 3 dates; applying it is bound to what was shown by a SHA-256 fingerprint (`server/routine-requests.ts`) | One-time reminders only (`app/src/lib/reminders.ts`); `ask.ts` tells the agent "Recurring requests belong in Routines", so the owner leaves chat for a form | A `jentera-routine` block and card mirroring the reminder card. Nothing is created until the owner confirms the fingerprinted draft. This delivers the Grok Bot "Repeat this task" row in `todo.md` |
| Monthly and month-end schedules (S–M) | Monthly (including last day), cron, interval and one-off, each with a time zone, on Croner (`shared/routine-schedule.ts`) | `daily`, `weekdays`, `weekly`, Malaysia time (`worker/src/routines/schedule.ts`) | Monthly and last-day, at least. Croner is pure JS; confirm it runs under Workers first |
| Fold queued follow-ups (M) | Messages sent while a bot is busy run as one follow-up turn, cancellable before it starts, surviving a Stop (`server/steer-queue.ts`, `docs/specs/steer-vs-queue.md`) | Each message is its own run behind the business-wide lease (`runtime/inline-slice.ts`), so a Telegram burst becomes 2–3 paid, disjointed turns | Fold not-yet-started tasks from the same session when the lease is taken |
| Owner ahead of routines (S) | Direct messages outrank background work (`docs/plans/2026-09-02-bot-concurrency.md`) | `nextWaitingRuntimeTaskId` orders by `created_at, id` (`runtime/tasks.ts`) | Interactive tasks lease before scheduled ones |
| Carry the last report forward (S) | `Routine.continuity` hands the previous run's report to the next (`server/routines.ts`) | Each occurrence gets a fresh session (`routine:${occurrence.id}`); recent work may or may not include the last result | Pass the previous occurrence's result to the next, so "what changed since last week" works |
| Pause a routine that keeps failing (S) | `failureStreak` on routines; incidents triaged with capped retries and muting (`server/incidents.ts`) | A `routine_failed` notification each time | Pause after N failures in a row and say so once |
| Steering a running turn (L) | A second Enter sends text into the running turn without killing it; needs `turn/steer` in the engine | No interrupt or steer path in the runner | A spike later, only if Hermes can support it |

### Memory, skills and packages

| Idea | OpenMausBot | Jentera today | Take |
|---|---|---|---|
| Replay the chat when it changes specialist (S–M) | An engine new to a thread gets the history once, then normal resume (`server/turn-context.ts`, `FRESH_PREAMBLE`) | `specialistForTurn` keeps a chat on one specialist for 6 hours. That works around the failure in `architecture.md` §5 but does not fix it. The turns are already in Postgres (`routes/chats.ts`) | When the answering profile differs from the chat's previous one, prepend the last few question/answer pairs once |
| Save a finished run as a how-to (M) | `/learn` or a card has the agent draft a SKILL.md (When to use / Procedure / Pitfalls / Verification), held until a person approves the exact text (`server/skill-learn.ts`, `stageSkillWrite`) | Hermes's background skill review is pinned off for cost (`configure-model-provider.py`: 23K–62K input tokens a run). Every specialist's `skills/` folder is empty | A "Save as how-to" on a completed run. The draft lives in Postgres behind an approval card and reaches the specialist through the config document. Serves the Grok Bot rows "Repeat this task" and "Show Jentera how" |
| Business-type packages (M–L) | A whole team from one Markdown file with a YAML header: references checked, installed into its own section, routines paused, connected apps off, required apps as a checklist; export carries setup, never runtime state (`server/bot-package.ts`, `team-library.ts`, `package-export.ts`) | `app/src/lib/data/playbooks.ts` is demo data. Every business gets the same four specialists from migration 028, whatever its type | Our own format: specialist instructions, role skills, routines created disabled, a connector checklist filtered to `LIVE_CONNECTORS`, and the facts onboarding should collect. Demo figures stay out of it. The first packages are written and reviewed in the repo, with no import scanning yet. Export for agencies later, then a marketplace |
| Memory history with undo (M) | Memory files diffed around each turn; each change is recorded with the chat that caused it and can be undone (`server/memory-journal.ts`) | Forget only: no history, no source, no sign of how full memory is | The runner diffs `MEMORY.md`/`USER.md` around each task and posts changes with the run id to a table under RLS |
| Tell a shared chat when private recall was used (M) | `server/recall-disclosure.ts` | Private chats are "private from people, not from this memory" (`team-plan.md`) | Later, for the team plan. Needs the runner to see `session_search` hits |
| Specialist edit history (S) | `server/profile-versions.ts` | `specialist_profile` has none | When specialists become editable by owners |

### Computer use and progress display

| Idea | OpenMausBot | Jentera today | Take |
|---|---|---|---|
| Sign-in handoff in fewer taps (S) | The bot asks for hands; handing back settles the request and the waiting bot carries on (`server/computer-control.ts`, `ComputerPanel.tsx`) | Open → Take control → sign in → Hand back → close → Check → Continue → Send: about 8 taps (`BrowserHandoffCard`, `BusinessBrowser`, `TaskRecoveryActions`) | Opening from the card claims control. A successful Hand back runs `checkTaskRecovery` and puts the continuation in the composer, and the owner taps Send. Nothing auto-sends |
| Final-screen screenshot (M) | One frame at turn end, only if a screen-changing tool ran and it differs from the last frame by sha256 (`finalScreenFrame`, `server/screen-frame-gate.ts`) | Frames are never stored | Needs an explicit decision to store frames, and the frame must pass the page privacy filter. Then one artifact per qualifying run, as proof of the work |
| Event-driven preview (M) | Captures right after a screen-changing tool, bypassing the throttle (`pokeScreenPoller`, `server/screen-frame-source.ts`) | The fallback preview polls on a timer; the observe plan measured 55 MB/hour whether anything changed or not | Capture on browser-tool completion; send "unchanged" instead of a repeated JPEG |
| Owner takes over mid-run (L) | `BrowserRuntime.take()` blocks new agent actions at once and lets in-flight ones finish (`server/browser-runtime.ts`) | `/v1/browser` answers 409 `runtime_busy` during a task | Needs a Hermes hook, because Hermes drives CDP directly. Low priority on phones |
| Cheaper working timer (S) | `WorkingTimer` updates one text node a second | `LiveTaskProgress` re-renders and re-runs `presentTaskSteps` each second | Port the pattern |

### Connectors, MCP and voice

| Idea | OpenMausBot | Jentera today | Take |
|---|---|---|---|
| Voice-note intake (S–M) | Voice replies and macOS calls (`server/tts/`, `docs/voice-mode.md`) | None, and voice notes vanish (see Gaps) | Intake first. Replies later: `speech-text.ts`, which rewrites markdown into speakable text, is portable |
| Connector help on demand (S) | Composio's search → schema → execute pattern keeps tool descriptions out of the prompt | `ask.ts` sends about 2.5K characters of Calendar instructions every turn, and each connector added this way grows the prompt | A `jentera-connector help <name>` subcommand in the wrapper the Bukku gap needs anyway |
| Tune Hermes `tool_budget` (S) | `server/mcp-trim.ts`/`mcp-gate.ts` trim tool results at 8K. They measured a "full result saved at …" hint making the model read the file back: 210,913 tokens with trim and path, 196,183 with no trim | Never set, so defaults apply: results over 100K characters (50K for MCP) are saved with a "use read_file" hint | Measure before and after with `model_call` (`toolsChars`, `historyChars`) on the same tasks; keep the cheaper setting |
| Several accounts per app (S–M) | Labelled accounts per app | The newest connection wins (`order by connected_at desc limit 1`) | When a customer asks |

## Kept for expansion

The first reading set both of these aside. The owner decided on 24 September
to keep them for later growth. They are recorded here with the constraints
that make them safe to build.

### Specialists that work together

**Today.** One specialist answers each turn. Hermes's `delegate_task` runs a
sub-agent inside that same turn, and `worker/src/coordination.ts` records only
its start and end (`agent.delegation`). No specialist can hand work to another
that finishes later, and several cannot work one goal together.

**OpenMausBot** has four pieces:

- **Chief of Staff:** routes and triages (`server/chief-of-staff.ts`).
- **Delegations:** a bot hands off work and the result posts back when it is
  done (`server/delegations.ts`).
- **Handoffs:** passing a conversation between bots in a room
  (`server/room-handoffs.ts`).
- **Goal run:** a goal shared across bots (`server/group-goal-run.ts`).

**The constraints for ours:**

- **Show outcomes, not a roster.**
  [`marketing/product-thesis-and-homepage.md`](marketing/product-thesis-and-homepage.md)
  rules out a roster or a workforce-management screen. The owner sees one
  answer, and who did which part, never a room of bots to manage.
- **Specialists take turns for now.** A sprite has one runner slot, so they
  cannot work in parallel until the runner can.
- **The same approval gate applies.** Every child action passes through it.
  Delegation must not become a way round the gate.
- **Limits come first.** Depth, fan-out and cost per child run are capped
  before anything is built. OpenMausBot's single-bot `/goal` loop exists only
  as a plan (`docs/plans/2026-09-02-goal-mode-v2.md`). Only the multi-bot room
  goal run is built.

Write a plan in `docs/plans/` before any code.

### Composio for connector breadth

**Why.** Three connectors are live, and nine are placeholders in
`worker/src/connectors.ts`. Composio handles sign-in and actions for hundreds
of apps: Gmail, Sheets, Drive, Slack, Notion and more. It is the fastest way
to widen coverage. It does not cover Bukku, Shopee, Billplz or WhatsApp as a
channel, so it sits beside our own connectors and does not replace them.

**How OpenMausBot does it.** It opens one Composio session per install and
gives the agent generic tools to search, fetch a schema, execute and manage
connections (`server/composio.ts`, `server/connector-proxy.ts`,
`docs/composio.md`). It checks nothing itself: `docs/approval-levels.md` says
there is "no app-side allowlist, classifier, or pattern rule". **That part we
cannot copy.**

**Our preconditions, in order:**

1. The approve-then-execute path from the Bukku gap exists.
2. The Composio key lives only in the Worker and never reaches a sprite: one
   project key opens every business's connected accounts. The business id is
   the Composio user id.
3. A per-tool allowlist: listed reads run, and everything else becomes an
   `approval` row.
4. The privacy page says Composio holds the tokens, and disconnecting revokes
   them at Composio.
5. A decision between Composio's managed sign-in and our own OAuth app. The
   managed one puts Composio's name on Google's consent screen. Our own brings
   Google's verification for Gmail's restricted scopes back; see
   [`google-oauth-publication.md`](google-oauth-publication.md).
6. A pilot of Gmail, Sheets and Drive. Each app joins `LIVE_CONNECTORS` only
   once its execute path, connect flow and name are all real, the rule
   `CLAUDE.md` already sets.

## Not taken

- **Owner-added MCP servers** (`custom-mcp-servers.md`, `mcp-registry.ts`,
  `mcp-probe.ts`). Mounting them on a sprite puts tokens there and skips
  approval, so they would need a relay through the Worker. Low value for SMB
  owners.
- **Jentera as an MCP server** (`docs/mcp-server.md`). Their v1 deliberately
  cannot approve anything, which is the right boundary, but no customer needs
  this yet.
- **Voice calls.** They are macOS-only and half-duplex there, and a poor fit
  for owners on phones. Voice-note intake covers the real need.
- **Per-turn git checkpoints, compaction, context diffing**
  (`checkpoints.ts`, `compaction-summary.ts`, `delta-context.ts`,
  `section-context.ts`). They solve switching between CLI engines on one
  machine. Hermes owns sessions and compression for us, and our agent writes
  to a per-task folder that goes to R2.
- **Peer approval, room post budgets, the turn-dispatch guard, managed-device
  policy.** We have no bot-to-bot rooms or device management, and we use
  durable leases. Revisit peer approval only if specialists that work
  together get built.
- **Webhook triggers.** Ours are parked in `future/external-triggers/` with a
  timestamped HMAC, stronger than their static secret. Two of their ideas are
  worth adding to that design when it is revived: a sample-capture step
  before first use, and a per-attempt log.

## Where Jentera is already ahead

Don't chase these; they are the parts of OpenMausBot we would downgrade to.

| Area | Jentera | OpenMausBot |
|---|---|---|
| Queue | Postgres `runtime_task` with leases, an outbox and recovery when a worker dies | An in-memory map, with SQLite follow-ups, in one process |
| Scheduler | Unique `(business, routine, scheduled_for)`, a security-definer due scan, row-locked admission, misfire cutoff | A JSON file and an in-app timer that stops when the laptop sleeps |
| Knowing a task is done | `task-outcome.ts`, an independent classifier | The model's own status report; independent verification listed as "later" |
| Budget | An atomic worst-case reservation before the run; an unpriced model fails closed | Spend checked at turn start against a cached monthly total; a turn on an unpriced model "counts nothing" (`server/spend.ts`) |
| Approvals | Claimed under a lock, bound to the surface; the owner can edit a draft before approving | Pending approvals held in an in-memory map; allow or deny only |
| Push | Real closed-app web push (RFC 8291/8292) through an outbox with retries | Local notifications; APNs is future work |
| Step privacy | `commandProgram` keeps only the program name, narration is never quoted, tool results are stripped | A redacted command line on each tool chip |
| Watching the desktop | View-only enforced by an HMAC-signed ticket purpose and x11vnc `-viewonly` | A UI mode |
| Credentials | Never reach the agent (vault, connector route) | In local config and the CLI's environment |
| Business knowledge | Facts versioned, with source, confidence and confirmation; ingest from pages and files | Free-text shared brief and `MEMORY.md` |
| People | Roles, `speakerInstructions`, team visibility rules | One user |
| Teaching by demonstration | `procedure-recorder.mjs` exists | Macro record/replay listed as "later" |

## How this was checked

Five read-only reviews ran in parallel, one per area: approvals, orchestration,
memory, computer use and connectors. Each read both repositories and cited
files on both sides.

The claims behind the four gaps were re-checked by hand, and so were these:

- the unread budget snapshot;
- the notification dedupe key;
- the queue order;
- the schedule kinds;
- the skill-review pin and the recurring-routines prompt line;
- OpenMausBot's `redact.ts`, Croner, the routine fingerprint, the 15-minute
  approval wait, `setWaitingOnHuman`, the 80% warning and the approval-levels
  wording.

Everything else is cited to files but was not re-read line by line.

OpenMausBot moves fast: its PR #1375 merged on the day of the comparison.
Re-read the files named here, on both sides, before building on any row.
