# External triggers — deferred, not part of launch

The launch decision on 16 September 2026 is to ship the core Chat, uploads,
approval and connection/browser flows first. External report triggers are parked
here for later. These are source files, not customer data or signing keys.

## What was excluded

- The owner trigger grid, creation/review/key/revocation UI and API client.
- Its locale strings, feature discovery and dedicated tests.
- Worker management/signed-ingress handlers, ingress-specific admission rules,
  notification/report metadata, enablement variables and migration command.
- Migration `051_external_triggers.sql`, moved out of `worker/migrations/` so the
  active migration/test runner cannot apply it. Number 051 remains reserved.

There are no app/Worker imports of this feature, no feature entry point in the
launch bundle and no trigger schema required by launch. Existing routines,
reminders, approvals, uploads, Chat and guided browser/Calendar recovery remain
in the active product. Other concurrent launch work was preserved.

No production migration, trigger deployment, key creation, enablement, sender
setup or live canary was performed. Do not deploy/apply anything in this folder.
The archived implementation is not an independent security audit or a promise
of zero risk/liability.

## Preserved work and restoration

`MANIFEST.json` maps each original path to its parked source and SHA-256. All
12 moved source files were hash-checked against their originals. The current
working-tree integration changes were captured in `integration.patch`; it
contains only the wiring removed for this deferral, not a blanket repo rollback.
`git apply --check future/external-triggers/integration.patch` passes against the
launch working tree immediately after isolation. Other user's edits, including
waitlist/email/launch administration work, were not reverted.

For post-launch development, make a separate feature branch from the then-current
launch revision. Review [the pilot design](../../docs/plans/2026-09-16-external-triggers-pilot.md),
verify the manifest hashes, copy each parked file to its recorded original path,
and review/apply the integration patch. Do not overwrite newer files or reuse
migration 051 without review. Resolve drift/conflicts deliberately, rebuild and
rerun the owner/tenant/security and responsive tests. Restoring source does not
authorise production migration, deployment, enablement or a sender canary.
Deliberately replace the active `launch-boundary.test.ts` exclusion guard when
the feature is approved for the post-launch branch; do not bypass it for launch.

Keep this directory out of the launch commit if a code-only launch commit is
wanted; it is outside all deployed build inputs either way. Nothing here is
committed or pushed automatically. A later, explicitly requested feature commit
can preserve it on a dedicated branch.

On 17 September 2026 the owner requested that all completed work be committed.
Commit `be8eae2` preserves this archive on main together with the launch exclusion
test. This does not restore its wiring or authorise production enablement.

## Launch exclusion verification

After isolation, both typechecks and the production frontend build pass. There
are no trigger feature markers in the built frontend or compiled Worker dry-run
bundle. The active schema directory has no trigger migration. The launch-only
source/schema exclusion guard passes, alongside 100 focused frontend checks and
118 focused Worker checks for recovery, uploads, approvals, Calendar, browser
control, reminders, routines, notification recipients and admission rules.
All eight fictional mobile/desktop EN/BM dark/light browser smoke cases pass
without overflow or console errors. These are automated/fixture checks, not a
live customer-account/provider canary or proof that every real AI request works.
No deployment or live write was performed by this deferral.
