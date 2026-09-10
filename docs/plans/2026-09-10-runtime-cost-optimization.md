# Runtime cost — measure the loop, then bound it

Status: **proposed**. Prepared 10 September 2026, against the code on
`main` at f906a9e (the deepseek quick trial for Kitakod Ventures is assumed
shipped; this plan works around it, not on it).

This is a sequencing document. It says what to change, in what order, why
that order, and what proves each step. Nothing here changes production by
being written down.

## What the numbers say, checked against the code

The month-to-date measurements (2026-09-01 to 2026-09-10, `runtime_usage`
via `worker/scripts/stats.sh`) hold up where the code can be read:

- Jentera's own contribution to the first model call is small.
  `retrieveHermesContext` (`worker/src/ask.ts`) loads 24 facts and 8 work
  records in one round trip; `prepareHermesAgent` renders them; the
  measured `runtime_task.payload.input` averages 2,715 characters and
  `HERMES_AGENT_PROMPT` is 2,440. `boundedAgentInput`'s 19,500-character
  cap has never bound.
- Input is ~98% of spend and scales with the loop. `runtime_usage.input_tokens`
  is the *sum of prompt tokens over every model call in the run*: Hermes
  accumulates `agent.session_prompt_tokens += prompt_tokens` per call
  (`agent/conversation_loop.py`) and reports that total as the run's
  `usage.input_tokens` (`gateway/platforms/api_server.py`); the runner
  passes it through `boundedTaskStatus` and the worker stores it with
  `measuredUsageOf` → `finalizeRuntimeUsage`. So p50 23k / p90 152k / max
  898k are transcript-times-iterations figures, exactly as summarised.
- Price, not volume, sets the bill. `MODEL_PRICING` in
  `worker/src/runtime/usage.ts` is micro-USD per 100 tokens:
  `deepseek-v4-flash` {6, 12} = $0.06/$0.12 per million;
  `MiniMax-M3` and `MiniMax-M2.7-highspeed` {60, 240} = $0.60/$2.40.
  Ten times on input, twenty on output.
- Routing is as described (`worker/wrangler.toml`: quick
  `MiniMax-M2.7-highspeed`, deep `deepseek-v4-flash`, candidate
  `MiniMax-M3`; `quickModelOverride` in `worker/src/runtime/response-mode.ts`
  validated against `routedModelNames`). The $5 cap is
  `runtime_budget.monthly_cost_microusd` default 5,000,000 (migration 015);
  migration 023 nulled the token caps on 2026-09-10.

Five places where the summary and the code disagree, or where the summary
is right for a reason it does not state:

1. **"Total first call ≈ 1.3k tokens" is Jentera's share only.** Hermes
   prepends its own system prompt and the full-tools schema
   (`platform_toolsets.api_server = hermes-api-server`, pinned in
   `runner/bin/configure-model-provider.py`) to every call. Neither is
   visible from this repo. The smallest run in the sample already cost
   5,360 input tokens; a single-iteration run cannot be 1.3k. The fixed
   per-iteration overhead is unmeasured and is one of the things step 1
   exists to measure.
2. **Per-call token usage already passes through this repo and is thrown
   away.** Every model call a sprite makes goes through the model proxy
   (`worker/src/routes/model.ts`): `recordUsage` reads `prompt_tokens` and
   `completion_tokens` from each non-streaming response, `meteringStream`
   sniffs the final usage chunk of each streamed one, and both fold the
   result into a monthly aggregate (`fmcv_rider_spend`, keyed by the
   pseudonymous rider id). Per-call accounting is therefore a worker deploy
   away, not a sprite release away. The seam is in-repo. (Streams that
   never emit a usage chunk are silently unmetered — the header comment
   says so — which is why the first thing to record is how often that
   happens.)
3. **"deepseek carried the most tokens per call" conflates model with
   mode.** Until 2026-09-10 app chat was hard-wired to deep
   (`docs/reply-latency.md`), and deep is the research-heavy mode by
   design. The 17 deepseek runs at 110k average are deep runs; nothing in
   the sample says what deepseek does on a quick reply. The trial's
   evaluation has to compare quick against quick.
4. **The iteration cap is already 20, not Hermes's 90.**
   `configure-model-provider.py` pins `agent.max_turns = 20`; Hermes
   bridges that into `HERMES_MAX_ITERATIONS` (`gateway/run.py`,
   `_current_max_iterations`) and `/v1/runs` reads it as a gateway-wide
   value, not per run. So an 898k-token run averaged ~45k tokens per call,
   which points at transcript size (history and tool output), not at a
   runaway iteration count.
5. **Two things are already sprite-side that the summary lists as open.**
   Hermes's post-turn "background review" — a full-context model call
   observed at 23–62k input tokens — is pinned off
   (`auxiliary.background_review.enabled = false`). And the runner's
   `model_options.reasoning {enabled: false}` for quick replies is **not
   honoured**: `model_options` appears nowhere in the pinned
   `api_server.py` nor in `runner/bin/patch-hermes-dependencies.mjs`. Quick
   reasoning is governed by `agent.reasoning_overrides` (pinned `"high"`
   for the quick model and candidates) and by Hermes's default for anything
   else. The deepseek trial runs quick replies with whatever reasoning
   deepseek does by default, since it is not in the overrides map.

One small inconsistency worth a line in the code, not a step here: the
monthly totals in `usage.ts` (`monthlyState`) price in-flight reservations
at deepseek's rate (`reserved_input_tokens * 6 + reserved_output_tokens *
12`) regardless of the row's `model`, while `reserveRuntimeUsage` prices the
reservation it is about to make at the model's rate. A MiniMax run in flight
is under-counted by ~$0.11 until it finalises. Harmless at $5; wrong on
principle.

## Invariants

These hold through every step. A step that needs to break one is a
different plan.

- **No content in any new table.** Per-call rows carry sizes, counts,
  token numbers and a model id. Never a message, a prompt, a tool output,
  a page. The runner already keeps tool results and transcripts on the
  sprite side of the trust boundary (`runner/README.md`); the proxy must
  not become the leak the runner closed.
- **The proxy meters; it does not decide.** Anything that changes what a
  run may do — iterations, tools, budget — is decided in the control plane
  under `withTenant`, or pinned in the sprite bundle. Same rule as the
  adapter seam in `CLAUDE.md`: a runtime that could act on its own
  accounting could bypass the approval gate.
- **Tenant-free tables stay tenant-free.** `fmcv_rider_spend` carries only
  a rider id and a number, with identity-agnostic RLS, and migration 020
  says what happens if tenant data is ever added: rework RLS around
  `business_id`. The per-call table follows the same rule; attribution to
  a business happens in owner-side analysis by joining
  `agent_runtime.provider_name` (the rider id is `runtimeName(businessId)`,
  `worker/src/agent-runtime.ts`), never by storing the business in the row.
- **Measured beats estimated.** `finalizeRuntimeUsage` charges the
  reservation ceiling when a run ends without a usage report and repairs
  it when one arrives. Nothing here changes that, and every cost figure
  quoted must say which of the two it is.
- **Snapshots stay truthful.** `run.model` and `run.runtime` are taken at
  start; per-call rows carry the model the proxy actually forwarded. A
  later routing change must not rewrite either.
- **Nothing is applied to a sprite by hand.** Every Hermes config key
  below lives in `runner/bin/configure-model-provider.py` and reaches the
  fleet only through `worker/scripts/ship-runtime.sh`. `fleet-exec.sh` is
  for reading state.
- **Every step has a one-line rollback** that does not need a fleet
  release: remove an override, revert a prompt, redeploy the worker. Steps
  that do need a release (the sprite-side knobs) are last and are shipped
  one at a time.

## Ordering, and why

The order is: **look at what is already stored → record per-call usage →
judge the deepseek trial → bound the loop → decide the cap.** The summary
proposed instrumentation first; I agree, but for a reason worth making
explicit, and with one thing in front of it.

Steps 2 and 3 are both guesses without step 1. The trial cannot be judged
on `runtime_usage` alone because that table cannot separate a model change
from a mode change, a prompt change from a session-history change, or a
compaction call from a reply. And the loop cannot be bounded sensibly
because each candidate knob targets a different component of the
per-call prompt — Hermes's fixed overhead (system prompt and tool schemas),
the accumulated session transcript, and tool output — and the sample does
not say which one dominates. Choosing a knob without that breakdown is
picking a lever by feel; measuring the effect afterwards would still be
impossible.

Step 0 goes in front because it is free and because two of its answers
change what step 1 must do: how much of the $2.28 is *estimated* rather
than measured, and whether the proxy's ledger and the control plane's
ledger agree. If they disagree by a lot, the proxy is missing calls (the
streaming gap) and step 1's schema needs the `usage_seen` flag to be a
first-class column, not an afterthought.

Step 2 runs concurrently with step 1 in calendar time — the trial is live
today — but its *verdict* waits for step 1's data. Step 3 comes after both
because a prompt or session change during the trial would confound it.
Step 4 comes last because the answer depends on which model quick replies
end up on; the cap arithmetic differs by 10× between the two answers.

## Step 0 — what the existing tables already answer (no code)

Run these through `./worker/scripts/stats.sh sql "…"` this week. Each is a
question the later steps depend on.

**Measured versus estimated.** How much of the month is reservation
ceilings rather than reports?

```sql
select model, finalization_method, count(*),
       round(sum(cost_microusd)/1e6, 4) as usd,
       round(avg(input_tokens)) as avg_in
  from runtime_usage
 where started_at >= date_trunc('month', now())
 group by 1, 2 order by 1, 2;
```

An `estimated` MiniMax row is $0.12 (100k in + 25k out at that price); on
deepseek it is $0.009. If more than a handful of rows are estimated, the
$2.28 is partly ceiling, and the per-run means in the summary shift.

**The two ledgers.** The proxy meters every call (including compaction,
title generation and other auxiliary calls, and calls from runs that later
failed); the control plane charges per run. They should be close.

```sql
select b.name, ar.provider_name as rider,
       round(coalesce(s.spend_microusd, 0)/1e6, 4) as proxy_usd,
       round(coalesce((select sum(u.cost_microusd) from runtime_usage u
                         where u.business_id = b.id
                           and u.started_at >= date_trunc('month', now())), 0)/1e6, 4)
         as control_plane_usd
  from business b
  join agent_runtime ar on ar.business_id = b.id and ar.deleted_at is null
  left join fmcv_rider_spend s
    on s.rider_id = ar.provider_name
   and s.month = to_char(now() at time zone 'utc', 'YYYY-MM')
 order by proxy_usd desc;
```

A proxy figure well *below* the control plane's means streams are ending
without a usage chunk (unmetered) or the control plane is charging
estimates; well *above* means auxiliary calls are a real cost the run
ledger never sees. Either answer shapes step 1.

**Quick versus deep, by model.** The comparison step 2 needs, with what is
already there:

```sql
select r.model, t.payload->>'responseMode' as mode, count(*) as runs,
       round(percentile_cont(0.5) within group (order by u.input_tokens)) as in_p50,
       round(percentile_cont(0.9) within group (order by u.input_tokens)) as in_p90,
       round(avg(u.runtime_ms)/1000, 1) as secs,
       round(sum(u.cost_microusd)/1e6, 4) as usd
  from runtime_usage u
  join runtime_task t on t.id = u.runtime_task_id
  join run r on r.id = t.run_id
 where u.started_at >= date_trunc('month', now())
   and u.finalization_method = 'measured'
 group by 1, 2 order by 1, 2;
```

Caveat the reader must carry: Telegram runs have their `payload` scrubbed
to `{}` at completion (`completeRuntimeTask` with `scrubPayload`,
`worker/src/runtime/consumer.ts`), so `responseMode` survives only for app
runs and for Telegram runs that are not yet complete. Telegram mode has to
be inferred from `run.trigger_ref->>'question'` starting with `/deep` or
`/research` (`responseModeFor`). Step 1 fixes this by recording mode on
the call rows' analysis join, not by unscrubbing anything.

**Tool starts.** `run_event` type `agent.tool` has five rows because it is
appended only when a live Telegram bubble or a web subscriber exists
(`onToolEvent: (liveStream || web) ? … : undefined` in `consumer.ts`), and
only since 2026-09-10. It is evidence of work-versus-conversation
(`workKindForRun`), not a tool count. Do not use it as one until step 1b.

### Step 0 results, run 2026-09-10

**Measured versus estimated.** 100 of 133 rows, and **68.1% of the month's
$3.13**, were reservation ceilings rather than reports:

| model | finalization | rows | usd | avg input |
|---|---|---|---|---|
| MiniMax-M3 | estimated | 90 | 2.0225 | 69,190 |
| MiniMax-M2.7-highspeed | measured | 19 | 0.7320 | 63,537 |
| MiniMax-M3 | measured | 4 | 0.2588 | 163,362 |
| deepseek-v4-flash | estimated | 10 | 0.1066 | 173,612 |
| deepseek-v4-flash | measured | 7 | 0.0082 | 18,770 |

**But the split is a date, not a model — and the problem is already
fixed.** Every estimated row predates 2026-09-07; since 09-08 all 32 runs
are measured:

| day | estimated | measured |
|---|---|---|
| 09-01 → 09-06 | 98 | 0 |
| 09-07 | 2 | 1 |
| 09-08 → 09-10 | 0 | 32 |

So the month's per-run cost means are inflated by a window that has
closed, and no work is needed here. What has *not* been undone is the
effect: those inflated figures still sit in `runtime_usage` and still
count against `runtime_budget.monthly_cost_microusd`, so businesses active
before 09-07 are carrying September charges a fixed bug produced. Whether
to rebase those rows is a step 4 question, not a metering one.

**The two ledgers.** Both directions of disagreement are present, on
different tenants:

| business | proxy USD | control plane USD | ratio |
|---|---|---|---|
| NEOREKA ASIA | 5.0175 | 0.2012 | 24.9× |
| Kitakod Ventures | 1.0595 | 2.7035 | 0.39× |
| Warung Demo | 0.0925 | 0.0851 | 1.09× |
| seven others | ~0.0705 | 0.0000 | — |

NEOREKA's gap is the estimated window: the proxy metered the calls it
really made while the control plane charged an estimate a fifth the size.
It had crossed `RUNTIME_MODEL_CEILING_LIMIT_USD` and every model call had
been refused since 2026-09-09 01:50 — invisible in `stats.sh`, which reads
the control plane. Reset to zero on 2026-09-10 so the account could be
used again; the 5.0175 above is therefore historical.

Kitakod's gap runs the other way **on measured rows**, which the estimated
window does not explain. The likely reading is that Hermes's
`session_prompt_tokens` counts the full prompt on every call while the
router bills cached prefixes at a lower rate — which would mean the cap
over-charges every tenant by roughly this factor. Unresolved; it is the
first thing step 1's `cached_tokens` column should settle.

The uniform ~$0.0705 against zero runs on seven businesses is the more
uncomfortable number: a provisioned sprite costs that much per month
before its owner sends anything. The near-identical value across tenants
points at the per-release model smoke. Not yet confirmed.

**Quick versus deep, measured rows only.** The like-for-like comparison
the trial needed:

| model | mode | runs | in p50 | in p90 | secs | usd |
|---|---|---|---|---|---|---|
| MiniMax-M2.7-highspeed | quick | 12 | 20,828 | 67,158 | 18.9 | 0.2217 |
| MiniMax-M2.7-highspeed | (Telegram) | 7 | 83,097 | 181,453 | 21.0 | 0.5103 |
| MiniMax-M3 | (Telegram) | 4 | 138,586 | 222,322 | 80.4 | 0.2588 |
| deepseek-v4-flash | deep | 7 | 18,950 | 19,510 | 36.2 | 0.0082 |
| deepseek-v4-flash | quick | 2 | 19,150 | 19,157 | 6.8 | 0.0023 |

Carrying the caveat this document already states: Telegram runs have their
payload scrubbed at completion, so those rows show no mode.

At near-identical prompt size, quick on deepseek cost **$0.0012 a run
against M2.7's $0.0185, and answered in 6.8s against 18.9s** — fifteen
times cheaper and nearly three times faster. Two runs is not a verdict and
they predate the trial, but it is the first evidence that is quick against
quick rather than deep against quick, and it points the same way as list
price. Step 2 stands as written.

One number here deserves its own line, because it is what the whole
exercise is about: an M2.7 quick reply on 2026-09-10 spent **83,097 input
tokens to produce 42 output tokens**, and cost five cents. That is about a
hundred replies per $5 month.

## Step 1 — per-call token accounting at the model proxy

### 1a. Record every call (this repo; a worker deploy)

**Where.** `worker/src/routes/model.ts`, in `recordUsage` (non-streaming)
and `meteringStream` (streaming), plus one new write on the path where a
stream ends with `metered === false`. The request body is already parsed
(`parsed`) for the `stream_options` injection, so counts and sizes cost
nothing extra; the content is not retained.

**Schema.** Migration `026_model_call.sql`, with
`worker/scripts/apply-model-call.mjs` and a `db:migrate:model-call` entry
in `worker/package.json`, following `apply-runtime-budget-token-caps.mjs`
(owner URL check, transaction, verification query, JSON line).

```sql
create table if not exists public.model_call (
  id                 bigint generated always as identity primary key,
  rider_id           text        not null,     -- aisar-b-…, as in fmcv_rider_spend
  model              text        not null,     -- the id the proxy forwarded
  streamed           boolean     not null,
  usage_seen         boolean     not null,     -- false: stream ended, no usage chunk
  prompt_tokens      integer,
  completion_tokens  integer,
  cached_tokens      integer,                  -- prompt_tokens_details.cached_tokens when present
  cost_microusd      bigint,
  request_bytes      integer     not null,
  message_count      integer     not null,     -- length of messages[]
  tool_count         integer     not null,     -- length of tools[] (0 when absent)
  system_chars       integer     not null,     -- sum of role=system content lengths
  tools_chars        integer     not null,     -- JSON length of tools[]
  history_chars      integer     not null,     -- everything else except the last user message
  last_user_chars    integer     not null,
  upstream_status    smallint    not null,
  latency_ms         integer     not null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_model_call_rider_time on public.model_call (rider_id, created_at);
```

RLS enabled with identity-agnostic insert/select policies for `aisar_app`,
exactly as migration 020 does for `fmcv_rider_spend`, and the same comment
about what must change if tenant data is ever added. No `business_id`, no
`runtime_task_id`. Retention: the `*/15` sweep in `worker/src/index.ts`
deletes rows older than 90 days; the table is a diagnostic, not a ledger.

**Attribution** happens at read time, as the owner, and needs no new
column: a sprite runs one task at a time (`idx_runtime_task_one_lease`;
the runner's single admission slot; `gateway.api_server.max_concurrent_runs
= 1`), so every call from rider R between a task's `runtime_usage.started_at`
and `completed_at` belongs to that task:

```sql
select u.runtime_task_id, u.model, count(c.*) as calls,
       sum(c.prompt_tokens) as prompt_sum, u.input_tokens as reported,
       max(c.system_chars + c.tools_chars) as fixed_chars,
       max(c.history_chars) as history_chars_peak,
       count(*) filter (where not c.usage_seen) as unmetered
  from runtime_usage u
  join agent_runtime ar on ar.business_id = u.business_id
  join model_call c on c.rider_id = ar.provider_name
                   and c.created_at between u.started_at and coalesce(u.completed_at, now())
 where u.started_at >= date_trunc('month', now())
 group by 1, 2, u.input_tokens;
```

`prompt_sum` should equal `reported` for a fully metered run; the gap is
the unmetered stream count. Auxiliary calls (compaction, titles) fall into
whichever run was live and are recognisable by shape — a compaction call
has a large `history_chars` and no `tools` — which is the right
attribution, since they are that run's cost.

**Tests.** Extend `worker/test/model-proxy.test.ts` (it already covers
non-streaming metering, a stream with `"usage": null` chunks, a final usage
chunk, and `include_usage` injection): assert one `model_call` row per
case with the expected counts, and one row with `usage_seen = false` for a
stream that closes without usage. Arrange as owner, assert as `aisar_app`,
per `harness.ts`.

**Rollback.** Redeploy the previous worker; the table can stay.

### 1b. Per-iteration usage on the run stream (sprite-side; only if 1a is not enough)

The Jentera patch already adds an `iteration.started` event with
`iteration` and `max_iterations` from `getattr(agent, "max_iterations")`
(`runner/bin/patch-hermes-dependencies.mjs`, `_step_cb`); the runner
relays it as `{type: 'iteration', current, total}`
(`runner/src/server.mjs`, `acceptFrame`) and the worker consumes it in
`onIteration` for the status line. Adding
`prompt_tokens=getattr(agent, "session_prompt_tokens", 0)` and the
completion counterpart to that same event gives exact per-iteration deltas
attributed to the task by construction, with no time-window inference.

That is a sprite release: patch script, `HERMES_PATCH_ID` bump in
`server.mjs` and `worker/src/runtime/runner-client.ts`, the runner's event
shaping (`shapedStreamEvent`), and a new `run_event` type — `agent.iteration`
with `{iteration, maxIterations, promptTokens, completionTokens}` — added
to the closed `EVENTS` vocabulary in `worker/src/runs.ts`. At most twenty
rows per run. Do it only when 1a's attribution proves ambiguous in
practice (concurrent auxiliary calls, or a run whose `prompt_sum` and
`reported` will not reconcile); the proxy answers the sizing questions
without it.

### What step 1 lets you answer that you cannot today

- The fixed cost of every iteration — system prompt plus tool schema —
  in characters and, via `prompt_tokens` on a first call with no history,
  in tokens. If it is 4–5k tokens, the tool bundle is the first thing to
  trim for quick replies, and no amount of prompt editing in `ask.ts`
  touches it.
- How much of a run is session history: `history_chars` on the first
  call of a turn is the hydrated transcript. If a Telegram chat's first
  call is 60k characters before the question, session growth is the
  lever, not iterations.
- How many iterations a quick reply really takes, and how many of them
  carry a tool result (a call whose `history_chars` jumped by more than
  the previous completion).
- Whether streaming calls are being metered at all, per model.
- Whether compaction ever fires (a call with no tools and a large
  history), and what it costs on the auxiliary model.
- For the trial: prompt tokens, completion tokens (a proxy for reasoning
  length), latency and cost per call, by model, on quick replies only.

## Step 2 — judging the deepseek quick trial

The override is one line in `wrangler.toml`
(`AISAR_QUICK_MODEL_OVERRIDES = "<Kitakod>=deepseek-v4-flash"`); ending the
trial either way is a worker deploy. That is what makes it safe to run
without an evaluation harness — but not what makes the verdict honest.

### What "quality" means for a two-or-three-sentence business answer

The product's own rules, in `ask.ts` (`PROMPT` and `HERMES_AGENT_PROMPT`),
define it. Four axes, in order of weight:

1. **Grounded.** The answer uses only confirmed facts and real work
   records. No invented number, policy, hour or price; no invented source
   ("you told me", "our recent interactions" for something read off a
   page). A single fabrication is a failing answer regardless of the other
   axes — the owner will act on it.
2. **Correct where checkable.** For a question whose answer is in
   `business_fact` (hours, address, pricing the owner confirmed), the answer
   matches the fact. For "latest"-type questions, the answer cites a page
   that says what the answer claims.
3. **Adequate.** Answers the question asked, in the user's language,
   shaped for a phone: short paragraphs, no wall of prose, no tables in
   Telegram, no leaked reasoning or `@step:` chrome (`stripHermesThinking`
   is the backstop; a model that needs it more is worse).
4. **Tool discipline.** Did not research when the facts sufficed; did
   research when the question was about something current. This is the
   axis the cost work will push on, so it must be scored, not assumed.

Latency and failure are measured alongside, not folded into quality.

### Where the evidence already lives

| Signal | Where | Caveat |
|---|---|---|
| The question | Telegram: `run.trigger_ref->>'question'`; app: `runtime_task.payload->>'input'` (last line) | Telegram payloads are scrubbed at completion; the trigger survives |
| The answer | `work_record.outcome` | **500 characters** (`updateWorkForRun` slices; `sendAndRecord` in `telegram-delivery.ts` passes the full text and it is cut). Enough for a quick reply; a long answer is only in Telegram itself. App runs keep the full `result` on `runtime_task.result` |
| Model, mode | `run.model` (snapshot); mode as in step 0 | |
| Tool use | `work_record.kind` (`conversation` = no tool, no approval) and `run_event` `agent.tool` | `agent.tool` is written only with a live stream; step 1 gives the real count |
| Tokens, cost, time | `runtime_usage` (`input_tokens`, `output_tokens`, `runtime_ms`, `cost_microusd`, `finalization_method`) | use `measured` rows only |
| Failure | `run.status`, `run_event` `work.failed` payload `reason` | |
| Owner verdict | `work_record.outcome_quality` via `POST /api/runs/quality` (`worker/src/routes/runs.ts`, `rateWork`) | the thumbs exist only on Activity's *work* cards (`ActivityView.tsx`); a `conversation` record can never be rated, and nothing in chat or Telegram offers a rating. So there is no owner signal on exactly the replies the trial is about |
| "I don't know yet" answers | `work_record.outcome ilike '%don''t know%'` or the BM equivalent | a coarse proxy for groundedness holding under pressure |

### How to collect what is missing

Two things, both small.

**A rating on conversation replies.** The cheapest is a `kind` parameter on
`GET /api/runs/activity` (it is hard-filtered to `kind: 'work'` in
`routes/runs.ts`) so the founder can list and rate conversation records
from the same thumbs; the deliberate product choice to keep conversation
off Activity is preserved by leaving the default unchanged. A Telegram
`👍/👎` reply keyboard on the final bubble is the better long-term surface
and is not needed for the trial.

**A paired replay.** The founder's own traffic is the only real traffic,
and it arrives one model at a time. So build the comparison: take 30
real past questions (`run.trigger_ref->>'question'` from completed quick
runs, deduplicated, plus ten deliberately "current" ones — a price, a
regulation, a competitor's hours), and run each twice against the Kitakod
sprite's Hermes through `/v1/runs`, once with `model = MiniMax-M2.7-highspeed`
and once with `model = deepseek-v4-flash`, with the same `instructions`
and `input` the worker would build (`prepareHermesAgent` on the live
facts) and **no `session_id`**, so neither run inherits history.
`worker/scripts/reply-latency.sh continuity` already does the sprite-side
half of this (`sprite exec`, `/v1/runs`, poll `/v1/runs/{id}`); add an
`eval <questions.jsonl>` subcommand that emits a JSONL of
`{question, model, output, usage, seconds}`. Shuffle the pairs, hide the
model, and have the founder score each answer on the four axes (a
one-line-per-answer sheet is fine). Forty pairs is an afternoon.

Two honest caveats on the replay. Calls made this way are metered by the
proxy but bypass the run ledger and the $5 admission (they are not runs),
so they spend real money the control plane does not see — a few cents.
And a session-less replay understates the trial's real conditions, where
Telegram sessions carry history; the live signal below covers that.

### What ends the trial

Run it for **two weeks**, or until forty blind pairs are scored, whichever
is later. At one business's volume (10–13 quick replies a day) that is
150–200 live runs. This is a decision under uncertainty, not a
significance test; say so in the verdict.

Move quick to deepseek fleet-wide when all of these hold. That is two
changes, not one: set `AISAR_MODEL_NAME = "deepseek-v4-flash"` and add
`MiniMax-M2.7-highspeed` to `AISAR_CANDIDATE_MODEL_NAMES` in
`wrangler.toml` and deploy the worker — routing changes at once, because
`dispatchRuntimeRun` names the model on every `/v1/runs` and deepseek is
already a routed model on every sprite (`modelForResponseMode`,
`routedModelNames`) — then cut a release with `ship-runtime.sh`, because
the sprite-side defaults that read the same variable (the runner's
fallback `modelName`, Hermes `model.default`, the auxiliary model and
`reasoning_overrides` in `configure-model-provider.py`) only follow on
re-bootstrap. Keeping M2.7 routed as a candidate is what lets
`AISAR_QUICK_MODEL_OVERRIDES` move one business back without a release,
as it does for M3 today.

- no grounded-axis failure in the blind pairs that M2.7 did not also
  produce on the same question;
- blind preference not worse than 40/60 against M2.7, ties excluded;
- live failure rate (`run.status = 'failed'`) on quick runs not higher
  than M2.7's over the same fortnight, and no new failure reason;
- p50 model time (`work.started → work.completed`, `reply-latency.sh db
  14`) not worse than M2.7's; the per-call probes say it should be better;
- owner's verdict, in writing, in this document.

Revert the override (delete the line, deploy) when any of these happens:

- one fabricated fact or source in a live or blind answer that M2.7 did
  not produce;
- wrong-language or ignored-instruction answers exceed M2.7's by two or
  more in the blind set;
- failures or expired runs (`runner` status `expired`, the 300 s quick
  cap in `run-task.ts`) increase;
- the owner says so. That is a sufficient reason; the point of a
  founder-only trial is that the founder is the judge.

Either way, record the verdict, the dates and the counts here.

## Step 3 — bounding the loop

Only after step 1 says where the tokens are. The levers, grouped by where
they live, because that decides how they ship and how they roll back.

### In this repo (worker deploy; no sprite touched)

**3a. A quick-mode prompt.** `HERMES_AGENT_PROMPT` tells the model to
"research the live web", "open the relevant primary pages with browser
tools or curl", and treat search snippets as insufficient. For a research
request that is right. For "are we open Sunday?" it is an invitation to
spend forty thousand tokens confirming a fact the owner already confirmed.
`prepareHermesAgent` has no notion of mode; give it one
(`responseMode`, threaded from the two intakes that already carry it), and
let quick carry a shorter instruction: answer from the confirmed
information; use a tool only when the question is explicitly about
something current or external, or the user asks; one search and at most
two page opens; no browser. Deep keeps the prompt as it is. Test in
`worker/test/ask.test.ts` that the two modes render the two prompts and
that the framing (`User request:` at the end) is unchanged for
`boundedAgentInput`. Roll back by reverting the file.

This is the cheapest lever and the one most likely to matter, because it
changes the *number* of expensive iterations rather than the size of each.
It also interacts with the trial (axis 4), which is why it waits.

**3b. Session history.** `/v1/runs` hydrates the whole persisted
transcript for a stable `session_id` (`api_server.py`, "Persisted-transcript
hydration for stable session ids", added for the Jentera worker), and the
transcript store keeps tool rows (`get_messages_as_conversation` selects
`tool_call_id`, `tool_calls`, `tool_name`). The Telegram session id is
`telegram:<businessId>:<chatId>` (`consumer.ts`, Telegram admission) and
never rotates; the only bound is Hermes's compaction at 50% of the model's
context window. So a chat that did one research turn carries those pages
into every call of every later turn until compaction. Two in-repo
options, once step 1 shows `history_chars` is large:

- rotate the Telegram session on a boundary — per UTC day, or after N
  hours idle — by appending the boundary to the session id. Memory across
  the boundary is lost; `docs/reply-latency.md` records that continuity
  was deliberately proven, so this is a product trade, not a free win.
  Say it in the commit.
- stop re-sending the facts block into the transcript. `prepareHermesAgent`
  puts the rendered facts in `input`, which is persisted as a user
  message and replayed on every later turn; the same facts are rendered
  again on the next turn. Moving the facts block into `instructions`
  (Hermes treats it as the ephemeral system prompt for the run) would keep
  the transcript to questions and answers. **Unverified:** whether the
  pinned Hermes persists the ephemeral system prompt into the session
  rows. Check before relying on it; step 1's `system_chars` versus
  `history_chars` on turn two will show which.

**3c. The time cap is already per mode.** `QUICK_RUN_CAP_SECONDS = 300`
in `run-task.ts`; deep keeps `runtime_budget.max_run_seconds` (900). The
runner enforces the deadline. Leave it.

### Sprite-side (a config key in `configure-model-provider.py`; ships only via `ship-runtime.sh`)

Each of these is a line in the script, a bundle commit, a `RUNTIME_RELEASE`
bump, and a fleet convergence. Ship them one per release so an effect can
be attributed, and after 3a, so the prompt change is not confounded.

**3d. Iteration cap per mode.** `agent.max_turns = 20` is pinned and is
gateway-wide; the pinned `/v1/runs` does not read a per-run value. A quick
cap lower than deep's needs the Jentera patch to read
`body.get("max_iterations")` and pass it to `_create_agent` — the patch
already threads `step_callback` through that call, so the anchor exists —
and the runner to send it by mode. That is a patch change plus a
`HERMES_PATCH_ID` bump. Do it only if step 1 shows quick replies routinely
running past, say, eight iterations; the prompt in 3a should make it
unnecessary.

**3e. Tool output size.** Defaults at the pin: `web.extract_char_limit`
15,000 characters per page (`tools/web_tools.py`, `DEFAULT_EXTRACT_CHAR_LIMIT`,
head 75% / tail 25% with a footer), `tool_output.max_bytes` 50,000 for
terminal output, `tool_output.max_lines` 2,000 and `max_line_length` 2,000
for file reads (`tools/tool_output_limits.py`). Neither is pinned today,
so the fleet runs on Hermes's defaults. For a product whose answer fits a
phone screen, `web.extract_char_limit = 6000` and `tool_output.max_bytes =
20000` are defensible first values. The browser snapshot cap
(`SNAPSHOT_SUMMARIZE_THRESHOLD = 15000`, `tools/browser_tool.py`) is a
constant, not a key; changing it is a patch, and the quick prompt should
keep the browser out of quick replies anyway.

**3f. Compaction earlier.** `compression.threshold` 0.50,
`compression.threshold_tokens` unset, `compression.protect_last_n` 20
(`hermes_cli/config.py` defaults; read in `agent/agent_init.py`). Setting
`compression.threshold_tokens` to about 40,000 makes compaction fire on
token count rather than at half of whatever the router reports as the
context window. Two cautions. Compaction is itself a model call on the
auxiliary model, which `configure-model-provider.py` pins to the **quick**
model — on MiniMax that call can cost more than it saves on deepseek, and
step 0's ledger reconciliation will show whether compaction runs at all
today (the script's comment says auxiliary calls used to 401 against the
customer router). And an earlier summary is a memory trade of the same
kind as 3b's rotation.

**3g. Reasoning.** Not a lever on MiniMax (`docs/reply-latency.md`), and
`model_options` is ignored at the pin, so the only control is
`agent.reasoning_overrides` per model id. If deepseek becomes the quick
model and its default reasoning is long, add it to the overrides map with
a lower effort *and measure it* with `reply-latency.sh models`
(`reasoning_chars`) and step 1's `completion_tokens`; do not assume the
key does anything until the probe says so.

### What "bounded" means, as a target

Not a number picked in advance. After 3a and one sprite-side knob, a quick
reply's measured input tokens (step 1, `prompt_sum`) should sit at p50
under 15k and p90 under 60k, with the first call's fixed overhead
unchanged (it is Hermes's, and outside this plan). If p90 is still above
100k after 3a, 3b is next, not 3d.

## Step 4 — the $5 cap and the credit model

### Where the $5 lives

In three places that must move together, and one of them is not a
setting:

- `runtime_budget.monthly_cost_microusd`, default 5,000,000 (migration
  015). Per business, changeable by an apply script; the admission check
  is `reserveRuntimeUsage`.
- `RUNTIME_MODEL_CEILING_LIMIT_USD = 5` (`worker/src/fmcv-verifier.ts`)
  and `LIMIT_USD = 5` (`worker/src/runtime/openrouter-keys.ts`). This is a
  **signed claim** in every sprite's model credential
  (`deriveJenteraRuntimeCredential` puts `limitUsd` in the payload;
  `verifyJenteraKey` rejects any other value). Changing it re-derives every
  credential; `runtimeModelKeyNeedsRotation` notices on each business's
  next run and publishes a `model-key-rotation` upgrade task. Self-healing,
  but a fleet event, and until it lands that business's model calls answer
  401. It is not a knob to turn on a Friday.
- `CREDIT_CAP_NOTICE` (`consumer.ts`), the words the owner reads.

Two independent ledgers enforce it (`runtime_usage` at admission,
`fmcv_rider_spend` at the proxy), and step 0 will show how far apart they
drift. Whichever trips first wins; today the proxy's 429 surfaces as a
failed run whose detail matches `/budget_exceeded/` and gets the same
notice.

### Unit economics, per business per month

Using the measured month: mean 77,086 input and 1,280 output tokens per
run, p50 23,202 input. Sprite compute is **not** in these figures —
`runtime_usage.runtime_ms` is tracked and capped (`monthly_runtime_seconds`
360,000, not close to binding) but Sprites bill awake time on their own
invoice, and the summary's 21.8 s → 520.9 s scaling says that cost also
tracks tokens. Find the Sprites rate and add a column before pricing a
plan.

| Quick model, loop as today | $/run (mean) | $/run (p50) | runs per $5 (mean) | Kitakod's pace (≈380 runs/mo) |
|---|---|---|---|---|
| MiniMax-M2.7 / M3 | $0.049 | $0.017 | ~100 | ~$19 — cap around day 8 |
| deepseek-v4-flash | $0.0048 | $0.0015 | ~1,000 | ~$1.8 |
| deepseek + bounded loop (mean ≤ 30k input) | ~$0.002 | ~$0.001 | ~2,500 | < $1 |

(The measured pace of $2.28 in ten days was a mix, mostly M3; the M2.7 row
is what the fleet default costs today.)

The reservation adds friction only at the edge: `reserveRuntimeUsage`
holds 100k in + 25k out per active run, which is $0.12 on MiniMax and
$0.009 on deepseek, so a MiniMax business is refused its last reply at
$4.88. An `estimated` finalisation charges that same $0.12; on a fleet of
one active business it is noise, but it is the first thing to look at if
the proxy ledger and the run ledger disagree.

### Does the model survive contact?

On MiniMax, no. Five dollars is about a hundred replies — one attentive
owner's week — and the pre-launch promise ("every business gets US$5 of AI
credits a month") would be met with the cap notice by the second week. On
deepseek, comfortably: the same owner spends under two dollars, and a
bounded loop halves that again. So the cap question is really the model
question, which is why step 4 sits after step 2.

Recommendation: **do not touch the cap while the trial runs.** If the
trial moves quick to deepseek, keep $5, keep the promise, and revisit only
when a second real business appears. If the trial fails and MiniMax stays,
the honest choices are: raise the cap (three places, a credential
rotation across the fleet, and a price you then have to charge someone
for), or cap quick and deep separately (new `runtime_budget` columns and a
mode-aware `reserveRuntimeUsage`) so research cannot exhaust chat. Neither
is small; both are a second plan.

Two cheap things regardless. The owner never sees their spend:
`GET /api/runtime` returns `budget` and `usage` (`worker/src/routes/runtime.ts`,
`runtimeBudgetSnapshot`) and the app's `RuntimeOverview` type drops it —
show it. And the weekly `pulse.sh` should split spend by model and mode,
so the next month's numbers do not need a measurement phase.

## Acceptance gate

Step 0

- [x] Measured-versus-estimated split for the month recorded here, with
      the estimated share of spend as a percentage. (68.1% of spend; the
      split turned out to be a date, not a model, and the cause was fixed
      on 09-07/08.)
- [x] Ledger reconciliation recorded per business: proxy USD, control
      plane USD, and the explanation for any gap over 10%. (Kitakod's
      0.39x on measured rows is unexplained and is step 1's first job.)
- [x] Quick-versus-deep table by model recorded, with Telegram mode
      inferred from the trigger question and the caveat stated.

Step 1a

- [x] Migration `026_model_call.sql` applied; apply script verifies the
      table, its index, RLS enabled, and the grants; `db:migrate:model-call`
      in `package.json`. (Applied 2026-09-10; the grant check caught the
      000_role default-privilege UPDATE before it reached the database.)
- [x] `model-proxy.test.ts` asserts a row for a non-streaming completion,
      a streamed completion with a final usage chunk, and a streamed
      completion with none (`usage_seen = false`); asserts no content
      column exists (a test that reads the table's columns and fails on
      anything named like text or content).
- [ ] Sizes and counts only: a reviewer confirms by reading the insert.
- [ ] Attribution query above returns `prompt_sum = reported` for at least
      ten fully metered runs; the unmetered count per model is recorded.
- [ ] First answers written here: fixed overhead per call in tokens; share
      of a turn's first call that is history; iterations per quick reply
      (p50, p90); unmetered-stream rate per model.
- [x] 90-day retention runs in the sweep and is tested.

Step 1b (only if triggered)

- [ ] `agent.iteration` added to `EVENTS`; patch, runner, client and
      consumer tests updated; `HERMES_PATCH_ID` bumped; shipped with
      `ship-runtime.sh`; `fleet-verify.sh` green.

Step 2

- [ ] Conversation records ratable by the founder (a `kind` parameter on
      `/api/runs/activity`, default unchanged; `run-quality-route.test.ts`
      covers a `conversation` record).
- [ ] `reply-latency.sh eval` exists and produced ≥ 40 blind pairs; the
      scoring sheet and its totals are attached or linked here.
- [ ] Live fortnight table recorded: runs, failures, p50/p90 model time,
      p50/p90 input tokens, cost — quick only, by model.
- [ ] Verdict, date, and the owner's sign-off written into this document;
      the corresponding one-line change (fleet default or override
      removal) deployed and named by commit.

Step 3

- [ ] 3a: `prepareHermesAgent` takes a mode; `ask.test.ts` covers both
      renderings; deployed after the trial verdict, never during it.
- [ ] One sprite-side knob per release, each with a before/after from
      step 1's query over at least fifty quick replies, recorded here.
- [ ] Quick replies at p50 < 15k and p90 < 60k measured input tokens, or
      a written reason why not and what is next.
- [ ] No hand-applied sprite change at any point (`fleet-exec.sh` used
      for reading only; every config key present in
      `configure-model-provider.py` at the shipped bundle commit).

Step 4

- [ ] Sprites compute rate found and a compute column added to the unit
      economics table.
- [ ] Owner-facing spend shown in the app from `/api/runtime`'s existing
      `budget`.
- [ ] `pulse.sh` reports spend by model and mode.
- [ ] Cap decision recorded here, with the trial verdict it depends on.
      If the cap changes: all three places in one commit, the credential
      rotation observed to converge on every business (`stats.sh
      runtimes`), and `CREDIT_CAP_NOTICE` updated in the same change.

## Delivery order

1. Step 0 queries, this week. Half a day. Results written into this file.
2. Step 1a: migration, proxy change, tests, deploy. One to two days.
   Should land within the trial's first week so most trial runs are
   instrumented.
3. Step 2 collection runs from today; the conversation-rating tweak and
   the `eval` subcommand ship alongside 1a. Verdict at two weeks or forty
   pairs.
4. Step 3a immediately after the verdict, as its own commit and deploy.
   One measured week.
5. Step 3e or 3f, whichever step 1 points at, as one release via
   `ship-runtime.sh`. One measured week each. 3b only if history is the
   dominant share; 3d only if iterations are.
6. Step 4 decision, informed by the above. Owner-facing spend and the
   pulse split can ship any time after 1a.

Each step is reversible on its own: a deploy for 1a, 2 and 3a; a release
rollback per `docs/release-playbook.md` for the sprite-side knobs.

## Open questions

Stated so nobody mistakes a guess in this document for a fact:

- The context window the router reports for `MiniMax-M2.7-highspeed` and
  `deepseek-v4-flash` (it sets when compaction fires). Not in this repo.
- Whether the router reports `prompt_tokens_details.cached_tokens`, and
  whether either model is cached at all. Step 1 records it if present.
- Whether the ephemeral system prompt (`instructions`) is persisted into
  the session transcript at the pin. Decides 3b's second option.
- Whether auxiliary compaction runs today on production sprites. Step 0's
  ledger gap and step 1's call shapes will show it.
- Hermes line numbers cited above were read on the fork's working tree
  (`~/ios/hermes-agent` at 6d5fa79), not at the pinned commit
  `ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413` (tag `v2026.9.8`, present
  locally). The behaviours cited — global `max_iterations`, session
  hydration, tool rows in the transcript, the `web.extract_char_limit` and
  `tool_output.*` keys, compaction defaults, `model_options` ignored — are
  consistent with the B1 plan's findings at the earlier pin and with
  `configure-model-provider.py`'s comments, but re-read them at the pin
  before the first sprite-side release.
- Sprites' compute pricing, for the unit economics table.
