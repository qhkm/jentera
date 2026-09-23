# Knowing a computer is down before the owner does

`agent_runtime.status` is written when something succeeds and never when
anything stops. It is a record of the last good moment, not a statement about
now, and the app reads it as though it were the latter. On 23 September that
gap put an owner in front of a spinner for a sprite whose filesystem Fly had
already condemned.

This is about three separate things, in order of how much they are worth:
noticing, saying so, and fixing.

## What happened, 23 September

The owner of `b0b1d1dd…` sent a message at 06:54. The app showed
"System ready — starting…", then "Could not check Jentera's status". The run
retried five times and failed with `The operation was aborted due to timeout`.

The sprite had not been reachable since roughly 06:42:

```
corrupt-1790145722328   06:42:02   Corrupt filesystem snapshot saved during recovery
v2                      03:21:03   Jentera runtime 2026.09.23-2
```

Fly found a corrupt filesystem, snapshotted it, and the host stopped serving.
Throughout, `agent_runtime` said:

```
status = ready      last_ready_at = 04:02      last_error = (none)
```

Recovery, once the cause was known, took seconds: `sprite restore v2`, then
`fleet-verify` passed all four checks. **The hard part was knowing, not
fixing.** Twelve minutes of an owner's time went on a system that had the
evidence and did not look at it.

It is not one sprite. At the time of writing four runtimes disagree with
reality, three of them since **18 September**:

| sprite | `status` says | last actually verified |
|---|---|---|
| `…05a921d0` | `error` | 18 Sep |
| `…3d7d3328` | `error` | 18 Sep |
| `…aef5c56a` | **`upgrading`** | 18 Sep |
| `…d6decbeda` | **`ready`** | 23 Sep 04:02 |

A runtime has claimed `upgrading` for five days and nobody was told.

## What already exists to build on

None of this needs new infrastructure, which is most of why it is worth doing.

- **`sweepRuntimeDrift`** already runs on the quarter-hour cron
  (`index.ts`), already iterates the fleet, and already has provider
  credentials. A liveness pass belongs in it, not beside it.
- **`prewarmSprite`** (`runtime/prewarm.ts`) already probes `/healthz` with
  `AbortSignal.timeout(8_000)` and already records `last_prewarm_outcome` and
  `last_prewarm_ms` durably, per runtime. A liveness signal is already being
  collected and thrown away.
- **The checkpoint list we already fetch carries corruption.**
  `FlySpriteProvider.checkpoint()` calls `/checkpoints` and filters to
  `/^v\d+$/`, so a `corrupt-*` entry is dropped on the floor. Fly is telling
  us, in a response we already parse, and the filter discards it.

## The slice

- A **liveness pass** in the quarter-hour sweep marks a runtime unreachable
  when it fails a bounded probe, and records when it was last genuinely
  verified rather than when it last succeeded at something.
- **A corrupt checkpoint is an explicit signal**, not an inference from a
  timeout. When the provider's list carries a `corrupt-*` entry newer than the
  newest `v\d+`, that runtime is unhealthy and the reason is known.
- **The app stops claiming readiness it has not checked.** "System ready"
  requires a recent verified check; otherwise it says what is actually true,
  before the owner spends a message on it.
- **One owner-visible notification** when their computer is unreachable, and
  one operator-visible list.

Not included: automatic recreation of a sprite, automatic restore, changing
the prewarm timeout, paging, or any change to how runs retry. Those come after
there are numbers to set thresholds from.

## Detection

Add `last_checked_at`, `last_check_outcome` and `unhealthy_since` to
`agent_runtime`. The existing `status` keeps its meaning — the last thing that
succeeded — and is not overloaded; the new columns say whether that is still
true. Nothing reading `status` today changes behaviour.

The sweep probes each runtime the way `prewarmSprite` already does, and
records the outcome whatever it is. Two derived states matter:

- **unreachable** — the probe timed out or refused, twice in a row. One
  failure is a paused sprite or a slow wake, and must not be enough; the
  8000 ms prewarm timeout fires often enough on healthy sprites (below) that a
  single reading is not evidence.
- **corrupt** — the checkpoint list carries a `corrupt-*` entry newer than the
  newest versioned checkpoint. This needs no second opinion: Fly has already
  decided.

`VERSIONED_CHECKPOINT` stays as it is for choosing a rollback point. The
corruption check reads the same response for a different question, rather than
loosening a filter that exists for a good reason.

## Thresholds have to be measured, not guessed

The one number in hand argues against guessing. Prewarm outcomes across the
fleet on 23 September:

| outcome | sprites | avg ms |
|---|---|---|
| never prewarmed | 10 | — |
| `prewarm_failed` | 5 | **8000** — every one exactly the timeout |
| `prewarm_ready` | 2 | 6566 |

Five of seven attempts hit the ceiling, and the two that succeeded used 82% of
the budget. A probe calibrated to that would call most of a healthy fleet dead.
So the liveness pass records outcomes for a week before anything acts on them,
and the threshold is set from that distribution.

This also interacts with a change made the same day:
`AISAR_KEEPALIVE_GRACE_HOURS` went 0 -> 1, which should leave far fewer sprites
cold and make probes cheaper. Measuring before that change had settled would
have produced the wrong number.

## Saying so

`computer.unknown` ("Could not check readiness") already exists; the problem is
that the app prefers a cheerful stale answer to it. Two changes:

- Readiness shown to an owner comes from `last_checked_at` being recent, not
  from `status` alone. Stale means unknown, and unknown says so.
- An owner whose computer is unreachable is told **before** the send, not after
  five retries. The existing notification kinds cover the shape; this adds one
  reason.

## Fixing

Deliberately the smallest part, because the evidence says detection is what was
missing.

- **Restore from the newest versioned checkpoint** is the remediation that
  worked, by hand, in seconds. Automating it is plausible but it silently
  discards everything written since that checkpoint — 36 minutes of agent
  memory in this case — so it stays a one-command operator action with a
  documented procedure until the detection above has run long enough to trust.
- **Recreation is a one-way door for most of the fleet.** Every sprite made
  before `3fbf487` sits in LAX or SJC and cannot be moved without being
  replaced; `docs/moving-a-sprite.md` is the procedure and the cost. Nothing
  here recreates anything automatically.
- The three sprites stale since 18 September need a decision that is not
  technical: they belong to businesses, and `write Sprite runtime file failed
  (502)` is Fly's error, not ours. Ask Fly first.

## Delivery order

1. Migration for the three columns, and the sweep recording outcomes. Changes
   nothing an owner sees.
2. A week of collected data; set the thresholds from it.
3. The corrupt-checkpoint signal, which needs no threshold at all and can land
   with step 1.
4. The app's readiness wording, once there is a `last_checked_at` worth
   reading.
5. Notification, last.

## Acceptance gate

- A sprite made unreachable deliberately is marked within one sweep, and the
  owner is told without sending a message into it.
- A `corrupt-*` checkpoint newer than the newest `v\d+` marks that runtime
  unhealthy with the reason recorded, reproduced against the real entry this
  incident left on `…d6decbeda`.
- A healthy but paused sprite is **never** marked unreachable across a week of
  sweeps. This is the assertion that matters: a liveness check that cries wolf
  is worse than none, because the next real one is ignored.
- `status` keeps its present meaning and every existing reader behaves as
  before.

## Open

- **Does Fly expose corruption as an event rather than a checkpoint name?**
  The `corrupt-` prefix is the only handle found on 23 September, and a name
  is a weak contract. Ask them whether there is something better, and whether
  they will say what caused it — four sprites in five days is a rate worth
  raising.
- Whether the probe should be `/healthz` through the provider proxy (what
  prewarm does, and what timed out here) or an exec (what `fleet-verify` does,
  and which also timed out here). Both failed on the corrupt host, so either
  detects this case; they may differ on a sprite that is merely slow.
- Whether `status` should eventually absorb the new columns. It should not
  until something has read them for long enough to be trusted.
