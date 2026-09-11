# Reply time and channel parity

What happens between an owner's message and Jentera's reply, why the two
channels answer the way they do, where the seconds go, and what has been
tried. Numbers here are dated and come from `worker/scripts/reply-latency.sh`;
re-run it before trusting them.

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
