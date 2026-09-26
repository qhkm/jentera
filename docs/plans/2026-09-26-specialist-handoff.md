# Specialists hand work to each other

Status: design agreed with the owner on 26 September 2026; not built.
Implementation plan to follow in a separate document.

Built on branch `specialist-handoff-spec` (worktree `wake-copy`): Tasks 1–12
of `2026-09-26-specialist-handoff-plan.md` complete, plus Task 13 Step 1
(this note). Not merged, and the switch ships empty. See "As built" below.

## Why

A Jentera business has four specialists besides Chief of Staff: Operations,
Customer communications, Growth and marketing, and Finance and records. Each
is its own Hermes profile on the sprite, with its own memory, skills,
sessions and instructions (`SOUL.md`). Today only one of them works on a
turn. When Chief of Staff "hands part of the task to a specialist", it is
calling Hermes's `delegate_task`, which starts an **unnamed helper inside
Chief of Staff's own profile**. No specialist is involved, which is why "Who's
working on this" can only say "Specialist assistance requested" and name
nobody.

The owner's goal is **better work**: the specialist whose remit it is does its
part, with its own memory and skills. Seeing who did what follows from that.

This is the "specialists working together" expansion that
[`openmausbot-comparison.md`](../openmausbot-comparison.md) kept for later.
Its four constraints hold here: show outcomes, not a roster; specialists take
turns; the same approval gate; limits first.

## Decisions

| Question | Decision |
|---|---|
| Purpose | Better work: the right specialist does its part. |
| What the owner reads | One combined answer from Chief of Staff that credits each part. |
| Who may hand off | Chief of Staff, and specialists too. |
| Depth | At most 2 levels: Chief of Staff → specialist → specialist. |
| Count | At most 5 hand-offs per task. |
| Parallelism | None. One specialist works at a time. |
| Mechanism | The runner runs the specialist's turn *inside* the caller's turn (approach B below). |

### Approaches considered

- **A. Each hand-off is its own queued task.** Chief of Staff's turn ends, the
  control plane queues the specialist as a separate run, then starts a new
  Chief of Staff turn with the result. Maximum reuse, but each hand-off adds a
  queue round trip (roughly 10–20 s), and Chief of Staff's interim reply must
  be hidden to keep one answer.
- **B. The runner runs the specialist inside the caller's turn (chosen).** A
  Jentera tool asks the runner; the runner runs the specialist's turn on its
  own profile while the caller waits; the answer returns as the tool's result.
  Fast, and one combined answer falls out naturally.
- **C. Teach Hermes's `delegate_task` to use another profile.** Least code of
  ours, but depth, count and approval routing would live inside Hermes, where
  the control plane cannot enforce them. Rejected.

### Feasibility test (26 September)

B was tested before this spec, against the Hermes release the fleet runs
(`v2026.9.22`, commit `929f477c`), with a scripted stand-in model. The setup
matched a sprite: one gateway, `gateway.multiplex_profiles: true`,
`api_server.max_concurrent_runs: 10`, and a `records` profile beside the
default. A throwaway plugin tool, called from the default profile's turn,
started a run at `/p/records/v1/runs` and waited for it.

- The specialist's turn ran to completion while the caller waited inside its
  tool call. The caller then received the answer and finished its own turn.
  The overhead beyond the specialist's own time was about 0.4 s.
- The specialist ran as itself: its model request carried the `records`
  profile's `SOUL.md`, and the caller's did not. Each profile wrote its own
  `state.db`.

The test was not kept. The fleet already has both settings it needs. The
comment on `max_concurrent_runs` in `configure-model-provider.py` expected
Chief-to-specialist calls over `/p/<profile>/`, but nothing made one until
now.

- An approval raised inside the specialist's run (a plugin approval rule) arrived on that run's own event stream at `/p/records/v1/runs/{id}/events`, was answered at `/p/records/v1/runs/{id}/approval` with `choice: once`, and the run then completed (checked 2026-09-26, same pinned Hermes).

## How a hand-off works

1. The caller (Chief of Staff or a specialist) calls the tool
   `ask_specialist` with the specialist's profile key and a brief.
2. The tool asks the runner on the same sprite and waits.
3. The runner checks the limits below and refuses with a plain reason if any
   fails.
4. The runner starts the specialist's turn on its own profile
   (`/p/<profile>/v1/runs`). It carries the specialist's instructions from the
   control plane and the brief.
5. While it runs, the runner passes the specialist's steps, approval requests
   and usage into the task's own stream, each marked with the specialist.
6. The specialist's answer returns to the caller as the tool's result.
7. Chief of Staff writes one answer that says who did which part.

Hermes's own `delegate_task` stays available and unchanged. Its label in the
app changes from "specialist" to "a helper", because that is what it is.

## Limits and safety

**Limits.** The runner enforces these and the control plane checks them again
when it records the events:

- **Depth:** at most 2 levels below the task's first speaker.
- **Count:** at most 5 hand-offs per task, counting refused ones that reached
  the runner.
- **No loops:** a specialist cannot ask itself, or anyone already waiting in
  its chain.
- **Roster:** only the business's own specialists, as named in the task's
  roster from the control plane.
- **One at a time:** a second hand-off while one is running waits, rather
  than running beside it. This includes two `ask_specialist` calls the model
  issues together.

**Approvals.**

- Every action in a specialist's turn passes the same approval gate as today.
- The approval records which specialist asked, and the owner's answer goes
  back to that specialist's run.
- While it waits, the whole chain waits.
- An expired approval fails that specialist's part, and the caller is told.

**Who is asking.** The specialist gets the same speaker instructions Chief of
Staff gets (`speakerInstructions` in `ask.ts`). A staff member's request is
never passed on as the owner's word.

**Credits.**

- The specialist's usage is added to the task's usage and counts toward the
  month's AI credits, so the 80% warning covers it.
- If the budget is already exhausted, the runner refuses the hand-off.

**Time.**

- The task keeps its 15-minute cap (`agent.run_budget_seconds: 900`).
- A hand-off gets whichever is less: the time left minus 60 s kept back for
  the caller's answer, or 390 s.
- 390 s stays under Hermes's 420 s guard on tool calls issued together
  (`HERMES_CONCURRENT_TOOL_TIMEOUT_S`). Otherwise a hand-off in such a batch
  would be abandoned mid-work.
- A specialist that runs out of time is stopped, and its part is reported
  unfinished.

**Stopping.**

- Stopping the task stops every specialist in its chain.
- Taking control of the business computer pauses whoever is using it, as
  today. Only one agent works at a time, so two never drive the browser
  together.

**Failures.** The caller receives a plain reason, with a code the app can
word:

| Code | Meaning |
|---|---|
| `limit_depth` | Too many levels deep. |
| `limit_count` | The task has used its 5 hand-offs. |
| `loop` | The specialist is already in the chain. |
| `unknown_specialist` | Not one of this business's specialists. |
| `budget` | This month's credits are used up. |
| `time` | The specialist ran out of time. |
| `approval_expired` | An approval the specialist needed was not answered in time. |
| `failed` | The specialist's run failed. |
| `stopped` | The task was stopped. |

- Chief of Staff is instructed to say in its answer which part is missing.
  It must never present a missing part as done.
- The app shows that hand-off as failed.

## What the owner sees

**In the app, while the task runs:**

- **Status line:** names who is working ("Asking Finance and records…").
- **Steps:** grouped by who did them ("Finance and records · checked Bukku
  ×2, read a document"). Each step is still summarised the safe way
  `lib/task-presentation.ts` does today: the kind of work and its subject.
- **"Who's working on this" chip:** reads "Chief of Staff + Finance and
  records".
- **Popover:** lists each hand-off with who, when it started, finished or
  failed (with the reason), and that specialist's steps.
- **Approval card:** names the specialist ("Finance and records wants to
  create a draft invoice in Bukku").

**When it is done:**

- One answer from Chief of Staff that credits each part.
- The step card above the answer keeps the grouping.
- Activity shows which specialists took part.

**In Telegram:**

- The live bubble updates to "🤝 Asking Finance and records…", then the
  combined reply replaces it.
- Approval buttons name the specialist.

**Not shown:** the brief the caller wrote to the specialist. It is the model's
own prose, which Jentera never shows verbatim; older traces carried passwords
and internal paths. The owner sees who did the work and what they did, not
the note passed between them.

**Visibility between people is unchanged.** Hand-offs are part of the run, so
`visibleRunPredicate` governs them. A colleague's private chat reveals
nothing new.

## Parts

### Hermes fork: the tool (`qhkm/hermes-agent`, `plugins/jentera`)

- **`ask_specialist(specialist, brief)`.**
  - `specialist` is a profile key.
  - `brief` is at most 2,000 characters.
  - Registered beside `business_records`, in the same plugin and toolset.
- **Calling the runner.** The handler sends the `session_id` Hermes passes to
  every tool handler, which identifies the calling run. It calls the runner
  on loopback and waits for the result.
- **Credential.** It authenticates with the Hermes API key that Hermes and the
  runner already share (`API_SERVER_KEY`). No new credential or bootstrap
  transfer field is added: those are the fields that stranded the fleet on
  10 September when they shipped ahead of their bootstrap arm.
- **Availability.**
  - The tool is offered only when the runner says hand-offs are on for this
    task. The availability check asks the runner and caches the answer for
    30 s.
  - The runner refuses a call anyway when they are off, so a stale cache
    cannot open the door.
- **Release.** A new tag in the `vYYYY.M.P` form (a suffix breaks every
  bootstrap) and a new `HERMES_TAG`/`HERMES_COMMIT` pin in
  `worker/src/runtime/hermes-pin.ts`.

### Runner (`runner/src/server.mjs`)

- **Endpoints.** A loopback hand-off endpoint and an availability endpoint.
  Both require the Hermes API key and refuse everything else.
- **Chain.** Map the calling `session_id` to the running task and its chain
  of hand-offs.
- **Limits.** Apply them, and serialise hand-offs within a task.
- **Specialist run.** Start it with the instructions the control plane sent
  for that specialist, and stream its events. Relay them into the task's own
  stream, marked with the specialist's profile, under the step-redaction rules
  that already apply (`commandProgram`, stripped tool results).
- **Approvals.** Route approval requests and answers between the task and the
  specialist's run.
- **Usage.** Add the specialist's usage to the task's reported usage.
- **Stopping and time.** Stop the chain when the task stops. Give each
  hand-off its time as set out above.
- **Admission.** The runner's single-slot admission is unchanged. A hand-off
  runs inside the slot its task already holds.

### Control plane (`worker/`)

- **Switch.** `HANDOFF_BUSINESS_IDS` in `wrangler.toml` `[vars]`: exact UUIDs,
  empty means nobody. The same pattern as `DESKTOP_VIEW_BUSINESS_IDS`.
- **Task start.** For a business on the switch, the start body carries the
  limits and the roster. Each roster entry has the specialist's name and its
  run instructions, built by the same code as today
  (`specialistRunInstructions`, `speakerInstructions`). The runner never
  writes a specialist's instructions itself.
- **Instructions to the agents.**
  - Chief of Staff learns when a specialist's remit fits part of the task,
    and to credit each part in one answer.
  - Specialists learn that they may hand off within the limits.
  - Both learn to report a missing part honestly.
- **Events.** A run event `agent.handoff` records each hand-off's stages:
  requested, started, finished, failed, refused. Each stage carries the
  profile, the depth and a reason code, and **never the brief**. Step and
  status events carry the specialist's profile. `recordDelegation` keeps
  recording `delegate_task` as it does now.
- **Approvals.** An approval records the specialist that asked for it.
- **Usage.** Usage finalisation covers the specialist's usage through the
  runner's task total.
- **Popover data.** `runCoordination` returns each hand-off: the specialist's
  name from `specialist_profile`, its stages, its outcome, and a step summary.
- **Telegram.** The live bubble and approval buttons name the specialist.

### App (`app/`)

- **`TaskCoordination`:** the chip lists the specialists involved. The popover
  lists each hand-off with its outcome and steps. Its explanation text
  becomes honest about both kinds of help: named specialists and Chief of
  Staff's helper.
- **`lib/task-presentation.ts`:** groups steps by who did them, and relabels
  `delegate_task` as "a helper".
- **Approval card and status line:** name the specialist.
- **Text:** English and Bahasa Malaysia together, with the pages parity test.

## Release order

1. **App.** It understands hand-off events, the new fields and the reason
   codes before anything sends them.
2. **Runtime release** through `worker/scripts/ship-runtime.sh`, the one path
   to the sprites. It carries the Hermes tag and pin, and the runner. It
   converges on every sprite, and `fleet-verify.sh` passes.
3. **Worker** with the switch still empty. Nothing changes for anyone.
4. **Switch on for Kitakod.** Do one real hand-off with an approval in the
   middle, on the live sprite, before adding any other business.

The hand-off fields travel in the task start body. The plan must check
whether an older runner tolerates unknown fields there; this was checked only
for the config document, which it does tolerate. Either way, the switch is
turned on only after step 2 has converged. So no sprite is ever sent hand-off
fields its runner cannot use.

## Testing

- **Runner:** each limit and its refusal code, the loop refusal, one at a
  time, approval routing both ways, the stop cascade, the time budget,
  refusal when off, and refusal without the key.
- **Hermes fork:** the tool's own test beside `test_business_records.py`.
- **Nested-run integration test.** The feasibility setup rebuilt as a real
  test, run against the pinned Hermes with a scripted model. It proves that
  the caller waits, the specialist runs as its own profile, and the answer
  comes back.
- **Control plane:** through `test/orchestration.test.ts` (real Postgres and
  RLS; only the model and outbound HTTP faked). It covers:
  - hand-off events and reason codes;
  - the brief never stored;
  - usage and credits;
  - the approval's specialist;
  - a private chat's hand-offs invisible to a colleague.
- **App:** the popover, grouped steps, approval card, the helper label, and
  Malay parity.
- **Live:** the Kitakod check in step 4 of the release order.

## Not in this version

- Specialists working at the same time. The runner has one slot, and the
  business computer has one owner at a time.
- Showing the brief.
- Owner-adjustable limits.
- A specialist replying to the owner directly.
- Hand-offs across businesses.

## Risks to settle in the implementation plan

- **Approvals inside a nested run are untested.** The feasibility test had
  none. The plan's first runner task should prove the approval round trip
  against the pinned Hermes before building on it.
- **Parallel tool calls.** Hermes runs tool calls issued together on up to
  8 threads. The runner's one-at-a-time rule must hold even when two
  `ask_specialist` calls arrive together.
- **The 60 s approval window** (gap 4 in `docs/todo.md`) applies to
  specialists too. An owner who is slow to approve fails that part. This is
  accepted for the pilot and revisited with gap 4.

## As built

Built on branch `specialist-handoff-spec` in the `wake-copy` worktree,
rebased onto `origin/main` at `2d371d2`, commits `6eddc44..b9b6bcc` (Tasks
1–12 of `2026-09-26-specialist-handoff-plan.md`), plus one docs commit for
Task 13 Step 1. Tasks 1–11, and every fix round a review raised on them,
closed clean. Task 12 (the opt-in Hermes e2e test) passed twice against the
fork with the runner suite at 286 pass / 3 skipped, but its review came back
needing fixes — the harness closes the runner only on its success path, a
descriptor/process leak in the test harness itself, not in shipped code —
and that fix round was still pending as this docs pass ran; it waits on
this commit landing first, so the two do not collide in one worktree.
Suites last ran at: runner 286 pass / 3 skipped, worker 1764 pass with both
typecheck passes clean, app 1344 pass. Nothing is deployed and nothing is
merged to `main`: `HANDOFF_ENABLED = "true"` and `HANDOFF_BUSINESS_IDS = ""`
in `worker/wrangler.toml`, so the switch admits nobody. Steps 2–8 of Task 13
— push, app deploy, fork tag, pin, `ship-runtime.sh`, switching hand-offs on
for Kitakod, and the live check — are the owner's call and not run by this
pass.

**This plan's rulings.** `2026-09-26-specialist-handoff-plan.md` §"Rulings
against the spec" lists **nine** rulings, not seven as the release brief
said:

1. The tool is offered per business, not per task — Hermes caches a tool's
   availability for 30 s, so the switch travels in the config document and
   the runner refuses a call from a task that carried no hand-off limits.
2. No `approval_expired` code — an unanswered approval is already a denial
   the Worker's existing timeout produces; the specialist's own turn
   reports it.
3. The start body carries limits and a preamble, not the roster — each
   specialist's name and remit already reach the runner through the config
   document, and repeating them would push the start body past its 64 KB
   limit.
4. Hand-offs are queued per calling run, not per task — a per-task queue
   would deadlock at depth 2, where a specialist's own request waits behind
   its caller's.
5. Specialist usage is kept in the runner's memory for the task's life — a
   restart mid-task undercounts it, though the root run's own usage is
   still reported.
6. Steps carry the specialist's name as a prefix, `⟦Name⟧ `, written and
   read only in `worker/src/handoff.ts` (`agentStep`) and
   `app/src/lib/task-presentation.ts` (`splitAgentStep`).
7. `ask_specialist`'s own step never carries a preview, the same as
   `execute_code` — Hermes builds a preview from the tool's arguments, and
   that argument is the brief.
8. The runner learns about exhausted credits only when the specialist's
   first model call fails, not before the hand-off starts, because it
   cannot read the budget itself.
9. "Activity shows which specialists took part" is met through the task
   detail's "Who's working on this" chip; Activity's own rows do not
   change.

**Rulings made while building it.** From the ledger
(`.superpowers/sdd/2026-09-26-specialist-handoff-plan/progress.md`) and its
pre-flight scan, which checked every pair of tasks sharing a file or
interface (start body shape, engine wiring, the stream event shape, the
step prefix and its reader, the popover's `RunHandoff` type) and found them
consistent before any task began:

- The Hermes tool reminds the model to say what is missing on every
  `tool_error`, not only some, matching the spec's "any failure."
- `_calling_run_id` calls `get_current_session_key(default="")`, so a call
  made outside a run is refused as `unavailable` rather than sent under a
  wrong id.
- Every live specialist run of a task is tracked, not one slot, so stopping
  a task stops all of them and every exit path checks `task.stopped` first.
- A child hand-off's abort signal is `AbortSignal.any([caller's, its
  own])`, chained through the whole depth, so a specialist can never
  outlive the caller that asked for it; its budget is likewise computed
  from its own caller's deadline.
- Usage is added from `run.completed`, `run.failed` and `run.cancelled`,
  and once more from a status read when a hand-off ends without one
  (abort, timeout, a lost stream) — credits count the specialist's usage
  whatever the outcome.
- No change was needed for two `ask_specialist` calls issued together:
  `ask_specialist` is outside Hermes's parallel-safe set, so they already
  run one after another, each still bounded by the task's own deadline.
- Relayed events already carried `agent: profile` on every one — the
  plan's own review flagged this as a spec mismatch that the code did not
  have.
- Specialist usage is threaded into every path that can freeze a task's
  terminal record — the watchdog, `/readyz` and admission, not only the
  two hand-off routes — so whichever sees the end first still counts it.
- A hand-off's still-pending approval is dropped from the task's queue
  once the hand-off ends, so a stale specialist approval cannot block the
  task's later ones.
- Stopping a task stops its specialists before it stops the root, both
  when a task is terminated and when a new task's registration forgets the
  previous one's.
- A malformed `/v1/handoff` body answers 400 with no parse message, so a
  brief that fails to parse never reaches the runner's error log.
- **Release order:** once Task 4's commits reach `main`, the next Worker
  deploy must be `ship-runtime.sh`, never a plain `wrangler deploy` /
  `pnpm run deploy` — `check-bundle-pin` repacks the pinned commit against
  the *current* `RUNTIME_BUNDLE_ASSETS` list, which now names
  `runner/src/handoff.mjs`, and refuses when the pinned commit predates
  that file. This carries into Task 13 Steps 2–5.
- An approval's specialist name is resolved from the slice's existing
  `agentNames` cache rather than a fresh lookup, since the cache already
  holds it from the runner's own hand-off events.
- The run-wide `researching` status flag stays run-wide rather than being
  scoped per specialist — it names the task's broad phase, not who is
  acting, and never appears beside a specialist's name.

**Where the build differs from the spec as written:**

- **A queue per calling run, not per task.** Every caller up the chain is
  blocked inside its own tool call anyway, so a per-caller queue still
  means one specialist works at a time, without the depth-2 deadlock a
  single task-wide queue would hit.
- **Every live specialist run of a task is tracked**, not a single "active"
  slot, so a stop reaches every specialist working for a task, however
  many are (sequentially) live.
- **The child's abort signal is chained to the caller's**
  (`AbortSignal.any`), through whatever depth the chain reaches, so
  stopping or timing out a caller always stops what it started.
- **A specialist's pending approvals are dropped when its hand-off ends**,
  so a specialist that is stopped, times out, or fails does not leave a
  stale approval sitting at the head of the task's queue.
- **The bundle-asset addition.** `runner/src/handoff.mjs` was added to
  `RUNTIME_BUNDLE_ASSETS` (`worker/src/runtime/provision.ts`) and to
  `runner/bin/provision-sprite.sh`'s push list as part of Task 4 — not
  named in the spec's file map, but required: without it a sprite's runner
  fails to import the module it was just told to use.

**The Hermes fork.** The tool lives on branch `jentera-ask-specialist` of
`qhkm/hermes-agent`, commits `a48b2a3d92` (implementation, 18/18 plugin
tests) and `9f429a64c2` (one fix round: the honesty reminder on every
failure, and the real `get_current_session_key` lookup with its own
tests). The pinned tag is set at release (Task 13 Step 3), not invented
here.

**What is known and deferred.** The ledger's fuller list of "minor
(deferred)" findings stays there; a few a future reader should know before
touching this again:

- Specialist usage lives in the runner's memory only — nowhere durable —
  so it does not survive a runner restart mid-task.
- The `researching` status flag is run-wide, as above: it can read as a
  lead-role line even while a specialist is the one searching.
- A nested (depth-2) hand-off is not distinguished in the popover — its
  `depth` is carried on `RunHandoff` but not shown, so it looks the same
  as a depth-1 one.
