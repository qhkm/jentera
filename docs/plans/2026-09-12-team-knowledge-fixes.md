# Team and knowledge review fixes

Implemented locally, 12 September 2026. Not deployed.

## Behaviour

- `knowledge.manage` permits owners to import, edit, confirm, and forget business
  facts. Staff may read knowledge; the screen hides mutation and agent-memory
  controls. The API enforces the same permission independently of the screen.
- Migration 039 adds a separate pending slot to `business_fact`. An unconfirmed
  replacement preserves the confirmed live row. The review snapshot shows the
  proposal and current value; agent retrieval continues reading the live value.
  Accepting the displayed version promotes it atomically. Discarding that version
  preserves the current value. History remains available. New unconfirmed keys
  still use the existing live-but-unconfirmed state and are excluded from agent
  retrieval. Fact writes serialize per tenant/key; multi-key imports lock in a
  stable order. Batch confirmation refuses pending replacements.
- Home, readiness, profile details, and chat knowledge counts continue to use
  confirmed knowledge when a replacement is pending. The anonymous repository
  supports the same proposal behaviour with its existing storage key.
- Owner notifications open `/app?view=work&review=<runId>`. The new owner-only
  `/api/runs/:id/review-summary` returns the shared work record and approval ID.
  It never returns the private answer, chat ID, artifacts, or trace. The review
  screen labels this as a summary and asks the owner to obtain any missing result
  from their colleague before deciding. Existing review/approval endpoints record
  decisions. Inbox clicks also route older team notifications to the summary.
  Approval-only requests remain accessible before the first work record exists;
  that response exposes the approval ID and status, not the private question.
- Memory deletions serialize per file and reserve the runtime admission slot
  before checking for active work. A competing task or deletion receives busy;
  the UI prevents repeated submissions while a deletion is pending.

The two runtime-assessor failures were stale tests: work classification requires
intent evidence, and classifier uncertainty is retained in the audit while kept
out of work counts. Tests now verify those rules; classification code is unchanged.

## Verification

Regression tests cover staff API/UI restrictions, imported replacements,
version-specific acceptance/discard, confirmed retrieval, owner review privacy and
decisions, concurrent memory deletion, and deletion during task admission.
Frontend tests and production build, backend typechecks and focused integration
tests, and runner memory/server tests were exercised. A runner test with a very
short wall-clock deadline failed under simultaneous suite load and passed when
rerun separately; no production deadline behaviour was changed.

Desktop and 390px mobile Chrome smoke checks use a mocked API: `/`, `/onboard`,
`/setup`, `/app`, Knowledge, staff read-only controls, proposal discard, and owner
review. No browser errors or horizontal overflow were observed. These are local
checks, not verification of the production deployment.

## Release order

1. Run `pnpm db:migrate:fact-proposals` from `worker/` with the existing verified
   production owner connection procedure. The script verifies the column, unique
   pending index, and forced RLS. It changes no existing fact values.
2. Ship the runner through `worker/scripts/ship-runtime.sh` and the normal fleet
   release process; do not patch individual sprites. The Worker must have migration
   039 before its new fact queries run.
3. Publish the app intentionally using the normal deployment process. No changes
   to `_headers` or storage key names are required.

Keep the additive migration on rollback. An older Worker does not understand
pending replacements; suspend imports if rolling back rather than letting it
retire confirmed values again. Previously displaced historical values are not
automatically reinstated: that requires owner review.

Shared agent memory across people and document extraction without retaining the
source file remain the existing documented product limitations.
