# Routines v1 — proposed frontend/backend contract

Status: **proposed; awaiting backend acknowledgement**. Prepared 9 September 2026.
This document is a handoff, not a claim that scheduling is implemented or live.

## Handoff to Claude

Please confirm or amend this contract before implementing the backend. In
particular, confirm the initial task kinds, admission/missed-run rules, and
capability response. Record acknowledgement and any changes in this document.

The frontend can then implement the Routines screen against the agreed version.
Do not expose the feature as available until tenant isolation, durable scheduling,
pause behaviour and the acceptance tests below pass. No frontend-only timer or
localStorage schedule may stand in for the backend.

**Backend acknowledgement:** acknowledged with amendments 1–12 below (Claude, 2026-09-09).
**Frontend activation:** not enabled.

## Product slice

An owner chooses a repeatable job, reviews its schedule in Malaysia time, and
confirms it. Dashboard shows the next run, latest result and pause/resume controls.
Results open the existing `/app?view=work&run=<uuid>` task details.

Proposed first jobs:

| Task kind | Owner-facing example | Inputs and output |
| --- | --- | --- |
| `business_summary` | Prepare my business summary every morning at 8 | Summarise structured work recorded during the preceding 24 hours. |
| `weekly_summary` | Summarise this week's work every Friday | Summarise structured work recorded during the preceding 7 days. |
| `approval_reminder` | Remind me to review pending actions at 5 | Record an in-workspace reminder from approvals still pending when the job executes. |

V1 results stay **inside Jentera**. A reminder is an Activity result, not a promise
of a push notification, email, or Telegram message. If no approvals are pending,
record a skipped occurrence with reason `nothing_pending`; do not invent a task
completion or send an empty reminder.

These bounded jobs are the proposed first release, not a general workflow builder.
Arbitrary recurring instructions, outbound delivery, customer follow-ups,
payments, nested runtime cron jobs and automatically parsing schedules from Chat
are deferred. A future general-purpose recurring task must pass the same tool,
approval and budget boundaries as interactive work.

## Existing pieces to reuse

- `worker/src/index.ts`: the current scheduled handler performs fleet maintenance
  and recovery. It is not an owner-routine scheduler.
- `worker/src/tenancy.ts` and `worker/src/db.ts`: session-derived tenant identity,
  `withTenant`, and forced RLS. Never accept `businessId` from the browser.
- `worker/src/runs.ts`: structured runs, work records and immutable events.
  `RunKind` already includes `schedule`; that alone is not scheduling support.
- `worker/src/runtime/tasks.ts` and `worker/src/runtime/consumer.ts`: durable
  tasks, leases and outbox/recovery patterns where agent execution is required.
- `worker/src/runtime/usage.ts`: budget admission for any model/runtime work.
- `app/src/routes/views/TaskDetailView.tsx`: reads an exact run independently of
  the latest 50 Activity records. Scheduled results must also be readable here.

Build summaries from tenant-scoped structured data. The frontend Activity feed
is capped at 50 and must not be used as a complete reporting dataset. The server
must query the requested window and state any deliberate truncation in the result.
`occurredAt` is the date a work record was created, not necessarily completion
time; keep that distinction in the report's wording.

Prefer deterministic aggregation for these jobs. If a runtime is used to phrase
the result, reserve and meter usage normally. A scheduled trigger grants no new
tool permissions, external recipients, or access to another business.

## Version and capability discovery

Extend the existing authenticated `GET /api/me` response with this optional field:

```json
{
  "features": {
    "routines": { "apiVersion": 1 }
  }
}
```

Advertise it only when the v1 routes are deployed for the tenant. Missing field
or an unsupported version means the frontend does not display Routines navigation
or call its endpoints. This also keeps the anonymous demo out of scheduling.

`GET /api/routines` returns the server's current permissions and availability:

```json
{
  "ok": true,
  "apiVersion": 1,
  "serverTime": "2026-09-09T03:30:00.000Z",
  "capabilities": {
    "canManage": true,
    "canSchedule": true,
    "canRunNow": true,
    "timeZones": ["Asia/Kuala_Lumpur"],
    "maxRoutines": 10
  },
  "routines": []
}
```

`canManage` is owner-only for v1; other business members may read results.
`canSchedule` gates creation, edits and resuming; `canRunNow` gates manual runs.
When scheduling is temporarily disabled, retain existing routines and allow an
owner to **pause** them if `canManage` is true. The server independently enforces
all permissions and availability on every write and every dispatch.

The limit of 10 non-archived routines per business is a proposed initial bound;
the UI uses the server value. V1 has no archive/delete operation. Pause is the
recoverable way to stop future work; deletion and retention need a later contract.

## Routine representation

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "revision": 1,
  "name": "Morning business summary",
  "task": { "kind": "business_summary" },
  "schedule": {
    "frequency": "weekdays",
    "time": "08:00",
    "timeZone": "Asia/Kuala_Lumpur"
  },
  "delivery": "workspace",
  "status": "active",
  "nextRunAt": "2026-09-10T00:00:00.000Z",
  "lastOccurrence": null,
  "createdAt": "2026-09-09T03:30:00.000Z",
  "updatedAt": "2026-09-09T03:30:00.000Z"
}
```

Rules:

- All IDs are UUIDs. Timestamps are UTC ISO-8601 instants; the UI formats them in
  the routine's named timezone, never the browser's timezone.
- `revision` is a positive integer for owner configuration changes. Scheduler
  status updates do not increment this configuration revision.
- `name`: trimmed, 1–80 characters. Reject blank names and unknown fields.
- `task.kind`: one of the three task kinds above. No client-supplied prompt,
  executable code, model, tool list, customer recipient or policy override.
- `delivery`: exactly `workspace` in v1.
- `schedule.frequency`: `daily`, `weekdays` (Monday–Friday), or `weekly`.
  `weekly` additionally requires `weekday`, an ISO integer 1–7 (Monday–Sunday).
  Reject `weekday` on the other frequencies.
- `schedule.time`: strict 24-hour `HH:mm`, from `00:00` to `23:59`.
- `schedule.timeZone`: exactly `Asia/Kuala_Lumpur` in v1. Preserve the IANA name
  in storage so later timezones do not require replacing the model.
- `status`: `active` or `paused`. No persisted browser-only draft.
- `nextRunAt`: the next intended trigger time, not a promised completion time.
  Compute on the server; it is null while paused or scheduling is unavailable.
- On create/resume/edit, choose the first matching time **strictly after server
  time**. Never run immediately or backfill merely because an owner saved a form.

## API operations

Use credentialed requests and existing request guards. All responses, including
errors, use `Cache-Control: private, no-store`. POST fits the current CORS method
allow-list; do not introduce PATCH just for this feature.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/routines` | None | Capability/list response above. All routines, within the advertised cap. |
| `GET /api/routines/:id` | None | `200 {ok:true,apiVersion:1,routine}`. |
| `POST /api/routines` | `requestId`, `name`, `task`, `schedule`, `delivery`, `enabled` | `201 {ok:true,apiVersion:1,routine}`. No job runs as a side effect of creation. |
| `POST /api/routines/:id/update` | `requestId`, `expectedRevision`, full `name`, `task`, `schedule`, `delivery` | `200 {ok:true,apiVersion:1,routine}`. Preserve active/paused state. |
| `POST /api/routines/:id/state` | `requestId`, `expectedRevision`, `status` | `200 {ok:true,apiVersion:1,routine}`. Pause or resume only. |
| `POST /api/routines/:id/run` | `requestId`, `expectedRevision` | `202 {ok:true,apiVersion:1,occurrence}`. A real, durable manual execution, not a dry run. |
| `GET /api/routines/:id/occurrences?cursor=…&limit=20` | Opaque optional cursor; limit 1–50 | `200 {ok:true,apiVersion:1,occurrences,nextCursor}`. Newest trigger first; stable timestamp+ID pagination. |

`enabled` is required on creation. The UI sends true only after the owner reviews
and explicitly confirms activation. `run` works for a paused routine too, if
allowed; it neither resumes the schedule nor changes `nextRunAt`.

Every POST requires a UUID `requestId` generated once for that user action.
Persist idempotency scoped to tenant + actor + operation + requestId, with a hash
of the canonical request. A replay returns the same resource/occurrence; reusing
the key with a different body returns `409 IDEMPOTENCY_CONFLICT`. Keep request
records for at least 7 days. A browser retry must reuse the same ID, not start a
new action. Once that retention window has passed, refresh and reconcile before
allowing a retry; do not silently replay an old manual execution.

Check replay identity before checking `expectedRevision`, then serialize the
actual update with the routine row. A stale configuration yields
`409 REVISION_CONFLICT`; the UI reloads it for review without overwriting changes.
Replay acknowledgements are not fresh snapshots: re-read the routine afterwards.

Example create request, sent only after review:

```json
{
  "requestId": "22222222-2222-4222-8222-222222222222",
  "name": "Friday review",
  "task": { "kind": "weekly_summary" },
  "schedule": {
    "frequency": "weekly",
    "weekday": 5,
    "time": "17:00",
    "timeZone": "Asia/Kuala_Lumpur"
  },
  "delivery": "workspace",
  "enabled": true
}
```

## Occurrences, results and Activity

An occurrence is one intended invocation, separate from a routine's configuration.
It also represents a skipped invocation that created no agent task.

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "routineId": "11111111-1111-4111-8111-111111111111",
  "routineRevision": 1,
  "trigger": "scheduled",
  "scheduledFor": "2026-09-10T00:00:00.000Z",
  "startedAt": null,
  "finishedAt": null,
  "status": "queued",
  "runId": "44444444-4444-4444-8444-444444444444",
  "summary": null,
  "reason": null
}
```

- `trigger`: `scheduled` or `manual`; a manual occurrence's `scheduledFor` is the
  server acceptance time. Snapshot the confirmed task, schedule and revision for
  audit, without exposing secrets in the public response.
- `status`: `queued`, `working`, `needs_approval`, `completed`, `failed`,
  `cancelled`, or `skipped`. Unknown future statuses must not render as success.
- `runId` is the existing run ID, **not** a runtime task ID. It may be null only
  for a skipped occurrence. Create an admitted run and occurrence atomically.
- `summary`: bounded owner-safe text, at most 500 characters; no raw exception,
  credentials, model reasoning or chain-of-thought.
- `reason`: null or a machine code, initially `nothing_pending`, `missed_window`,
  `previous_run_active`, `budget_exceeded`, `runtime_unavailable` or
  `permission_revoked`. The frontend translates these into plain language.
- `lastOccurrence` on the routine is the most recent occurrence by intended
  trigger time, not the most recent callback to finish.
- Every admitted run appears in Activity, including queued and failed states.
  Record routine/occurrence references with `triggerShape: routine.scheduled` or
  `routine.manual`. Do not attribute a manual run to the original creator.
- The run detail endpoint must return the final readable result for these jobs,
  even if deterministic jobs do not use the Hermes adapter. Currently its
  non-Hermes path can return status without result text; fix that as part of the
  backend slice, not with a guessed frontend result.
- A report states its source window and observation time. Scheduled summaries
  cover `[scheduledFor - 24h/7d, scheduledFor)` by record time; manual summaries
  use acceptance time. Pending approvals are checked at execution time and
  labelled with that observation time, not represented as a historical snapshot.

## Scheduling, pause and failure rules

1. Postgres is authoritative. No owner job is installed into Hermes cron, a
   sprite-local crontab, a browser interval, or a localStorage timer.
2. Use an indexed due-routine query and a bounded, concurrency-safe claim. A
   one-minute dispatcher should be separate from the existing fifteen-minute
   fleet sweep; adding it must not run fleet upgrades every minute.
3. Within one transaction, lock the routine, verify current owner membership,
   availability and policy, insert an occurrence, create its run/task as needed,
   and advance `nextRunAt`. Publish only after commit, using durable outbox/recovery.
4. Enforce a unique scheduled identity `(business_id, routine_id, scheduled_for)`.
   Queue redelivery, dispatcher overlap and restarts reuse that occurrence and
   run. Configuration revision is evidence, not a way to produce two executions
   at the same intended time. Skipped occurrences occupy their scheduled slot.
5. Proposed misfire policy: at most one due occurrence per routine per scan,
   only if it is no more than 10 minutes late. Older missed slots are skipped;
   advance to the next future trigger without flooding the queue. Record a bounded
   skipped-range audit event rather than inserting years of missed occurrences.
6. Do not overlap a routine's queued/running/approval-waiting occurrence with a
   second one. A scheduled collision becomes `skipped/previous_run_active`;
   a manual collision returns `409 RUN_ALREADY_ACTIVE` with its existing run ID.
   Different routines still respect the existing per-business execution limit;
   interactive work must not be starved by scheduled work.
7. Pause and dispatcher admission must serialize on the same routine row.
   Pause prevents future admissions; work already admitted may finish, including
   queued work or work awaiting approval. Copy must say this explicitly. Stopping
   an existing run is a separate cancellation operation, not an implied pause.
8. Resume does not catch up missed work or run now. Edits affect future admissions;
   already admitted occurrences retain their configuration snapshot. Do not
   supersede exact pending approvals with a later routine edit.
9. Use current permissions, available connections and budget at dispatch and at
   each effect. If the routine creator loses owner membership, pause the routine
   and record `permission_revoked`; do not continue under that former authority.
   An authorised owner must explicitly resume it, becoming the authorising owner.
10. Retry transient execution failures only within the existing bounded task
    machinery and the same occurrence. Never invent successful completion after
    budget denial, unavailable runtime or delivery ambiguity. Irreversible effects
    require existing effect-level idempotency/approval, not just a unique run row.

## Errors and safety

Use `{ok:false,apiVersion:1,code,err}` with an owner-safe `err` and optional
`fieldErrors` for invalid forms. Never include secrets or unfiltered provider errors.
Existing pre-route guards may return an unversioned error; the frontend must still
handle that as a failure, not as an unsupported feature or an empty list.

| HTTP | Codes / behaviour |
| --- | --- |
| 400 | `INVALID_ROUTINE`, `INVALID_SCHEDULE`, `INVALID_REQUEST_ID`; reject unsupported fields and task kinds. |
| 401 | Session expired/missing; existing sign-in recovery. |
| 403 | `OWNER_REQUIRED`, `ROUTINES_DISABLED`; permissions are server enforced. |
| 404 | `ROUTINE_NOT_FOUND`; identical for nonexistent and another tenant's routine/occurrence. Existing `NO_BUSINESS` handling stays intact. |
| 409 | `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `RUN_ALREADY_ACTIVE`, `ROUTINE_LIMIT`; reconcile instead of silently retrying. |
| 429 | Rate/budget admission refusal, with safe code and `Retry-After` where meaningful. |
| 503 | `RUNTIME_UNAVAILABLE` or transient service failure; never treat it as an empty list. If a write may have committed, reconcile/retry using the same request ID. |

Apply forced RLS to new tenant tables and test as `aisar_app`. Occurrence and
routine foreign keys must preserve tenant ownership, not merely match UUIDs.
Any fleet-wide due scan needs a narrowly scoped database function; do not expose
arbitrary cross-tenant reads or use unrestricted owner credentials from routes.
Use existing origin/request-size/rate guards and audit configuration mutations.
For new mutation routes, explicitly enforce the allowed Origin and JSON content
type; CORS response headers alone are not write authorisation. Extend paid-run
admission to routine run-now endpoints where they can invoke a model; the current
request classifier only recognises Ask and ingestion. Scheduled dispatch has no
browser request, so it needs its own tenant-based admission in addition to durable
budget checks.

## Frontend handoff

- Add Routines to Dashboard only after v1 capability discovery succeeds. Keep
  Chat and Dashboard as separate modes; retain the existing theme and body size.
- Three starter choices correspond to the supported task kinds. The form asks
  for a name, frequency and time; weekly schedules also ask for a day.
- Before activation, show a plain-language review: “Every Friday at 5pm,
  Malaysia time. Result saved in Jentera.” “Run once” has a separate confirmation
  stating it performs real work and does not enable the schedule.
- In-flight writes disable duplicate submissions and preserve their request ID.
  Do not optimistically claim “Active”, “Paused” or “Run started”. Reconcile
  ambiguous failures before offering a fresh execution.
- Display `nextRunAt` and occurrence state from the server. Paused means no next
  trigger, not proof that previously admitted work stopped. Show skipped jobs
  honestly, with their reason; link actual run IDs to the existing task page.
- In a later Chat entry point, pass only an editable draft through in-memory
  navigation state. Do not put private chat text into URLs or create a routine
  merely because a message contains “every morning”. Explicit review still applies.
- Preserve loading/error/empty/permission-denied states, EN/BM translations,
  keyboard focus, mobile layout and reduced motion. No demo schedules for a
  signed-in account and no enabled controls against an unsupported endpoint.

## Backend acceptance gate

- [ ] Contract acknowledged or amended, with revision/date recorded here.
- [ ] List/read and every mutation tested with two tenants as `aisar_app`.
- [ ] Members can read but cannot create, edit, pause/resume or run once.
- [ ] All schedule validation cases pass: strict time, ISO weekday, named timezone,
      midnight, same-minute save, Friday→Monday weekdays, week/month/year boundaries.
- [ ] Server-computed next trigger is correct when the browser is in another timezone.
- [ ] Lost responses and repeated request IDs cannot create duplicate routines or runs.
- [ ] Changed payload with reused request ID and stale revisions return conflicts.
- [ ] Two concurrent dispatchers and queue redelivery create one scheduled occurrence.
- [ ] Database commit followed by queue publish failure recovers without a new run.
- [ ] Pause-vs-dispatch, edit-vs-dispatch, resume, manual-vs-scheduled and approval-wait
      races follow the rules above. Already admitted work is not falsely cancelled.
- [ ] Missed windows, long outages, budget denial, revocation and unavailable runtime
      are bounded, visible and never reported as completed work.
- [ ] Reports query the server-side window correctly with more than 50 work records.
- [ ] Scheduled deterministic results and agent results both open in task details.
- [ ] Reminder with no pending approvals skips without a fabricated completion.
- [ ] Configuration and occurrence audit preserve actor, revision, inputs and outcome;
      no reasoning/transcript persistence or raw credentials in responses/logs.
- [ ] Canary one internal business before advertising v1 to other tenants.
- [ ] Rollback hides creation/run-now capability, stops new admissions, preserves
      history and leaves an owner able to pause existing routines.

## Delivery order

1. Backend owner confirms this contract and resolves any changes to the defaults.
2. Implement migration, tenant-scoped API, dispatcher and tests behind capability gating.
3. Implement the frontend against the acknowledged contract using test responses;
   keep production navigation gated until the backend acceptance gate is green.
4. Verify the integrated loop with an authorised internal canary business. Deploy
   frontend and backend separately; a Pages deployment does not release a scheduler.

No scheduling, runtime, production-data or UI changes are made by this document.

## Backend acknowledgement (Claude, 2026-09-09)

Confirmed as written: the three task kinds; workspace-only delivery; the
routine and occurrence representations; the unique scheduled identity
`(business_id, routine_id, scheduled_for)`; the misfire policy (one due
occurrence per scan, at most 10 minutes late, older slots skipped with one
audit event); the overlap, pause, resume, edit and `permission_revoked`
rules; the error table; capability discovery through `GET /api/me` and
`GET /api/routines`; POST-only mutations; UTC instants with the IANA zone
stored; Postgres as the only scheduler; forced RLS on every new table, tested
as `aisar_app` with two tenants. Each item below either changes a default or
pins an implementation choice the contract left open. The frontend can build
against the contract as amended here.

1. **Dispatcher.** A second cron, `* * * * *`, added to `worker/wrangler.toml`;
   `scheduled` branches on `controller.cron` so the fifteen-minute fleet
   sweep is untouched. The due scan is a `SECURITY DEFINER` function
   (`routine_due_targets(now, limit)`, precedent `runtime_drift_targets` in
   migrations 018/019) that returns `(business_id, routine_id,
   scheduled_for)` and nothing else; the claim happens per business inside
   `withTenant`, `select … for update skip locked` on the routine row.
2. **V1 jobs are deterministic. No model, no sprite, no budget
   reservation.** `business_summary` and `weekly_summary` aggregate
   `work_record` over the window in SQL and render fixed-format text in the
   business's language; `approval_reminder` counts `approval.status =
   'pending'` at execution time. The run row uses `kind = 'schedule'`,
   `runtime = 'deterministic'`, `triggerShape = 'routine.scheduled' |
   'routine.manual'`, and completes in the same transaction that admits it.
   So in v1 an occurrence goes `queued → completed | failed | skipped`;
   `working` and `needs_approval` stay in the vocabulary for a later
   agent-backed kind. Phrasing by a model, when wanted, goes through the
   existing reserve-and-meter path and the five-dollar cap; nothing in the
   contract changes for it. This removes `runtime_unavailable` and sprite
   wake from v1 entirely and keeps scheduled work off the interactive lane.
3. **Run detail.** `GET /api/runs/:id` currently derives `text` from the
   runtime task's result and would return a completed run with no text for
   a deterministic job. Amend it to fall back to the run's work record
   outcome when there is no runtime task. Same field, so the task page needs
   no change. Part of the backend slice.
4. **Idempotency without a generic table.** The `requestId` is stored on the
   row the request created: `routine.create_request_id`,
   `routine_occurrence.request_id` (run-now), and a `routine_change` audit
   row for update and state changes, each unique per business and carrying
   the canonical request hash. Replay returns the row; same id with a
   different hash returns `409 IDEMPOTENCY_CONFLICT`. Retention is the row's
   lifetime, which exceeds seven days since v1 never deletes. Create and
   run-now serialise on `pg_advisory_xact_lock(hashtextextended(key, 0))`,
   the pattern `startDurableAsk` already uses.
5. **Concurrency.** There is no per-business execution limit in the control
   plane today: the runner executes one task per sprite and the consumer
   requeues `busy`. Because v1 jobs never reach the sprite, scheduled work
   cannot starve interactive work. Rule 6's per-routine overlap check still
   applies at the occurrence level.
6. **Gating.** `ROUTINES_ENABLED` plus an `AISAR_ROUTINES_BUSINESS_IDS`
   allowlist for the canary, following `AISAR_QUICK_MODEL_OVERRIDES`.
   `features.routines` appears on `/api/me` only when both pass for that
   tenant. With the flag off, existing routines remain readable and
   pausable and `canSchedule` is false.
7. **Occurrence statuses** are exactly `RunStatus` (`queued`, `working`,
   `needs_approval`, `completed`, `failed`, `cancelled`) plus `skipped`.
   There is no `stopped`.
8. **Reports** query `work_record.occurred_at` over `[scheduledFor − 24h or
   7d, scheduledFor)`, state the window and the total count, and truncate
   only the rendered list (at most 40 lines, then "and N more"); counts are
   never truncated. The Activity feed's cap of 50 is not involved.
9. **Admission.** `request-guard.ts` treats `/api/runs/ask` and
   `/api/runs/ingest` as paid runs. Run-now joins that list only when a task
   kind can invoke a model; none can in v1, so it is guarded as an ordinary
   mutation: session, exact Origin, JSON content type, request size.
10. **Migration** `022_routines.sql`: `routine`, `routine_occurrence`,
    `routine_change`, RLS enabled and forced, grants to `aisar_app`, the due
    scan function, an index on `(status, next_run_at)`. Additive, with an
    apply script under `db:migrate:routines`, per the house convention.
11. **Time zone.** Asia/Kuala_Lumpur is UTC+8 without DST, but `nextRunAt`
    is still computed through `Intl.DateTimeFormat` parts in the routine's
    named zone (Workers ships full ICU), so a second zone later is a list
    entry, not a rewrite.
12. **Tests** live in `worker/test/routines.test.ts` on the existing harness:
    arrange as owner, assert as `aisar_app`, two tenants; the dispatcher is
    driven by calling `scheduled` with an injected clock. The acceptance
    gate above is the test list.

Deployment is a worker deploy plus migration 022; no runtime release, no
sprite change. Frontend activation stays off until the gate is green and one
internal business has run a real schedule.
