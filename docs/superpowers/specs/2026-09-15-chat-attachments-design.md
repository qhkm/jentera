# Attachments in chat

Status: design, 15 September 2026, revised the same day after review. No code,
no migrations, no deployment. Retention was decided with the owner; the
mechanism was established by probing the live stack, and both the first draft
and the probes' first reading were wrong in ways recorded below, because the
same mistakes are available to whoever implements this.

Someone attaches a file in the composer and asks Jentera to do something with
it — read this invoice, summarise this contract, pull the totals out of this
spreadsheet. Today there is no way to give the agent a file at all.

## What exists, and does not

Upload exists in exactly two places: the Knowledge tab
(`app/src/routes/views/KnowledgePanel.tsx:285`) and onboarding
(`app/src/routes/BusinessOnboarding.tsx:63`). Both post to
`POST /api/runs/ingest/file`, which reads the bytes, extracts facts, and
**discards the file**. The composer has no control, and `/api/runs/ask` has no
attachment parameter, so there is nothing behind a button to add.

Telegram is worse than empty: `parseUpdate`
(`worker/src/connectors/telegram.ts:635`) requires a non-empty `msg.text`, and a
photo carries `photo` and an optional `caption` and no `text`. The update is
dropped with a deliberate 200 (`routes/connect.ts:388-394, 442`). Someone
photographing a receipt to their Jentera bot gets silence. That is live today.

## How the agent can actually be given a file

DeepSeek V4.1-Flash is multimodal (announced 10 September 2026, and
`AISAR_MODEL_NAME` is already `deepseek-flash`, `worker/wrangler.toml:112`), so
the obvious design was to send images as OpenAI-style `image_url` content
blocks. That design is wrong, and it fails silently.

| Delivery | Result |
| --- | --- |
| `image_url` block to the worker's model proxy, direct | **"Green"** — correct |
| `image_url` block to Hermes `/v1/runs` | 202, completes, answers **"Lavender"**, **"Rose"** |
| `image_url` block to Hermes `/v1/chat/completions` | 202, answers **"White"** |
| File on disk, absolute path named in the text | **"Green."** — correct |

Same solid-green 64×64 PNG every time. Hermes accepts the block, returns 202,
completes the run, and answers **confidently and wrongly**: it never receives
the pixels and invents a plausible colour. Nothing errors. At the pinned Hermes
commit this is visible in the source — `_normalize_chat_content` silently skips
`image_url` parts, and `/v1/runs` history flattening keeps only `text`.

**Two corrections to the first reading of those probes, both load-bearing.**

1. **No parser is involved.** The first draft said `extract_image_refs` in
   `agent/image_routing.py` picks the path out of the text. Nothing calls that
   function — at the pin or on main, the only references are its definition and
   its tests. The probe worked because the model *chose* to call the
   `vision_analyze` tool on a path it saw. The mechanism is model discretion
   plus tool availability, not parsing, and a design must be built to expect a
   turn where the model simply does not look.
2. **`model.supports_vision` is not set by the bundle.** It is set on the sprite
   that was probed and nowhere in this repository — `configure-model-provider.py`
   pins `auxiliary.vision` and never touches it. So it was applied by hand,
   which CLAUDE.md forbids precisely because the next re-bootstrap erases it and
   because it is then true on one sprite out of thirteen. **The probe does not
   generalise.** Before anything is built: confirm the setting across the fleet,
   then pin it deliberately in `configure-model-provider.py` or decide against
   it — it is not a detail, because it decides whether the main model sees
   pixels at all.

That flag also changes what "the model sees" means. With it true,
`vision_analyze` has a native fast path returning the image as a multimodal
tool result. With it unset, the agent's question goes to the auxiliary vision
backend — which is `deepseek-flash` through the same proxy, so the pixels *are*
seen, by a second call, with whatever question the agent chose to ask. The lossy
step is the agent's question, not a blind summary. The first draft got this
backwards.

**Either way, attachments are delivered as files the agent can open**, not as
content in a model request.

## The shape

**Storage.** An `attachment` row under forced RLS, bytes in R2 (`ARTIFACTS`,
bucket `jentera-artifacts`), keyed `<business>/attachments/<id>/<name>` so the
tenant prefix makes account deletion a prefix delete, following `artifactKey`
(`worker/src/artifacts.ts:68-70`). Note the bucket's location is **APAC**, not
Singapore specifically; anything the privacy notice says about residency must
match that.

**Two states, because upload precedes the ask.** A row is `staged` (uploaded,
no run yet) or `attached` (named by an ask). This matters more than it looks:
`visibleRunPredicate` needs a run joined to a chat session
(`worker/src/chat-sessions.ts:60-68`), and a staged row has neither. So staged
rows are visible to `uploaded_by` alone, and only once attached does the
existing rule take over. The first draft's "visibility is not a new rule" was
false for exactly that window.

**Attachments outlive one run.** A file referred to in a later turn belongs to
two runs, so the link is a junction — `run_attachment(run_id, attachment_id)` —
not a column. Without it, "the invoice I sent you yesterday" cannot work.

**Re-attachment is checked per id, every time.** Staged: the asker must be the
uploader. Attached: `runVisibleTo` on the run it came from. An id is not a
bearer credential — otherwise a member who once saw a workspace chat, or who
has since been removed from it, can carry a file into a private chat.

**Upload is its own route,** `POST /api/attachments`: bytes in, id out. The ask
carries `attachmentIds`. Not multipart on `/api/runs/ask`, because that route
runs the first slice inline on the reply-latency path and a failed upload must
not lose a typed message.

**Staged rows expire after 24 hours,** swept by the existing cron. Every
abandoned composer, closed tab, and ask refused with 400/402/403/429 leaves a
billed R2 object that the Files tab — listed by run — never shows. The
mini-apps plan already prescribes this policy; attached rows are never swept.

## Limits, and where they are actually enforced

Three caps sit in front of this route and the first draft named none of them.

| Cap | Where | Value |
| --- | --- | --- |
| Pre-route body guard | `worker/src/request-guard.ts:8-25` | 128 KiB unless the path is exempt |
| Model proxy image body | `worker/src/routes/model.ts:52` | 8 MiB, and base64 inflates 4/3 |
| Runner total per task | `runner/src/server.mjs:2513` | 60 MB |

So: `POST /api/attachments` needs its own arm in `bodyCapFor`, or it is
refused at 128 KiB — the identical bug that made `ingest/file` unreachable
until it was fixed on 14 September. A file the agent will *look at* is capped
near 6 MB by the proxy once base64 is counted, which is smaller than a modern
phone photo, so the resize path must be exercised with a real 3–8 MB
photograph rather than a 1 KB test pattern. And the per-run total is **60 MB**,
matching the runner's own outputs cap, not 20 × 20 MB.

## Delivery to the sprite

The runner already uploads finished files to `POST /v1/runtime/artifacts` with
its runtime credential. This is the mirror: `GET /v1/runtime/attachments/:id`
into `/home/sprite/aisar/inputs/<task>/`, beside the outputs folder the runner
already creates and already names in an appended instruction
(`server.mjs:2538`).

**The fetch is task-bound, not business-bound.** The credential lives in
`hermes.env` on a machine where the agent has `terminal` and `process`, so a
route that serves any attachment of the business lets any process there — or an
instruction injected through a document — read a colleague's private file. The
route requires `X-Aisar-Task-Id`, resolves the task under the tenant, and
serves only attachments linked to that task's run, mirroring
`routes/artifacts.ts:64-85`.

**The fetch happens after admission, not inside `start`.** `RunnerClient.start`
times out at 30 s (`worker/src/runtime/runner-client.ts:224-236`) and the
runner's start handler is synchronous to Hermes' 202. Downloading tens of
megabytes there means the worker times out and retries while the runner carries
on. The runner answers `starting`, downloads, then starts Hermes; a failed
fetch fails the task loudly with a visible reason rather than running a turn
about a file that is not there.

**Inputs are cleaned up like outputs** (`server.mjs:2621-2628`), keyed by task
id, mode `0o400`, outside the Hermes checkout. The sprite cost model assumes
5 GB hot storage; without cleanup a dozen runs fill it.

**An old runner must refuse, not ignore.** `taskProblem`
(`runner/src/server.mjs:1253-1296`) validates known fields and ignores the
rest, so a worker sending `attachments` to a sprite on an older release runs
the task with no files and the agent answers about a file it never opened —
the exact failure this design exists to prevent. The ask is gated on runtime
release, the way `routes/agent-memory.ts:102` gates memory, and refuses with a
message.

## What the agent does with the file

Text, Markdown, CSV and JSON it opens directly — no model capability needed.

**PDF is not covered by "its own tools".** `read_file` extracts only
`.ipynb`, `.docx` and `.xlsx`; Hermes has no PDF library and the bootstrap
installs none. So PDFs go through Workers AI's `toMarkdown` server-side
(`worker/src/routes/runs.ts:839-846`), or poppler joins the bundle. Decide
before implementation; do not leave the agent to pip-install at run time.

**Image fidelity is unproven and must not be claimed.** A solid colour proves
nothing about a receipt: totals, line items and handwriting are what a
description loses. And `toMarkdown` is not a safer fallback — it is a
description model too, which is why the mini-apps plan's first step is a spike
evaluating exactly this against real receipts. The one path the probes proved
on pixels is the direct `image_url` call to the proxy. So the receipt test runs
against all three — auxiliary `vision_analyze`, the native path with
`supports_vision` on, and a worker-side proxy call with a targeted extraction
prompt — and the winner is chosen on measured accuracy, not on architecture.

## Serving it back, and trusting it

`GET /api/attachments/:id` answers as an attachment with
`Content-Disposition: attachment` and `nosniff`, like `routes/artifacts.ts:137-147`.
An owner-uploaded HTML file served inline at the API origin would run as the
API origin.

**File contents are untrusted input.** The agent can run an uploaded file with
`bash` or `python` whatever its mode bits. `ask.ts:250` already tells the model
that web and tool output are untrusted; the appended attachment instruction
says the same of file contents, and `speakerInstructions` extends to files a
staff member uploaded — a staff request is not the owner's word, and neither is
a staff member's document.

## Consequences elsewhere

**Account deletion grows** — rows, an R2 prefix, and sprite inputs folders.
That spec still does not exist and this adds to it.

**Retention text needs widening, not correcting.** The live notice scopes
non-retention to "the document-ingestion feature" and separately says files
"deliberately save[d] as work output are retained until removed". An attached
file is neither, so the sentence needs to cover it. The App Store privacy
label in `docs/mobile-launch-checklist.md:46` — photographs transmitted and not
retained — does become wrong and must change before submission.

**There must be a delete.** "Kept until the owner deletes them" has no route
and no `permissions.ts` row. Ship with owner-and-uploader delete.

**Reconcile with mini-apps.** `docs/plans/2026-09-12-mini-apps.md` specifies its
own `attachment` table with `purpose`, installation scope, staging expiry and
EXIF stripping. Two attachment tables with two visibility rules is the risk:
either this table is the one store, with `purpose` and `state` columns, or the
plan says plainly why they are separate.

**Telegram gets a stopgap now.** Not the photo fetch, but one branch in
`parseUpdate` that recognises `photo`/`document` and replies "I can't read
photos here yet — send it in the app". Silence makes the product look dead.

## Testing

The failure this design exists to avoid is confident invention, so the tests
are falsifiable or they are decoration.

- **Assert on the answer, never on a 202.** A known-content image and a known
  receipt, checking the values come back right. The probe that accepted a 202
  and believed it cost an afternoon.
- **These probes belong in `fleet-verify.sh` and the release gate**, not only
  in the unit suite, because every link in the chain — the tool list, the
  vision fast path, `read_file` coverage, `file_safety` deny lists — is a
  Hermes internal that a pin bump can change silently. A faked model in
  `test/orchestration.test.ts` cannot see any of it.
- Visibility: an attachment on a colleague's private chat answers 404; a staged
  row is invisible to everyone but its uploader; an id from one chat refuses to
  attach to another. Asserted as `aisar_app`, arranged as owner.
- Limits refused at the route, not at the runner; an oversized photo through
  the real resize path.
- A missing attachment fails the run loudly.

## Deliberately not in this design

- Sending pixels natively through Hermes' own request path. It is dropped on
  the two endpoints we use; `POST /api/sessions/{id}/chat` keeps image parts
  and was not probed, so check it before filing anything upstream against
  `qhkm/hermes-agent`.
- A retention window for attached files.
- Editing or re-uploading an attachment in place.
- Attachments on routines and scheduled runs.
- Fetching Telegram photos.
