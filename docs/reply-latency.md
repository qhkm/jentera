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
3. **Dispatch.** The consumer leases the task, reserves budget, wakes the
   business's sprite if it is suspended, and starts the run on the runner,
   which starts it on Hermes. `run-task.ts` records stages
   (`database_ready`, `runner_ready`, `hermes_started`, …) and the consumer
   logs them as `[runtime-latency]` lines to Workers Logs.
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
| Prompt and framing | `prepareHermesAgent` | `prepareHermesAgent` (same since 21e1bb8, 2026-09-09; before that the app used the older `prepareAsk` prompt) |
| Facts and recent work | `retrieveHermesContext` | same |
| Response mode | `quick`, unless the message starts with `/deep` or `/research` (e54aea9, 2026-09-09; before that, wording like "deep dive" also chose deep) | always `deep` |
| Model | quick model (`AISAR_MODEL_NAME`, MiniMax-M3), or the business's `AISAR_QUICK_MODEL_OVERRIDES` entry (M2.7-highspeed canary on Kitakod Ventures) | deep model (`AISAR_DEEP_MODEL_NAME`, deepseek-v4-flash) |
| Session id | `telegram:<businessId>:<chatId>` | the app's chat-tab id |
| Memory | Hermes reloads the persisted transcript for a stable session id (present since Hermes 2026.9.5; on the fleet since v2026.9.8, 2026-09-08). Confirmed 2026-09-09 with `reply-latency.sh continuity`: turn two recalled turn one. | same mechanism, per app tab |
| Cross-channel memory | none: a Telegram chat and an app tab are separate sessions | |
| While waiting | live bubble, status edits, streamed handoff | static "working" placeholder |

So the remaining difference by design is mode and model: chat is where an
owner asks for work, Telegram is where they chat. The remaining difference
not by design is that the app does not stream.

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
   the effect on the Telegram quick row.
2. **Stream into the app.** Telegram already streams a live bubble from the
   runner's delta stream; the app replaces a placeholder at the end. The
   RunStream Durable Object exists; the work is in the app.
3. **The 7 to 12 s wait to start.** The stage breakdown is only in Workers
   Logs (`wrangler tail aisar-api --format json`, filter `runtime-latency`),
   which the wrangler OAuth token cannot query historically. Capture a few
   real runs to see whether the time is sprite wake, runner start, or
   Hermes accept before changing anything. Until 2026-09-09 every dispatch
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
