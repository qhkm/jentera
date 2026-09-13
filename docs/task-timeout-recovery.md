# Reply timeout and recovery checks

The September 13 incident combined model HTTP 524 retries with a worker that
did not treat the runner's `expired` state as terminal. The chat's no-step
indicator continued to label the wait as thinking.

## Recovery rules

- `expired` is terminal, like completed/failed/cancelled/stopped. Finalize the
  run as failed, release its lease, and wake the next queued task.
- A durable terminal outcome is sufficient for final delivery. Do not wake or
  start the computer again just to deliver a saved result.
- A persisted expiry without a full result still proves execution ended. It
  can finalize offline; missing usage is unknown, not invented as zero.
- A lost progress stream is not an execution failure. Check saved runner status
  before retrying. Never generate a replacement task id for transport recovery.
- Duplicate delivery of an already finalized task does not call the runner.
- Missing progress for 60 seconds changes the borderless UI to waiting, not
  failed. Only the backend can determine task completion/failure. Approval
  waits remain separate and never become automatic approval or retry.
- The model proxy aborts after 60 seconds without response bytes, including
  after headers arrive. Real bytes reset inactivity, not the five-minute
  absolute per-call ceiling. Caller cancellation closes the upstream without
  waiting for it to acknowledge. Timers are cleaned up on every terminal path.
  Agent retries still exist; a whole task is not promised to finish in 60 seconds.
- HTTP errors, connection failures, broken bodies/streams and cancellation
  each record one bounded diagnostic. Transport errors use status 502 and
  downstream cancellation uses 499; these are synthetic statuses, not claims
  that the upstream returned that HTTP code. Unknown usage stays null.
- A stop must return an explicit terminal state. A 200 with `running`,
  `expiring`, or no status is not confirmation. Stop retries are bounded;
  exhaustion leaves cancellation unconfirmed and usage unresolved, while the
  chat displays a failure warning that the work may still be running.

## Regression coverage

`runtime-consumer.test.ts` covers expiry, stream loss at expiry, offline saved
expiry, FIFO release, duplicate delivery, dead-owner recovery, stale/busy
siblings, failed cancellation, and final-message delivery retries.
`runtime-task.test.ts` covers lease ownership, recovery, and deduplication.
`model-fetch.test.ts` covers silent connection abort and healthy response
continuation; `model-proxy.test.ts` checks the proxy uses this deadline.
`AskReply.test.tsx` and `LiveTaskProgress.test.tsx` cover no-step silence,
reconnection, preserved partial text, and recovery on fresh progress.

These checks prevent the reproduced stuck-state paths; they are not a claim
that every external outage or possible concurrency bug has been eliminated.
