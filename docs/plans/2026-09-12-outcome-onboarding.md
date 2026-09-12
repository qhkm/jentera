# Outcome-led onboarding

Implemented locally; not deployed.

## Experience

The real, signed-in account flow now has three moments:

1. Provide a public page (optionally a second), upload a document, or describe the business.
2. Review actual, source-labelled findings; correct values and select which to confirm.
3. Choose a first useful job, edit its brief, explicitly create the draft, and open its real task/result.

The anonymous demo remains a separate preview. On sign-in, saved inputs survive,
but its completed-demo flag cannot skip real source reading. Previously recorded
unconfirmed findings can be reviewed without reimporting. No fake scan animation,
playbook-derived facts, percentages, or invented extraction results in the real flow.

The first-job choices include a content plan, enquiry reply, and delivery checklist.
Confirmed workshop/training context selects a workshop follow-up instead of the
generic enquiry reply. These are starting points, not claims of model-generated
recommendations. The owner can edit the brief before submission.

## Safety and reliability

- Empty extractions stay at source input with an actionable warning.
- Independent sources can partially succeed; failures stay visible alongside findings.
- Pages with fewer than 120 readable characters fail before a model call, with
  public-page/document/manual alternatives. This is a heuristic, not proof that a
  longer page is useful. The importer still does not crawl a whole website or render
  JavaScript; the UI states this boundary.
- Unticked findings remain unconfirmed in Knowledge. Corrections are saved as owner
  edits; selected findings are confirmed before completing onboarding.
- Computer provisioning starts only after the explicit confirmation/activation CTA,
  through the existing durable onboarding endpoint. Not before owner consent.
- First-job submission remains disabled until a successful readiness observation on
  the target release. Choosing a suggestion never executes it.
- First-job briefs request an editable Markdown draft, prohibit external action, and
  retain existing runtime policy/approval enforcement. They use the normal durable
  task API, not a new execution path.
- Explicit retries of the same first-job brief reuse a request ID. Accepted runs are
  opened in the existing task detail/result UI; no automatic resubmission on reload.

## State and release

Existing `aisar-onboarding-draft-v1` is retained for source inputs, including both
website and secondary source. The real flow ignores its old presentation step and
completedDemo flag; no new storage key or schema migration. File bytes are not saved
in browser drafts. Runtime fleet/pins and authentication rules are unchanged.

Deploy worker before frontend for the thin-page error message. No runtime bundle
release is needed. Both `/onboard` and `/setup` change; `/app` uses the existing result
surface. Anonymous preview remains unchanged.

## Verification

- 517 frontend tests pass; frontend typechecks and production build pass.
- Full backend suite: 770 tests passed after the ingestion change. The added
  thin-page regression and existing ingestion tests (25) also pass; worker typechecks pass.
- Mocked-API Chrome at 390px and 1440px: source → findings → confirmation → first-job
  selection → explicit submission → actual task-result view. Exactly one ask; no
  JavaScript errors. No production accounts, imports, compute or model calls used.
- Screenshots: `/tmp/new-onboard-source-{390,1440}.png`,
  `/tmp/new-onboard-review-{390,1440}.png`, `/tmp/new-onboard-job-{390,1440}.png`.
  Review labels/focus were subsequently improved from dotted keys to readable labels.

The new runtime first-job path is covered with mocked execution; an authenticated
production smoke job has not been run. This change does not alter specialist routing.
