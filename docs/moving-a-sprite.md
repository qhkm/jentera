# Moving and retiring a sprite

Written 21 September 2026, from the day it was done badly enough to learn
from. `worker/scripts/move-runtime-region.mjs` is the procedure below as code;
this is why each step is there.

Fly places a sprite near whoever created it and offers no way to move one, so
"moving" a sprite means deleting it and provisioning a replacement. The
replacement keeps the same name, because the name is a hash of the business id.
What follows applies to any reason for replacing a sprite, not only region.

## The procedure

1. **Survey.** A sprite cannot say where it is; our own edge can, on any call
   the sprite makes with its own credential. `--all --survey` has each one call
   the config channel so `recordEgress` stores what `request.cf` saw.
2. **Check it can come back.** See *the one-way door* below. This is the step
   that did not exist, and it cost a sprite.
3. **Back up, and verify the archive rather than trusting it.** Compare the
   digest the sprite reported against the bytes that arrived, and check every
   entry against an allowlist — refusing the archive, not filtering it.
4. **Enqueue the delete. Wait for the quarter-hour tick.**
5. **Enqueue the provision. Wait for the next one.**
6. **Restore, then checkpoint.** A restore that is not checkpointed is not a
   restore.
7. **Confirm by reading the sprite**, not by believing the step that just ran.

## The one-way door

While `ACCESS_MODE` is `waitlist`, `businessHasAccess` (`worker/src/access.ts`)
admits only businesses whose verified owner holds an active `platform_access`
grant, or whose owner is `ACCESS_OWNER`. Three task kinds are exempt because
housekeeping must work on any machine — `upgrade`, `reconcile`, `delete`
(`MAINTENANCE_TASK_KINDS`, `worker/src/runtime/consumer.ts:147`).

**`provision` is not exempt.** So for a business without a grant, the delete
succeeds and the replacement is refused. There is no undo.

Worse, the refusal is quiet. The consumer acks the dropped message and leaves
the row `queued`, so the symptom is a task that never dispatches — which looks
exactly like a slow queue. The one signal is a log line:
`[runtime-access] task dropped, business is not admitted`.

**Never delete a sprite without first asking whether its business may
provision one.** In `move-runtime-region.mjs` this is the single refusal
`--force` cannot override: overriding a reversible refusal is a judgement
call, and overriding a one-way door is not.

If the business cannot provision, the honest operation is `--retire`: back up
and delete, and do not pretend a replacement is coming. That is the right
answer for a business that cannot run work anyway — the model proxy applies
the same access rule, so its sprite is cost with nothing behind it.

## The clock

A queued runtime task waits for the **quarter-hour** cron, not the minute one.
`worker/src/index.ts:254` takes the minute branch for routines, spares and push
and returns before reaching `drainRuntimeTaskOutbox`. So every move pays that
wait twice, once for the delete and once for the provision.

Two things follow. Any wait shorter than that reports a failure that is only a
clock. And a batch should move a phase at a time rather than a sprite at a
time: twelve sequential moves pay the wait twenty-four times, while twelve
enqueued together ride two ticks between them. The cost of the phase-wise shape
is that every business in the cohort is without a runtime for the same window,
so the size of the cohort is a decision, not a default.

## Durability

A sprite that pauses comes back from its last snapshot. A file written between
snapshots is not on the machine that wakes up.

Kitakod's memory was restored at 08:45, the sprite woke at 08:48 from a
snapshot dated 08:33, and the files were gone. The restore had reported success
and was telling the truth: at the moment it counted them, eight memory files
were there.

So a restore takes a checkpoint and fails if none was made. And a verification
that matters reads the sprite after the fact, rather than trusting the step
that just claimed to have done the work.

Note that the control plane's `latest_checkpoint_id` is not updated by a
checkpoint made from the CLI, so after a hand-run restore its recorded rollback
point is older than the newest checkpoint until the next release.

## What moves, and what must not

Moving is an allowlist: the agent's own memory and conversation history
(`memories/*.md`, `sessions/`, per-profile `memories`, `sessions`, `state.db*`).

Nothing a fresh sprite mints for itself moves — `auth.json`, every `.env`,
`config.yaml`, the runner and model keys. Carrying those forward would put
revoked credentials on a new machine.

The business browser profile does not move either. It holds live logged-in
sessions, and `sprite file pull` moves bytes through the operator's laptop,
which is not where another business's cookies belong. Owners sign in again.
The connectors themselves are unaffected: a Bukku token is a sealed row in
Postgres, not a browser session.

## What went wrong on 21 September

| What | What it cost | The rule now |
|---|---|---|
| Preflight checked ready, idle and unbusy, never *can this be rebuilt* | "My business" lost its sprite; nine more were queued to follow | Access is checked first, and `--force` cannot override it |
| Read a dropped task as a slow queue | Twenty minutes, and the wrong diagnosis reported twice | `queued` + `attempt=0` + `not_dispatched` across a tick means dropped, not slow — go and read the log line |
| Hand-wrote an outbox insert | The whole move rolled back on `idx_runtime_task_outbox_one_pending` | `runtime_task_queue_wake` already writes it; assert the trigger's row instead |
| Bound a JS array into `any(...)` | Crashed after every backup was taken and every delete sent, so a lost progress bar looked like a lost batch | `fetch_types: false` has no array OIDs; bind a quoted array literal, as `offboard-accounts.mjs` has documented all along |
| Chose a 15-minute timeout without knowing the cadence | Would have reported failure seconds before the wake it waited for | Know the clock before you wait on it |
| Called a restore done because the files were there | Kitakod's memory was lost and had to be restored again | Checkpoint, then read it back |
| Designed the batch sprite-at-a-time | Would have taken four to seven hours | Phase-wise, once the clock was understood |
| Piped a long background run through `tail` | No progress was visible until the command ended | Redirect to a file and read it |
| Attributed a query to a business id taken from stale dedupe keys | Concluded "no tasks exist" while looking at the wrong business | Resolve the id from the row in front of you |
| Asked *where* the sprites were, not *when* they were made | A morning spent concluding placement was not ours to control, when it had been fixed by accident eleven days earlier | When a property splits a population, check whether the split is a date |

The first row is the one that matters. Everything else cost time; that one
destroyed something. It was caught because the sprite it destroyed was the
quietest one in the cohort — the rehearsal was on a business with zero runs,
and the nine behind it were still intact when the failure surfaced.

**Rehearse on the least important instance, and treat the rehearsal as a
question rather than a formality.**
