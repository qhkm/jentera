# Automation Playbooks — first release

Dashboard → Library → Playbooks opens a read-only catalog and guided draft flow.
Library is directly available in the mobile bottom bar; Routines is under More.
The three equal-width Library links fit on mobile without horizontal scrolling.
Skills lists bundled instructions and the playbooks that use them. Connectors
is a searchable list of catalog apps plus server-advertised token connectors.
Connect/Manage opens the existing Telegram or selected token setup inline;
opening setup never connects automatically. Unsupported catalog entries have
no connect action. Shared connection rows keep status consistent with My Business.
Library tabs have shareable query-string URLs.
It shows job steps, included skill instructions, connection requirements, business
brief and intended approval boundaries before handing off to the existing routine
editor. The user reviews the schedule and explicitly confirms the write. New
playbooks default to paused, with existing Run now, history and activation controls.
Capability and quota gates still apply; opening the library creates nothing.

The library lives in `app/src/lib/routines/playbooks.ts`. These are execution
templates, not the industry profiles in `app/src/lib/data/playbooks.ts`; that
industry generator and registry are unchanged.

Usable: deterministic daily business brief, agent research brief, draft weekly
content plan. Research and content use the existing computer, confirmed business
context and saved artifacts. They do not require unimplemented account connectors.
Lead follow-up and invoicing are previews only: missing Gmail/CRM/accounting
integrations are explicitly unavailable and cannot be scheduled from the library.

Skills here are instructions bundled into a routine's task prompt, not separately
installed packages. There is no new standalone skill manager or OAuth integration.
Draft-only instructions express intended behavior; server action controls remain
the enforcement boundary. No new permissions are granted by selecting a playbook.
The library currently uses English copy; the existing schedule editor retains its
English/BM localization. Templates are copied on creation, not linked for updates.

Frontend-only release; no migration, runtime bundle or backend deploy required.
