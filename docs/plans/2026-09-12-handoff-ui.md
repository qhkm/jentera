# Visible specialist assignments and delegation

Implemented locally. Not deployed.

Chat replies and task details include a compact, expandable “Who’s working on
this” section. English and BM copy distinguish the selected specialist from an
actual delegation. Active tasks refresh every five seconds; settled tasks load
once. Failures offer retry and unmounting stops refreshes.

`GET /api/runs/:id/coordination` uses the existing run visibility check and tenant
RLS. It returns only the assignment and bounded delegation lifecycle events.
Colleagues cannot read private-chat coordination, including through shared owner
review summaries. Raw tool arguments, instructions, and private results are not
returned. The last 50 events are returned in chronological order.

New tasks retain the specialist's display name alongside the internal profile
key. Older tasks resolve their profile against the current role definition; a
removed role falls back to “Specialist.” Tasks without a runtime assignment do
not gain an invented role.

The existing runner stream already reports `delegate_task` start/completion and
sequence numbers. The consumer records `agent.delegation` events in `run_event`,
deduplicated by task and stream sequence. No model narration is treated as proof.
No migration or runner bundle change is required. Old runs have no retrospective
delegation events; missing events must not be interpreted as proof none occurred.

Limit: the runner does not identify destination roles or individual child tasks.
The UI therefore says “Specialist assistance requested,” “Delegation returned to
the lead role,” or “Delegation reported an error.” It does not invent named
role-to-role transfers, match concurrent child calls, or claim that a tool return
means the business task succeeded. Named child handoffs need a further runtime
contract with child IDs and verified role metadata.

The prompt still asks for one coherent Jentera answer. Structured UI activity is
separate from the answer; no prompt change asks the model to narrate handoffs.

Release: deploy the Worker before the frontend through the normal release
procedure. No changes to storage keys or cache headers. The published homepage
screenshots remain fictional illustrations; their capture fixture explicitly
omits coordination until a separate screenshot refresh is requested.

Verification: 488 frontend tests (68 files) pass; 45 focused backend tests pass,
including real consumer stream-to-event persistence, deduplication, and private
chat/cross-tenant denial. Backend typechecks and frontend production build pass.
Mocked-API Chrome checks at 1440px and 390px verified keyboard disclosure, live
refresh, shared-review exclusion, and no JavaScript errors or horizontal overflow.
