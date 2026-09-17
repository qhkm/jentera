# Open follow-ups

Status: living list, started 12 September 2026. One line per item with the
reason it exists and how to tell it is done. Plans live in `docs/plans/`; this
is what is left after them. When something closes, move it to the last section
with the date and commit rather than deleting it.

Production at 19:20 MYT on 12 September: 13 of 13 runtimes ready on
2026.09.12-3, 34 runs and 35 assessor outcomes in the last day with no
classifier miss, push outbox clean, one business on the team plan, no open
invitations.

## Shipped, never exercised on production

| Item | Why | Done when |
|---|---|---|
| Team flow end to end | Steps 0–7 of `docs/plans/2026-09-12-team-features.md` shipped 12 Sep; Kitakod Ventures is on the plan; no invitation has ever been sent live | From Kitakod, invite a second address you control; the email arrives through Resend; `/join` accepts; a chat opened in a workspace is readable by the other member; `DELETE /api/team/members/:userId` ends their session at once. Note anything off in `docs/team-plan.md` |
| Restore path | `provider.restore` has never run in production, and until 51c844b (12 Sep) the stored id was Fly's `Current` pseudo-entry, so a restore would have gone to the last hourly snapshot | On the poc sprite, restore to a real `vN` id and watch the runner come back on the expected release |
| Web push on a real device | Until the evening of 12 Sep the API refused the switch's PUT twice over (CORS preflight, then the pre-route guard), so no device has ever subscribed; `push_subscription` is empty | Turn "Notifications on this device" on from a phone or desktop; the welcome push arrives; one row in `push_subscription` |
| Turnstile on the sign-in doors | Live since 13 Sep: site key in the app build, secret on the worker; a bare link request answers 400 `TURNSTILE` | A real signup from a fresh browser passes the check and lands in the signup notice; the worker logs no `[turnstile]` warnings for a day |
| Signup notice | Shipped 13 Sep 10:27 MYT; two real accounts followed at 11:28 and 12:03 | Owner confirms two emails in qhkmdev90@gmail.com with door, verified state, MYT time and the account count |
| Document upload | `POST /api/runs/ingest/file` shipped 12 Sep; the release was verified as served, the upload itself may not have been tried live | Upload one PDF and one CSV on production; facts land unconfirmed with the file name as source |

## Next runtime release must carry

| Item | Why | Done when |
|---|---|---|
| Hermes local cron removal on Kitakod's sprite | A one-off cleanup; sprites never own a local cron. Only the bundle makes it permanent | The release's bootstrap removes it; `fleet-exec.sh` finds none |
| BoxCompute warning cleared | `last_error` holds the checkpoint warning while Fly's orphan `v31` exists | After Fly clears the directory, the next release checkpoints cleanly: `last_error` null, a real id |

## Waiting on someone else

| Item | Who | Note |
|---|---|---|
| Clear orphan `checkpoints/v31` on sprite `aisar-b-702bf940d4f6ac4a4f52` | Fly support; the owner sends the message drafted 12 Sep | Include the exact JuiceFS rename error and the NEOREKA ASIA precedent of 7 Sep, which cleared when Fly rebuilt the store |
| Reply to Scott at Fly | Owner | Open since before 12 Sep |

## Review later

| Item | When | How |
|---|---|---|
| Classifier detail | A few days after 12 Sep | `run_event` where `type = 'outcome.observed'` and `payload->>'observed' = 'classifier_unavailable'`; read the `uncertaintyDetail` split (timeout, unparseable, error). Retry landed 12 Sep |
| Flaky app test `activity-mode` | When it fails again | Not blocking; record the failure mode before fixing |
| Reply latency re-measure | Before quoting any number | `worker/scripts/reply-latency.sh`; `docs/reply-latency.md` carries the dated figures |
| **`STAGE:install` exhausts intermittently** | Next time a provision or upgrade exhausts | 12 upgrade tasks across 10 businesses exhausted at attempt 8 on 16 Sep 00:52-00:59 (`pinned Hermes dependencies (nanoid, undici, postcss, react-router…)`, and a Playwright `fallback build for ubuntu24.04-x64`); one provision exhausted the same way on 17 Sep 17:51 and then succeeded unattended at 18:00. It is flaky, not broken — which makes it the fleet's most common failure point, not just its slowest stage. `select (created_at at time zone 'Asia/Kuala_Lumpur')::date, kind, count(*) from runtime_task where status='exhausted' and last_error like '%STAGE:install%' group by 1,2`. The fix is [serving the bootstrap's bytes ourselves](plans/2026-09-17-prebuilt-bootstrap-bytes.md) |
| **Asks that fail before Hermes starts** | If it recurs outside a bad release | Five `owner.ask` runs on Kitakod Ventures failed 15 Sep 16:28-18:16 with `runtime task exceeded its time limit before Hermes started`, attempt 5, no `work.started` event — the sprite could not come up, hours before the 16 Sep upgrade failures above. Nothing was spent on tokens; the elapsed time was retry backoff. Related to the row above, and expected to disappear with it |

## Owner-side

- SBD beta.
- DMARC aggregate reports at admin@kitakodventures.com since the flip to `p=quarantine` on 9 Sep.
- The poc sprite counts against the 10 concurrent-sprite org limit alongside 13 business sprites; decide whether it stays.
- The installed PWA on a phone keeps the old bundle until its update prompt is accepted; the crowded bottom bar fix from 12 Sep shows only after that.

## Deferred product decisions

Decided on 12 September to wait for a request before building. Reasoning in
`docs/plans/2026-09-12-team-features.md` and `docs/team-plan.md`.

- Telegram for staff.
- Seat limits on the team plan.
- A third role.
- One person in several businesses, and switching between them.
- Deleting a workspace.
- Agent memory per person. Hermes keeps one memory per business; a tier
  split on the Hermes side was proposed, not built.

## Proposed, not started

- Mini apps, starting with Receipts & Expenses:
  `docs/plans/2026-09-12-mini-apps.md`. Planning only, no code.

### Post-launch: Grok Bot-inspired improvements

Decision: 17 September 2026 — launch the current product first. These are
post-launch backlog items, not launch requirements or approval to implement,
deploy, enable new access, or restore deferred external triggers. Build on the
existing memory, approvals, browser handoffs, file previews and routines rather
than replacing them or adding an agent-management burden for business owners.
Grok Bot's published capabilities are references, not independently benchmarked
speed or reliability claims.

| Priority | Item | Why | Done when |
|---|---|---|---|
| 1 | Investigate chat startup delay | Owner reported roughly 30 seconds before visible agent activity; clearer progress alone does not reduce execution latency | Measure intake, queue, runtime wake and first meaningful activity separately; record dated findings in `docs/reply-latency.md`, then verify any fix against that baseline. Progress reflects actual execution, not simulated thinking |
| 2 | “Repeat this task” from completed chat work | Convert a useful first result into a recurring business workflow | Eligible completed tasks offer a prefilled routine draft with inputs, expected result, schedule, time zone, access requirements and approval boundaries; owner reviews and explicitly confirms activation. Provide a test run with safe inputs, next run, history and pause control |
| 3 | Deliverable-first results and blocked-task recovery | Make completed work easier to inspect and make failures actionable | Results lead with the actual file or output, a concise summary and unresolved work; blocked tasks explain the reason and offer the appropriate connection, browser handoff or safe continuation. Reuse file previews and recovery cards; retries preserve task context and avoid duplicate external actions |
| 4 | “Show Jentera how” workflow teaching | Let owners demonstrate repetitive browser work instead of describing every click | Demonstration produces a reviewable draft procedure with validation, failure handling and approval boundaries; credential-entry steps are excluded from recording, storage and model context. Owner tests with safe inputs before explicitly enabling any schedule |
| 5 | Optional desktop companion / network routing pilot | Reach approved local resources when cloud connectors are insufficient | Resolve pairing, signed updates, destination/operation allowlists, prompt-injection boundaries, visible controls and immediate revocation before a read-only pilot. Network routing is distinct from local browser/computer control; obtain explicit permission for each capability, expose no inbound ports and keep cloud use independent of installation. No promise to bypass site restrictions; start from `docs/plans/2026-09-11-local-driver.md` |
| Later | Revisit event-triggered work | Start a narrowly scoped routine from an authorized business event | Make a separate post-launch scope decision and review the archived design and security gates in `future/external-triggers/README.md`; keep the launch exclusion intact until then |

References: [skills, teaching and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations),
[progress and computer-view design](https://x.ai/news/designing-grok-bot),
[files and results](https://docs.x.ai/grok-bot/files-and-results),
[desktop traffic routing](https://docs.x.ai/grok-bot/settings-and-notifications),
[approvals and sensitive-step handoffs](https://docs.x.ai/grok-bot/approvals-security-and-privacy).

## Closed

- 13 Sep — Step messages under a reply read again: the runner keeps the program of a command, the app folds runs of one kind into one line with a count and shows every step at the advanced level (ca66bbd, runtime 2026.09.13-5). Arguments stay hidden.
- 13 Sep — Installed app now looks for a release on every return to the foreground and hourly while open (`pwa/update-checks.ts`); the prompt still waits for a tap.
- 13 Sep — Service worker cache header on jentera.ai: dropped, not fixed. Only `/sw.js` gets the zone's `max-age=14400`; HTML, manifest and offline page keep their `no-cache`, old deployments' assets still resolve, and browsers bypass the HTTP cache for a service worker's main script on every update check (`updateViaCache` defaults to `imports`). The header changes nothing a user can see. What delays a phone is the update prompt (`registerType: 'prompt'`) and the check cadence, not the cache.
- 13 Sep — Real checkpoint ids on 12 of 13 rows, written by release 2026.09.13-4 (fix 51c844b). BoxCompute alone still says `Current`, and will until Fly clears its orphan `v31`.
