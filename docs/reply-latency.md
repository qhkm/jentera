# Reply time and channel parity

What happens between an owner's message and Jentera's reply, why the two
channels answer the way they do, where the seconds go, and what has been
tried. Numbers here are dated and come from `worker/scripts/reply-latency.sh`;
re-run it before trusting them.

## Reading the numbers without fooling yourself

Three traps, each of which has produced a confident wrong answer here.

**A window that spans a config change is two populations, not one.** `run.model`
is a snapshot of what executed that run, kept deliberately so history stays
truthful after a routing change. Group fourteen days by `model` and you get
`deepseek-v4-flash` beside `deepseek-flash` and it reads as two models with
different speeds; they are the same upstream model either side of the
2026-09-13 switch to the direct DeepSeek route. A comparison built on that
said one was twice as fast as the other. Before grouping by `model`, `runtime`
or anything else configured in `wrangler.toml`, check when that value last
changed — `select model, max(created_at) ... group by model` answers it in one
query.

**A p50 over a whole window hides the shape.** Ask latency by day over three
weeks ranges from 9.6 s to 63.6 s on eight to forty-six runs a day. Any two
windows you choose will differ, and neither difference means anything. One day
in that range was dragged entirely by five failed runs on a single account.

**Reply time tracks tool calls, not the model.** Measured 2026-09-17: time from
`work.started` to the first `agent.tool` event is flat at 5-9 s every day,
while median tool calls per run swings 0 to 4 and the daily p50 follows it —
zero tools ≈ 10-20 s, two ≈ 45 s, four ≈ 51 s. A question that needs the web
is slower because it does more, and that is the answer to most "why was this
one slow" questions before any infrastructure is suspected.

## The path a message takes

Both channels end up on the same durable path. Only the first step differs.

1. **Intake.** Telegram: the bot webhook (`worker/src/routes/connect.ts`)
   signals a Telegram intake. App chat: `POST /api/runs/ask` with `mode:
   'work'` (`worker/src/routes/runs.ts`, `startDurableAsk`).
2. **Run and task.** The intake retrieves the business's facts and recent
   work (`retrieveHermesContext`), builds the request with
   `prepareHermesAgent`, caps it with `boundedAgentInput`, creates a `run`
   and a `runtime_task`, and publishes to the `aisar-runtime` queue
   (`max_batch_size = 1`, `max_batch_timeout = 0`, so the queue itself adds
   well under a second).
3. **Dispatch.** A slice of the consumer leases the task, reserves budget,
   wakes the business's sprite if it is suspended, starts the run on the
   runner (which starts it on Hermes) and relays the live stream.
   `run-task.ts` records stages (`database_ready`, `runner_ready`,
   `hermes_started`, …) and the consumer logs them as `[runtime-latency]`
   lines to Workers Logs. **Since 2026-09-10 the app intake runs the first
   slice itself** (`runInlineSlice` in `routes/runs.ts`, 20 s under
   `waitUntil`) and sends the queue message with a 30 s delay as the safety
   net; the queue consumer takes over only for runs longer than the slice,
   resuming from `runtime_task.stream_seq` so nothing is relayed twice. The
   reason is placement: the HTTP handler is placed next to Neon
   (`placement.region`), the queue consumer is not, and every tenant
   transaction cost it 1.1 to 2.3 s. The Telegram webhook does the same
   since 2026-09-10 (`handleIncoming` with a context): admission, dispatch
   and the first slice run under the webhook's `waitUntil`, and the intake
   message goes to the queue with the 30 s delay. A message that arrives
   while the previous reply is still running (one reply per business at a
   time) waits for the slot inside the slice, polling every second and
   telling the web chat "Finishing your previous message first…", instead
   of being parked for the queue's watchdog: measured 18.6 s to Hermes that
   way on 2026-09-10 against 1.0 to 1.3 s for the neighbouring messages.
4. **The agent loop.** Hermes calls the model through the worker's proxy
   (`https://api.jentera.ai/v1/model` → `router.fmcv.my`), usually several
   times per reply (think, maybe a tool, answer). This is where most of the
   wall clock goes.
5. **Delivery.** Telegram: the "💭 Thinking…" bubble is edited in place with
   the answer. App: the placeholder message is replaced when the run
   completes; nothing streams into the app yet.

## What is the same and what is not

| | Telegram | App chat |
|---|---|---|
| Prompt and framing | `prepareHermesAgent` | `prepareHermesAgent` (same since 21e1bb8, 2026-09-09; before that the app used the older `prepareAsk` prompt). Since 2026-09-10 the message is the user turn exactly as typed and the facts and recent work travel in the per-run `instructions`, which Hermes does not persist; before that every stored turn carried a copy of the business context, replayed on every later reply. |
| Facts and recent work | `retrieveHermesContext` | same |
| Response mode | `quick`, unless the message starts with `/deep` or `/research` (e54aea9, 2026-09-09; before that, wording like "deep dive" also chose deep) | `quick` by default since 27b3f65 (2026-09-10), `deep` via the Deep toggle or a typed `/deep`; before that always `deep` |
| Model | quick model (`AISAR_MODEL_NAME`, MiniMax-M3), or the business's `AISAR_QUICK_MODEL_OVERRIDES` entry (M2.7-highspeed canary on Kitakod Ventures) | deep model (`AISAR_DEEP_MODEL_NAME`, deepseek-v4-flash) |
| Session id | `telegram:<businessId>:<chatId>` | the app's chat-tab id |
| Memory | Hermes reloads the persisted transcript for a stable session id (present since Hermes 2026.9.5; on the fleet since v2026.9.8, 2026-09-08). Confirmed 2026-09-09 with `reply-latency.sh continuity`: turn two recalled turn one. | same mechanism, per app tab |
| Cross-channel memory | none: a Telegram chat and an app tab are separate sessions | |
| While waiting | live bubble, status edits, streamed handoff | since bdeeb21 (2026-09-10): the same status lines, a reasoning slice, then the answer streaming in place; before that a static placeholder |

Both channels now default to quick, share the prompt, and show live
progress. What remains different is the session boundary (per Telegram
chat versus per app tab) and the wake: the chat page warms the sprite as
it opens (`POST /api/runtime/wake`), Telegram warms it under the webhook.

## Measurements, 2026-09-09

Seven days of completed replies (`reply-latency.sh db 7`):

| channel | model | runs | wait to start p50 / p90 | model time p50 / p90 | total p50 / p90 |
|---|---|---|---|---|---|
| Telegram quick | MiniMax-M3 | 52 | 6.8 s / 12.1 s | 21.8 s / 114 s | 41 s / 572 s |
| Telegram quick | M2.7-highspeed (canary) | 3 | 12.5 s | 17.3 s / 26 s | 30 s / 39 s |
| App chat (deep) | deepseek-v4-flash | 13 | 11.3 s / 21 s | 31.4 s / 42 s | 44 s / 72 s |
| Telegram `/deep` | deepseek-v4-flash | 2 | 6.8 s | 544 s / 647 s | 551 s / 654 s |

"Wait to start" is `work.requested` → `work.started`; "model time" is
`work.started` → `work.completed`. The 572 s p90 and a 16,354 s outlier on
M3 predate the 2026-09-08 fix for orphaned leases (a queue invocation was
cancelled mid-dispatch and the task sat out a 300 s lease and the reaper).

Per-call latency of one trivial completion ("reply with the single word OK",
40 max tokens) through the proxy from a sprite, two probes an hour apart
(`reply-latency.sh models`):

| model | per call | reasoning text | note |
|---|---|---|---|
| MiniMax-M3 | 2.3 s to 8.3 s | 90 to 160 chars | wide swing between probes; the same call cost 5.2 s and 8.3 s in one probe and 2.3 s in the next |
| MiniMax-M2.7-highspeed | 1.5 s to 2.6 s | 160 to 180 chars | stable across probes |
| deepseek-v4-flash | 1.0 s to 2.0 s | 40 chars | stable |

Reasoning control: the router (LiteLLM) rejects `reasoning_effort` and
`thinking` with `UnsupportedParamsError` and accepts the OpenRouter-style
`reasoning: {effort: …}`, which is the field Hermes sends from
`agent.reasoning_overrides` (set to `high` for the quick model and every
candidate in `configure-model-provider.py`). Sending `effort: low` changed
nothing measurable: M3's reasoning length was identical and its time was
inside the same swing. Treat that override as cosmetic for MiniMax.

## Measurements, 2026-09-10: where the wait to start went

Workers Logs (`[runtime-latency]`, `requestElapsedMs`) for six app-chat
quick replies on the Kitakod Ventures sprite, before the inline slice:

| stage | after the request |
|---|---|
| queue consumer invoked | 4.4 to 4.7 s |
| `leased` | + 2.6 s of prelude, then a 1.9 s lease transaction |
| `database_ready` (mark dispatching, deadline, access, reserve) | + 4.5 s |
| `runner_ready` (readyz through the edge, sprite awake) | + 0.07 s |
| `hermes_started` | + 0.07 s |
| `run_recorded` | + 1.9 s |
| `first_visible_delta` (Hermes's first token) | + 2.7 s |
| **total to the first token** | **17.4 to 17.7 s** |

Every tenant transaction in the queue consumer cost 1.1 to 2.3 s; the same
transactions from the placed HTTP handler cost 60 to 100 ms
(`/api/runs/activity` round trip from a browser: 126 to 260 ms). Hermes
itself admitted the run 50 ms after the runner did and answered "yob" in
3.9 s. The sprite was awake throughout; readyz was not the problem.

After the inline slice (same sprite, same model, deployed 13:03 GMT+8):

| message | Hermes started | first token | done |
|---|---|---|---|
| "hey, quick one: how are things today?" (first after a 30 min idle) | 3.9 s | 11.0 s | 13.0 s |
| "yob" | 2.7 s | 5.2 s | 6.0 s |

For "yob": 1.3 s from the committed task to the slice start (the queue send
and stream publish came first; fixed the same day so the slice starts at
commit), lease 89 ms, checks and reserve 258 ms, readyz 594 ms, start 258 ms,
record 83 ms, then 2.5 s of Hermes time to the first token. What remains
is Hermes's own time to first token and the edge round trip to the sprite.

## Measurements, 2026-09-11: after the inline and placed slices

`reply-latency.sh db 1` the day after the inline slice (2026-09-10, 13:03
GMT+8) and the placed queue slice (the same evening) went live. Every run
in the window used DeepSeek: release 2026.09.11-7 routed chat through the
one model that was available after the MiniMax quota was hit.

| channel | model | runs | wait to start p50 / p90 | model time p50 / p90 | total p50 / p90 |
|---|---|---|---|---|---|
| App chat | deepseek-v4-flash | 22 | 1.9 s / 2.7 s | 40 s / 72 s | 43 s / 74 s |
| Telegram | deepseek-v4-flash | 2 | 2.7 s / 3.1 s | 39 s / 40 s | 42 s / 43 s |

Two days earlier the wait to start was 11.3 s / 21 s for app chat and
6.8 s / 12.1 s on Telegram. What is left is model time; three of the 22
app runs were web-research questions asked to check the steps view, each
30 to 70 s of search and extraction.

The 7-day view (`db 7`) still carries the older shape: 13.1 s at p90 for
app chat, from the runs before the slices, and a 3.5 h p90 for Telegram on
MiniMax-M3, from four runs on the evening of 2026-09-05 that took 2.5 to
4.5 hours each with no approval involved, before the runner-side deadline
existed. Nothing since 2026-09-06 has run longer than 11 minutes.

## Measurements, 2026-09-16: startup is short, Quick tool use is not

Fresh production measurements over the preceding two days showed 31 completed
app-agent replies. The wait from `work.requested` to `work.started` was 2.5 s
at p50 and 3.9 s at p90, while agent/model time was 31.5 s at p50 and 79.7 s
at p90. Total reply time was 37 s at p50 and 94 s at p90. The reported
"30 seconds to start thinking" was therefore not a 30-second dispatch delay:
the agent had started, but a current-information or action safety gate held
unreviewed answer text while the UI showed the overly broad "Checking the
task" label.

The same window contained 32 completed ask runs averaging 3.1 tool starts,
with a maximum of 14; terminal was started 51 times. Quick mode now carries a
request-scoped efficiency contract: answer without tools when existing
business context is enough; for current information, begin with one focused
search and inspect at most two relevant authoritative sources unless evidence
conflicts; and do not create scratch files, run code, use terminal, or delegate
merely to prepare an answer. Deep mode is unchanged. Safety-held progress now
names the reason (for example "Checking current sources" or "Checking the
requested action") instead of collapsing every safe label to "Checking the
task". Re-run `reply-latency.sh db 2` and compare tool starts after enough new
Quick turns have completed; this change has no claimed latency win until that
measurement exists.

The first live check after that prompt change proved prompt-only control was
not sufficient. A Quick app turn started in 2.0 s but then spent 98.2 s in
the agent, made eight tool calls and processed 191,049 input tokens before
finishing at 100.2 s. The payload did contain the Quick contract; the model
simply continued researching. The follow-up runtime release therefore
enforces `max_iterations = 2` for Quick runs at the Hermes boundary. That
allows one focused tool/model pass and one follow-up; if neither answers,
Hermes makes its existing final tool-free summary call. Deep runs retain the
configured 20-iteration budget. This is an enforced bound, but still not a
claimed production latency improvement until another live turn is measured.

## Measurements, 2026-09-18: the wait after the answer exists

Over 14 days, 114 completed asks that used tools took **47.1 s at p50**, of
which **10.4 s came after the last tool call** — the answer was finished and
the owner was still watching a status line. That tail is the outcome
assessment and the source review, which ran in front of delivery.

What the 90-day record says about what that wait bought:

| | |
|---|---|
| Completed runs (30 d) | 451 |
| Runs whose answer was held or warned at delivery | 39 |
| Runs that actually carried a caution (90 d) | **5** |
| Warnings seen (90 d) | `source_review_incomplete` ×3, `missing_current_sources` ×2 |
| `unverified_completion` reaching a delivered answer (90 d) | **never** |

Every one of the five came from a question asking for current or high-stakes
information — the class `streamHoldReason` already holds from streaming, and
therefore knowable before the answer exists.

So the checks now run behind the reply unless the question could carry a
caution (`holdAnswerForChecks`, `answer-stream-policy.ts`). A question that
would have been allowed to stream token by token is delivered as soon as it is
durable; one that was held still waits, which is what keeps a caution ahead of
the answer it applies to rather than behind it. The checks themselves are
unchanged and still run on every reply — `outcome.observed` and
`answer.guardrail` are written either side of delivery, so the task detail
does not record which order a run took.

The app gets the same answer through the delta lane it already uses for
streaming (`WebProgress.reveal`), but only where the slice that finished the
run is the whole story: a resumed slice cannot see what an earlier one put on
screen, and stitching a replayed answer onto a partial one duplicates it.
Lifting that needs a durable record of whether anything has been revealed for
a run; `runtime_task.stream_seq` is the nearest thing and does not answer it.

### Measuring it, and one way not to

**The span from the last `agent.tool` to `work.completed` does not move, and
was the wrong thing to watch.** `work.completed` is written by `finishRun`,
inside the completion transaction, which is after the checks on both sides of
this change. Only the moment of delivery moved; total time to completion is
unchanged by design. A query on that span would have read as "no effect" from
a change working perfectly.

So both check events carry a `delivery` object, written after delivery in
both branches. **Policy is recorded apart from outcome**, because the two
disagree: an unheld run whose send failed, or one that spanned slices and so
could not reveal early, took the fast branch and delivered nothing sooner.

| Field | Reads |
|---|---|
| `heldForChecks` | Policy: the checks were awaited before delivery was attempted |
| `channel` | `telegram`, or the run's own channel |
| `resumedSlice` | The run spanned slices, so the app reveal does not apply |
| `checksMs`, `checksFinishedAt` | How long the checks took, and when they ended |
| `deliveryStartedAt` | When the answer began going out — the moment that moved |
| `outcome` | `sent`, `published`, `failed`, `none` |
| `deliveredBeforeChecks` | Evidence: it arrived, and started before the checks ended |
| `savedMs` | `checksFinishedAt − deliveryStartedAt` — the wait actually removed |

Three things that measure would have got wrong, and how:

- **`work.completed` cannot see it** (above): it is written after the checks
  in both orders.
- **The branch is not the outcome.** `!checked` says the checks were not
  awaited first, not that anything reached anyone. `outcome` and
  `deliveryStartedAt` say that.
- **The send's end is not the moment that moved.** Delivery takes the same
  time either way; what changed is when it could *start*. Timing the
  completed send counts a run as no better whenever the checks happen to
  finish mid-send.

And `published` is the honest word for the app: the run stream accepting a
push does not prove a client was listening, which only the client knows.
`WebProgress.reveal` returns false when a publish fails rather than using the
error-swallowing publisher, so a failed push is never counted as delivery.

```sql
select payload->'delivery'->>'channel' as channel,
       payload->'delivery'->>'resumedSlice' as resumed,
       payload->'delivery'->>'outcome' as outcome,
       count(*),
       round(percentile_cont(0.5) within group (
         order by (payload->'delivery'->>'savedMs')::numeric) / 1000, 1) as p50_saved_s
  from run_event
 where type = 'outcome.observed'
   and (payload->'delivery'->>'deliveredBeforeChecks')::boolean
   and created_at > now() - interval '7 days'
 group by 1, 2, 3;
```

A caution that arrived behind an answer already read is
`type = 'answer.guardrail'` with a non-empty `warnings` **and**
`delivery.deliveredBeforeChecks` true. The warning alone proves nothing: a
held run's caution is inside the delivered text.

If one does appear it will be `unverified_completion`, and the corrective
change is **not** to hold action questions — `streamHoldReason` already
returns `action`, so those are held today. It would mean the assessment found
missing completion evidence for an ordinary conversational question, and the
answer would be either to hold on the assessment's reason rather than the
question's, or to accept the late notice.

## Startup diagnostics, 2026-09-18

A completed app reply (`f6edbc90…`, 53.1 s) reached Hermes in about 2 s,
but its first `agent_init` client was not created until another 22 s had
passed. Six neighbouring replies on the same Sprite took 0.3–0.6 s between
Hermes admission and client creation. Its first tool completed at about
35.9 s from intake but the durable `agent.tool` appeared at 40.5 s; an event's
database timestamp is therefore **not** its execution timestamp. Final checks
took only 1.65 s. This isolates an intermittent startup stall, not its exact
function. Model proxy accounting also omits parts of the end-to-end request:
the first call recorded 3.839 s there, versus 11.8 s in Hermes.

`runner/bin/hermes-startup-timing.mjs` adds completed checkpoints to the
pinned API agent factory and constructor. It is applied and verified by the
existing dependency patcher, included in both bundle download and operator
provisioning, and requires a normal **runtime release** before it is live.
It does not change the Hermes pin, models, tools, prompts, safety checks,
client configuration, threading or reply delivery. This is instrumentation,
not a latency fix.

The existing rotating `/home/sprite/.hermes/logs/agent.log` receives
`jentera.startup: [hermes-startup]` records with exactly four fields:

```json
{"runtimeRunId":"run_0123456789abcdef0123456789abcdef","stage":"api.runtime_credentials","stageMs":22000.0,"elapsedMs":22010.0}
```

`runtimeRunId` is the opaque Hermes ID, matched to
`runtime_task.remote_run_id`, **not** the app's `run.id`. `stageMs` is the
monotonic interval since the preceding completed checkpoint; `elapsedMs` is
cumulative startup time. The example points to credential/config resolution
between `api.imports` and `api.runtime_credentials`, not model inference.
Marks cover imports, configuration/route resolution, toolset selection,
transport setup, client options, certificate validation, client creation,
tool definitions, session/memory setup and context-engine initialization.
Some client-specific marks are skipped by other provider branches; intervals
always mean “since the previous emitted mark”, not a universal isolated span.

For a slow reply, use a read-only task query to retrieve its remote ID and
Sprite name, then read only records for that ID from the Sprite's agent log.
The largest `stageMs` identifies the next step to investigate. If startup
throws, `failed` records the interval since the last checkpoint without the
exception text. `complete` is factory completion, **not** answer completion.
Compare multiple slow and fast runs before claiming a cause or improvement.

No prompts, credentials, emails, tool arguments, exception text or private
session identifiers enter these records. Only server-format run IDs and
allowlisted stage names are accepted. Other API callers without the run ID
are untraced, context is reset on success/failure, concurrent runs keep their
own correlation, and a failed log sink cannot fail initialization. Startup
records stay operator-only; they are not chat progress events.

## Measurements, 2026-09-25: where a slow start comes from

This is the Grok Bot backlog item "chat startup delay", measured before any
fix. The sample is 77 app replies (`owner.ask`, deepseek-flash) completed in
the seven days to 25 September. It came from `reply-latency.sh db 7`, plus
read-only queries on `run_event` and `runtime_task`.

**Overall numbers:**

- The wait from `work.requested` to `work.started` was 1.6 s at p50 and
  10.7 s at p90.
- Agent time was 11.4 s at p50 and 63.6 s at p90.
- The total was 16 s at p50, 76 s at p90 and 288 s at most.

The median start is fast. The problem is a tail of slow starts, and that
tail has two distinct causes.

**Grouped by how long the business had been idle beforehand:**

| Idle since the business's previous run | Runs | p50 | p90 | max |
|---|---|---|---|---|
| under 15 min | 40 | 1.4 s | 2.8 s | 103.7 s |
| 15–60 min | 16 | 1.5 s | 2.7 s | 10.9 s |
| 1–4 h | 11 | 6.2 s | 19.3 s | 95.7 s |
| over 4 h or first | 14 | 2.7 s | 12.5 s | 26.7 s |

**Grouped by the run task's `attempt`:**

| Start wait | Runs | `attempt` |
|---|---|---|
| under 5 s | 65 | 64 × 0, 1 × 1 |
| 5–25 s | 7 | all 0 |
| 25 s or more | 5 | 4 at 1–2; one at 0, which queued behind the owner's own previous message |

1. **Cold wake: 5–25 s, 7 of 77 runs.** One attempt that is simply slow. The
   sprite had slept, typically after one to four hours idle, and waking it
   plus Hermes's restart is the cost. This is the lever the keepalive
   decision (`docs/todo.md`, left at 0 on 19 September) already weighed.
2. **A failed first attempt: 42–104 s, 4 of 77 runs, the only ones a
   minute or more late.**
   - The first dispatch did not take, and nothing retried it quickly. The
     run started only when the inline slice's 30 s safety-net message
     (`INLINE_SAFETY_NET_SECONDS`) came round, or the queue's 60 s
     `retry_delay` did, or both.
   - The observed waits sit on those timers: 42 s is 30 plus about 12, and
     96 s and 104 s are 30 plus 60 plus about 6–14.
   - This matches the owner's "30 seconds before anything happens": the
     time is spent waiting for a timer, not working. Two of the four came
     three to four minutes after a previous reply, on a sprite that had
     already frozen.

**What is not known.** Why each first attempt failed is not recorded
anywhere durable. `runtime_task.last_error` is cleared on success, and the
defer and retry reasons exist only in Worker logs. Those logs are enabled
(`[observability]`), but wrangler's login token has no observability scope.
The likely class is the cold-wake response the consumer already tolerates
(`runner returned invalid JSON (5xx)` while Hermes restarts), but that is
inferred from the timing, not observed.

**Nearly every slow start is one business.** 12 of the 14 runs waiting over
5 s were `4e8c2593…`. That is the heaviest user and the desktop-observe
canary, and it received the most releases that week.

### The fix, 2026-09-25

Reading the code confirmed the second cause.

**The unrecognised answer.**

- While Hermes, or any specialist profile, is still starting, the runner's
  `/readyz` answers **503 with a JSON body** `{ ok: false }`
  (`runner/src/server.mjs`).
- `isWakingRunnerFailure` recognised only a 5xx whose body was not JSON,
  which is the sprite edge's answer while the machine itself boots.
- So the commoner half of every cold start went through the generic
  failure path: a flat 30 s retry and one of the task's five attempts spent.

**The request that outlived its invocation.**

- Readiness and start calls kept their own 30 s timeout, even inside the
  inline slice. That slice lives in a `waitUntil` that Cloudflare ends
  about 30 s after the response.
- A slow wake could therefore outlive the invocation and leave the task
  leased to a dead owner, which is recovered only after 90 s without a
  heartbeat (`DEAD_OWNER_SECONDS`).

**What changed:**

- **A new error for "not serving yet".** `RunnerClient.ready()` throws
  `RunnerNotReadyError` when the runner answers `ok: false`, or when
  nothing answers before the caller's deadline. The consumer treats it as
  a wake: no attempt spent, bounded by the existing `WAKE_GIVE_UP_MS`
  (4 min).
- **Every runner call ends with its slice.** `observationSliceFetch` now
  bounds every runner call by the slice deadline, not only the event
  stream, so no call outlives the invocation that holds the task.
- **The inline slice keeps looking.** It re-checks a waking sprite every
  2 s (`INLINE_WAKE_POLL_MS`) while its 20 s budget lasts, the way it
  already waited for a busy slot. Only then does it hand the task to the
  queue.
- **Each delay is recorded.** A start that waits records why, once per
  reason, as `work.delayed` with `reason` set to `waking`, `busy`,
  `preparing` or `retry`.

**Expected effect.** The four 42–104 s starts should fall to the cold-wake
range of roughly 10–25 s. That is a hypothesis until re-measured.

**Re-measure** after a week on the new Worker. Run `reply-latency.sh db 7`,
then attribute each slow start from its events:

```sql
select e.payload->>'reason' as reason, count(*)
  from run_event e join run r on r.id = e.run_id and r.business_id = e.business_id
 where e.type = 'work.delayed' and r.created_at > now() - interval '7 days'
 group by 1;
```

## Levers

Done:

- 2026-09-08: orphaned-lease reclaim, which removed the multi-minute tail.
- 2026-09-09: one prompt for both channels; deep mode opt-in on Telegram.

Open, in order of expected payoff:

1. **Quick model → MiniMax-M2.7-highspeed fleet-wide.** Done 2026-09-09,
   release 2026.09.09-1, on the owner's decision. Same price as M3, about
   half the per-call time and none of the swing. M3 remains routed as a
   candidate; `AISAR_QUICK_MODEL_OVERRIDES` moves a single business back
   without a release. Re-run `reply-latency.sh db 7` after a week to see
   the effect on the Telegram quick row. Superseded 2026-09-11: both MiniMax
   routes returned the provider's Token Plan 429 while deepseek-v4-flash
   passed the production proxy probe. DeepSeek became the fleet default and
   M3 was removed from candidates because candidates participate in the live
   bootstrap smoke even when they receive no ordinary traffic.
2. **Stream into the app.** Done 2026-09-10 (bdeeb21): the run stream now
   carries the agent's status line, a bounded reasoning slice and answer
   text as live, unstored events; the chat renders them in the placeholder.
   Every run with a run id is observed live, so Telegram and app get the
   same view. First visible response on the web is now the first status
   line, seconds after the message, instead of the finished answer.
3. **The 7 to 12 s wait to start.** Since 2026-09-10 the chat page warms
   the sprite as it opens, so the first message after a pause finds it
   warm. The rest was the queue consumer's distance from the database (see
   the 2026-09-10 measurements): the app intake now runs the first slice
   itself and the wait to start is 2.7 to 3.9 s. The stage breakdown lives
   in Workers Logs; the dashboard's Observability → Events view with the
   needle `runtime-latency` shows it for the last hours, which the wrangler
   OAuth token cannot query. The Telegram webhook runs its first slice the
   same way since the same day; re-run `reply-latency.sh db 7` after a week
   to see both channels' wait-to-start settle. Until 2026-09-09 every dispatch
   held the sprite awake for 24 hours (`AISAR_KEEPALIVE_GRACE_HOURS`, then
   defaulting to 24); it is now `0`, so an idle sprite pauses and stops
   billing. Measured 2026-09-10 against the platform API: a sprite goes
   `running` → `warm` within 15 s of its last activity (compute billing
   stops there, processes frozen, wake 100–500 ms) and only later `cold`
   (wake 1–2 s, then Hermes restarts, which is the 15–30 s an owner sees
   on the first message after a long gap). Per docs.sprites.dev only live
   activity keeps a sprite awake: an exec, a TTY, an open TCP connection,
   or a service *with open connections*; a merely running service does
   not. Awake time is therefore about the reply itself, roughly 40 s, not
   the gap after it.
4. Not a lever: `reasoning_overrides` for MiniMax (see above).
5. **Per-run cap by mode** (2026-09-10). Every business's budget allows a
   run 900 s; a quick reply is now capped at 300 s at dispatch, deep work
   keeps 900 s. The runner enforces the deadline itself, so a stuck chat
   turn costs five minutes of sprite time at most. Before the runner-side
   deadline existed (2026-09-07), one such turn ran for 7 h 15 min.

## Re-measuring

```bash
export AISAR_NEON_OWNER_URL="$(cat ~/.config/neon/owner-url)"
worker/scripts/reply-latency.sh db 7               # channel × model, p50/p90, wait vs model time
worker/scripts/reply-latency.sh models             # per-call latency of every routed model, from a sprite
worker/scripts/reply-latency.sh continuity         # two-turn memory probe against Hermes
```

The `models` and `continuity` probes run on the Kitakod Ventures sprite by
default and spend a few cents of its model budget. Run `models` twice, an
hour apart, before drawing a conclusion about MiniMax-M3.
