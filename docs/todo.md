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
| **The runner bundle from R2** | Shipped 23 Sep. A sprite now downloads one gzipped object from `jentera-runtime-bundles` on a 15-minute ticket and checks it against `RUNTIME_BUNDLE_SHA256`, replacing 24 anonymous curls against raw.githubusercontent.com. No sprite has yet bootstrapped this way — the bundle path only runs on a fresh provision or an upgrade | A provision or an upgrade completes with the new pins, and `fleet-verify.sh` is clean. Then, and only then, flip the repository to private (`gh api -X PATCH repos/qhkm/jentera -f private=true`) and provision once more to prove it. `qhkm/hermes-agent` stays public — the bootstrap still fetches its installer anonymously |
| **`connect_service`, the conversational connect** | Shipped 19 Sep in `2026.09.18-4` (Hermes `v2026.9.18-2`), carried forward into `-6`; verified registered on a sprite alongside `business_records`. Never run by a person. The whole path is untried: agent tool → `/v1/runtime/connect` → offers → owner's choice → `harvest` recipe → verify → store | From Kitakod (Bukku is disconnected), ask in chat to connect Bukku. It should offer two ways and say what each grants — including that a browser sign-in leaves the session where the agent can read it — ask for the subdomain rather than guess it, and never ask for a token in chat. Then read `run_event` for the run: `agent.tool` naming `connect_service`, and a `connection` row attributed to the owner. Anything it does beyond that — asking for a token in chat, or typing a password — is a bug, not a quirk: the tool description forbids both, and a description is a request rather than a constraint |
| Team flow end to end | Steps 0–7 of `docs/plans/2026-09-12-team-features.md` shipped 12 Sep; Kitakod Ventures is on the plan; no invitation has ever been sent live | From Kitakod, invite a second address you control; the email arrives through Resend; `/join` accepts; a chat opened in a workspace is readable by the other member; `DELETE /api/team/members/:userId` ends their session at once. Note anything off in `docs/team-plan.md` |
| Restore path | `provider.restore` has never run in production, and until 51c844b (12 Sep) the stored id was Fly's `Current` pseudo-entry, so a restore would have gone to the last hourly snapshot | On the poc sprite, restore to a real `vN` id and watch the runner come back on the expected release |
| Web push on a real device | Until the evening of 12 Sep the API refused the switch's PUT twice over (CORS preflight, then the pre-route guard), so no device has ever subscribed; `push_subscription` is empty | Turn "Notifications on this device" on from a phone or desktop; the welcome push arrives; one row in `push_subscription` |
| Turnstile on the sign-in doors | Live since 13 Sep: site key in the app build, secret on the worker; a bare link request answers 400 `TURNSTILE` | A real signup from a fresh browser passes the check and lands in the signup notice; the worker logs no `[turnstile]` warnings for a day |
| Signup notice | Shipped 13 Sep 10:27 MYT; two real accounts followed at 11:28 and 12:03 | Owner confirms two emails in qhkmdev90@gmail.com with door, verified state, MYT time and the account count |
| Document upload | `POST /api/runs/ingest/file` shipped 12 Sep; the release was verified as served, the upload itself may not have been tried live | Upload one PDF and one CSV on production; facts land unconfirmed with the file name as source |
| **Browser restart recovers a latched desktop (`23e7f7b`)** | The restart action first shipped in `2026.09.21-3` calling `changingControl()`, and a latched gateway throws from that listener — so the recovery failed in exactly the state it exists for, and the owner saw "The browser did not restart" on a healthy browser. The fix is inside the pin of `2026.09.21-4` (`e789c0b`), on 13 of 16 sprites, and has never been pressed against a genuinely latched gateway | Latch a desktop, press Restart browser, and get `desktopView: 1` rather than an error; the fallback if it still fails is `sprite-env services restart aisar-runner` |
| **Browser tool calls fail fast while the owner holds the browser** | Shipped 22 Sep in `2026.09.22-2` (Hermes `v2026.9.22`). Admission already refused a task with 409 `business_browser_paused`, but a task admitted *before* the claim still reached for the browser and waited: run `2048b734` called `browser_console` six seconds in, produced nothing for five minutes and ended `expired`. Hermes now reads `browser.hold_file` — the runner's own `/var/lib/aisar/browser-control.json` — before every browser command and before raw CDP, and refuses at once. It fails open, so a hold file it cannot read would be a fix that silently does nothing — checked on 22 Sep and it is not: `guard=True`, the config resolves, and on the two sprites that have ever claimed a browser the Hermes interpreter reads the file (0600 `sprite:sprite`, uid 1001 on both sides). The file only exists once a browser has been claimed, so most sprites show nothing to read yet | Take the browser on a sprite mid-run and ask for something that needs it: the reply says the owner has the browser within seconds and the run ends `completed`, not `expired` |

## Next runtime release must carry

| Item | Why | Done when |
|---|---|---|
| Hermes local cron removal on Kitakod's sprite | A one-off cleanup; sprites never own a local cron. Only the bundle makes it permanent | The release's bootstrap removes it; `fleet-exec.sh` finds none |
| BoxCompute warning cleared | `last_error` holds the checkpoint warning while Fly's orphan `v31` exists | After Fly clears the directory, the next release checkpoints cleanly: `last_error` null, a real id |
| ~~`AISAR_KEEPALIVE_GRACE_HOURS` 0 -> 1~~ | **Deployed in `2026.09.23-2`**, 23 Sep — the Worker deploy at step 4 of that release is what finally activated it after a day inert in the tree | Still to confirm: a run following a gap of under an hour starts without a wake, and `stats.sh` shows no rise in stuck tasks |
| Observe session watched on the canary | `2026.09.23-2` shipped the view-only desktop (`docs/plans/2026-09-23-desktop-observe.md`). x11vnc polls the framebuffer while the agent works and the cost is unmeasured; the plan's acceptance gate asks for a reading before the pilot widens | A 10-minute observe session on `4e8c2593…` is recorded with sprite CPU alongside, and bandwidth replaces the estimate in the plan |



### Before any Worker deploy, check the tree

As of 22 September `worker/src` carries uncommitted bot-preferences work
(`routes/repo.ts`, `routes/runs.ts`, `specialists.ts`) that reads
`specialist_profile.avatar` and writes `bot_preference`. **Production has
neither** — migration 065 is unapplied there. `wrangler deploy` bundles
`worker/src` from disk, so deploying while that is present ships code that
fails on those paths. Order is migration, then Worker, then app
(`docs/ai-bots-and-avatars.md`). `git status worker/` before any deploy.

### Re-running the keepalive measurement

```sql
with d as (
  select business_id, started_at,
    started_at - lag(started_at) over (partition by business_id order by started_at) as gap
  from runtime_task
  where kind = 'run' and started_at is not null and started_at > now() - interval '30 days'
)
select n.hrs as keepalive_hours,
  count(*) filter (where d.gap is null or d.gap > (n.hrs || ' hours')::interval) as wakes,
  count(*) as runs,
  round(100.0 * count(*) filter (where d.gap is null
    or d.gap > (n.hrs || ' hours')::interval) / count(*), 1) as pct_paying_wake
from d cross join (values (0.0),(0.5),(1.0),(2.0),(4.0),(8.0),(24.0)) as n(hrs)
group by n.hrs order by n.hrs;
```

Peak concurrent run tasks over the same window was **4**, which is why
`max_concurrency = 20` on the queue was left alone: it is nowhere near
binding, and raising it would change nothing.

## Gaps in what is live

Found 23 September while comparing against OpenMausBot (see its section
under Proposed). Each was confirmed in our code, not taken from the
comparison.

| Item | Why | Done when |
|---|---|---|
| **The agent cannot reach Bukku, and Bukku writes cannot be approved** | Bukku is in `LIVE_CONNECTORS`, but nothing on a sprite calls `POST /v1/runtime/connector`: `RUNTIME_CONNECTOR_PATH` is used only by its own route, there is no wrapper beside `jentera-calendar`/`jentera-gws`, and `ask.ts` says nothing about it. The one Bukku mention in the runner is the connect recipe in `browser-recipes.mjs`. The route itself decides with `riskOf` (`routes/runtime-connector.ts:91`), not `policyFor`, so the owner's Permissions settings do not govern it, and anything above low risk answers 403 `needs_approval` ("cannot be asked for from here yet") instead of queueing an `approval` row the way Google Calendar does. After approval, `routes/repo.ts` executes only Calendar `create_event` | A runner wrapper (with a `help <connector>` subcommand, so each new connector does not add its instructions to every turn's prompt) reaches the route; a Bukku read from chat returns data in `run_event`; the route decides with `policyFor`; a Bukku write lands in the approval inbox and runs after Approve. This is the general approve-then-execute path any further connector needs first |
| **Telegram voice notes are not understood** | `parseUpdate` (`connectors/telegram.ts`) marks a photo, file, voice note or other media message as `unseen`. A voice note, which Malaysian owners send constantly and often in BM, has had a one-line "can’t listen yet" reply since the 24 September stopgap, but is still not understood and leaves no trace. Workers AI is already bound as `AI`. Telegram's file URL carries the bot token, so the download goes through the vault behind a new allow-listed route; bots that predate the vault download in the worker with the token it already holds. Designed as piece 3 of `docs/superpowers/specs/2026-09-24-telegram-media-design.md` | A voice note to the business bot is transcribed (Whisper on Workers AI), answered like typed text, and the run records that it came from audio. A voice note that cannot be transcribed gets a one-line reply asking for text, not silence. Then the same for a mic in the app composer. Approvals stay on buttons: never inferred from speech |
| **A solo owner is never told an approval or a result is waiting** | Built 24 Sep. The app and migration 069 are live (24 Sep); **the Worker is not deployed yet**. Before it, `notifications/work.ts` told only owners other than the requester, and all 37 businesses had one member, so these kinds reached nobody. Now the person who asked in the app is told of an approval (owners only), of a task needing them, and — new kind `work_finished`, migration 069 — of a work task that finished or failed two minutes or more after it was asked. Quick chat replies never push (14 days to 24 Sep: 252 app chat replies at a p50 of 15 s, against 7 `needs_input`, 31 completed and 14 failed work tasks). `deliverPendingPushes` sends at once instead of waiting for the minute cron; it judges "due" by the database's clock. Whether the owner is still watching is not checked: a phone put away can keep its WebSocket open, so a live socket would suppress exactly the push this exists for | Deployed in this order: app first (it knows `work_finished`, and now leaves out a row of any kind it does not know instead of rejecting the whole list), then `node worker/scripts/apply-work-finished-notification.mjs`, then the Worker. Migration 069's list already names Bookings' `booking_requested`, and 068 on `bookings-v1` will name `work_finished`, so the two apply in either order. Then: a solo owner who asks in the app for something needing approval gets a push within seconds, and a work task taking over two minutes pushes "— done" |
| **Approvals expire after 60 s** | A known trade-off, not a bug: `docs/plans/2026-09-10-web-chat-approvals.md` §3 keeps `HERMES_APPROVAL_WAIT_SECONDS = 60` because three clocks run through the wait (reservation deadline, runner task-age, Hermes `approvals.timeout` 90 s) and the `approval_wait` predicate blocks every other lease for the business. It still means an approval works only while the owner is looking at the chat. OpenMausBot waits 15 minutes, and its stall watchdog skips a turn waiting on a person (`server/turn-watchdog.ts` `setWaitingOnHuman`), but it has no business-wide slot to block | Revisit after the push row above. The shape that avoids blocking the business: end the Hermes run when it asks, persist the pending action, and resume with a one-shot grant on decision. Done when an approval answered 15 minutes later runs the action, and nothing else for that business waited in between |

## Waiting on someone else

| Item | Who | Note |
|---|---|---|
| Clear orphan `checkpoints/v31` on sprite `aisar-b-702bf940d4f6ac4a4f52` | Fly support; the owner sends the message drafted 12 Sep | Include the exact JuiceFS rename error and the NEOREKA ASIA precedent of 7 Sep, which cleared when Fly rebuilt the store |
| Reply to Scott at Fly | Owner | Open since before 12 Sep |
| Three sprites will not wake for a release | Fly | `aisar-b-aef5c56aa41b50c19239` (My business), `aisar-b-05a921d0d21112fc3657` (SEIDO Coffee Roasters), `aisar-b-3d7d3328022863d0bd22` (Stickoworld). Shipped 21 Sep: 13 of 16 converged; these three are cold and Fly answers 502/503 to the runtime-file write, while `sprite exec` times out connecting. Not the bundle — the other 13 took the identical transfer. The drift sweep keeps re-arming them (24 tasks in 30 minutes), so they should converge on their next successful wake. Done when all three observe the current release (`2026.09.21-3` as of 21 Sep) |

## Review later

| Item | When | How |
|---|---|---|
| Classifier detail | A few days after 12 Sep | `run_event` where `type = 'outcome.observed'` and `payload->>'observed' = 'classifier_unavailable'`; read the `uncertaintyDetail` split (timeout, unparseable, error). Retry landed 12 Sep |
| Flaky app test `activity-mode` | When it fails again | Not blocking; record the failure mode before fixing |
| Business-browser pause on a phone | If a paused panel appears with nothing paused | `browser-control.json` on the sprite is the truth (`fleet-exec.sh --only <sprite> 'cat /var/lib/aisar/browser-control.json'`); on 17 Sep the owner saw the panel on mobile while both his sprites read `{"paused":false}`/absent. Fixed at the display end: a failed check now says "could not check" with a retry and no longer blocks sending. If it recurs *with* the sprite genuinely paused, the gap is that the only remedy offered is Open Business Browser, which renders a streamed desktop — a poor answer on a phone. A screenshot before it clears is worth more than any query |
| Runs failing on a cold sprite's wake | If an ask fails with `runner returned invalid JSON (5xx)` | The runner answers a second or two after the machine wakes, but Hermes behind it takes the 15-30 s restart `docs/reply-latency.md` measures — so the runner returns a 5xx whose body is not JSON, and until 17 Sep that spent attempts. Kitakod Ventures lost a run this way at 23:39 MYT on 17 Sep after twenty minutes cold; a fresh ask at 23:42 succeeded while the retry was still being graded terminal. Now deferred without counting, bounded by `WAKE_GIVE_UP_MS` (4 min) against `started_at`, which survives a defer. The five failures on 15 Sep (`exceeded its time limit before Hermes started`) are the same family. Diagnosis trail: `gateway-exit-diag.log` on the sprite shows gateway starts and non-zero exits; a live pid whose `lstart` disagrees with its own start log means the sprite was suspended and resumed, not restarted |
| **Keepalive, decided against for now** | After a few release-free days, from 23 Sep | Left at `AISAR_KEEPALIVE_GRACE_HOURS = 0` on 19 Sep on the owner's call. The prewarm trace (migration 061) answered its question: warming fires 3.5-6 s before the ask and makes no difference to the p50 — 2.0 s warmed against 2.1 s not. Both outliers that looked like cold wakes were releases: 317.6 s on 18 Sep 11:57 sits between `2026.09.18-1` and `-2`, and 181.7 s on 17 Sep 23:39 inside the `2026.09.17-6` re-bootstrap. The one genuine cold case — 19.8 s at a 45-min gap, 18 Sep 08:45 — predates the app deploy at 09:08 by twenty minutes, so nothing attributed it. Re-run the three queries in `docs/reply-latency.md` over a window with no releases in it; four releases in one day is the wrong background for measuring wake time. Decide then, on `deliveredBeforeChecks`-style evidence rather than the hypothesis |
| Reply latency re-measure | Before quoting any number | `worker/scripts/reply-latency.sh`; `docs/reply-latency.md` carries the dated figures |
| **`STAGE:install` exhausts intermittently** | Next time a provision or upgrade exhausts | 12 upgrade tasks across 10 businesses exhausted at attempt 8 on 16 Sep 00:52-00:59 (`pinned Hermes dependencies (nanoid, undici, postcss, react-router…)`, and a Playwright `fallback build for ubuntu24.04-x64`); one provision exhausted the same way on 17 Sep 17:51 and then succeeded unattended at 18:00. It is flaky, not broken — which makes it the fleet's most common failure point, not just its slowest stage. `select (created_at at time zone 'Asia/Kuala_Lumpur')::date, kind, count(*) from runtime_task where status='exhausted' and last_error like '%STAGE:install%' group by 1,2`. The fix is [serving the bootstrap's bytes ourselves](plans/2026-09-17-prebuilt-bootstrap-bytes.md) |
| **Asks that fail before Hermes starts** | If it recurs outside a bad release | Five `owner.ask` runs on Kitakod Ventures failed 15 Sep 16:28-18:16 with `runtime task exceeded its time limit before Hermes started`, attempt 5, no `work.started` event — the sprite could not come up, hours before the 16 Sep upgrade failures above. Nothing was spent on tokens; the elapsed time was retry backoff. Related to the row above, and expected to disappear with it |

| Warms that time out | If it recurs | Two businesses recorded `prewarm_failed` at exactly 8000 ms on 18-19 Sep — `prewarmSprite`'s own timeout, not an error from the sprite. A warm that times out is a warm that bought nothing. `select business_id, last_prewarm_outcome, last_prewarm_ms from agent_runtime where last_prewarm_outcome <> 'prewarm_ready'` |

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

### Post-launch: OpenMausBot-inspired improvements

Compared on 23 September 2026 against
[milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot) at
`039aed8`: an open-source, local-first Electron app that is itself a Grok
Bot clone, where each bot is a Claude/Codex CLI agent. Apache-2.0, so code
may be ported with its NOTICE kept. **Its `enterprise/` folder is under a
separate source-available licence: copy nothing from it.** The same
post-launch rule as the section above applies. Where an item overlaps a
Grok Bot row it is marked; build it as that row, using the OpenMausBot file
as a reference. The gaps this comparison found in live code are under
"Gaps in what is live" above. The full reasoning, area by area, is in
[`openmausbot-comparison.md`](openmausbot-comparison.md).

| Priority | Item | Why | Done when |
|---|---|---|---|
| 1 | Credit meter and one 80% warning | `runtimeBudgetSnapshot` is already returned by `routes/runtime.ts` and nothing in `app/src` reads it; the owner first hears about spend from `CREDIT_CAP_NOTICE`, after work has stopped. OpenMausBot warns once a month at 80% and again at the cap (`server/spend.ts`) | The app shows credit used against the cap. One notification at 80% per month, keyed `credit_warn:YYYY-MM`: `createNotification`'s `on conflict (business_id, recipient_user_id, source_key) do nothing` gives once-a-month for free. Later, a breakdown by person, specialist and routine (`runtime_usage` → `runtime_task` → run) |
| 2 | Scrub secret-shaped text before it leaves | The runner's `safeToolPreview` catches only `Bearer` and `key=value`; `sanitizePublicRuntimeText` rewrites only paths. Nothing scrubs credentials from text sent to customers on Telegram when `send` is automatic. OpenMausBot's `shared/redact.ts` is 66 lines with no dependencies (`sk-`, `AKIA`, `ghp_`, JWTs, PEM keys, passwords in URLs, `--token`, `KEY=`) | Ported with attribution into both the Worker and the runner, and applied to customer-bound Telegram text, approval previews and notification bodies, with tests for each pattern |
| 3 | Routines proposed from chat (Grok #2) | `ask.ts` tells the agent recurring requests "belong in Routines", so the owner has to leave the chat for a form. OpenMausBot turns an agent tool call into a confirmation card showing the rule, the time zone and the next 3 dates, and the confirmation is bound to exactly what was shown by a SHA-256 fingerprint (`server/routine-requests.ts`) | A `jentera-routine` block renders a card like the reminder card, with the next 3 run dates; confirming applies exactly the fingerprinted draft, and nothing is created until then |
| 3 | Monthly and last-day-of-month schedules | `worker/src/routines/schedule.ts` has daily, weekdays and weekly, Malaysia time only. Month-end and 1st-of-month jobs (invoices, payroll reminders) cannot be expressed. OpenMausBot uses Croner (pure JS, `shared/routine-schedule.ts`) | Monthly on a day, and on the last day, schedule correctly across short months; the due scan and misfire cutoff are unchanged. Check Croner runs under Workers before adopting it |
| 4 | Fold follow-ups sent while a run is busy, and put the owner ahead of routines | Each message is its own run behind the business-wide lease, so a Telegram burst ("check stock" / "also Ali's invoice") becomes 2–3 paid, disjointed turns. `nextWaitingRuntimeTaskId` orders strictly by `created_at` (`runtime/tasks.ts`), so a chat message waits behind queued routine runs. OpenMausBot joins queued messages into one follow-up turn (`server/steer-queue.ts`) | Queued, not-yet-started messages from the same session run as one turn. Interactive tasks lease before scheduled ones. Steering a turn already running needs Hermes support and is a separate spike |
| 4 | Replay the chat once when it changes specialist | Sticky routing (`specialistForTurn`, 6 h) works around, but does not fix, a new Hermes profile seeing none of the chat's earlier turns (`docs/architecture.md` §5). The turns are already in Postgres (`routes/chats.ts`). OpenMausBot replays history once to an engine new to the thread (`server/turn-context.ts`, `FRESH_PREAMBLE`) | When the profile answering differs from the one that answered the chat's previous turn, the last few question/answer pairs are prepended once. The 12 Sep "yes run the test run" case reaches a specialist that knows what "the test run" is |
| 5 | Sign-in handoff in fewer taps (Grok #3) | Open → Take control → sign in → Hand back → close → Check → Continue → Send is about 8 taps, usually on a phone. In OpenMausBot handing back settles the request and the waiting bot carries on (`server/computer-control.ts`) | Opening from `BrowserHandoffCard` claims control at once; a successful Hand back runs `checkTaskRecovery` itself and puts the continuation in the composer. The owner still taps Send: nothing auto-sends |
| 5 | Save a finished run as a how-to (Grok #2, #4) | Hermes skill-learning is off for cost (`configure-model-provider.py`), and every specialist's `skills/` folder is empty. OpenMausBot has the agent draft a SKILL.md (When to use / Procedure / Pitfalls / Verification) and holds it until a person approves the exact text (`server/skill-learn.ts`, `stageSkillWrite`) | "Save as how-to" on a completed run drafts a skill; the owner reviews and approves it; it reaches that specialist's skills through the config document. Drafts live in Postgres behind an approval card, not in files on the sprite |
| 6 | Business-type packages | `app/src/lib/data/playbooks.ts` is demo data only: every business gets the same four specialists from migration 028 whatever its type. OpenMausBot installs a whole team from one Markdown file with a YAML header (`server/bot-package.ts`, `team-library.ts`): references checked, routines installed paused, required apps turned into a checklist, and export carries setup, never runtime state | Our own format, not theirs. A package sets specialist instructions, role skills, disabled routines, a connector checklist filtered to `LIVE_CONNECTORS`, and the facts onboarding should collect. Demo figures stay separate from it. First packages are written and reviewed in the repo, so there is no import scanning yet |
| 7 | Tune Hermes' `tool_budget` | We never set it, so defaults apply: results over 100K characters (50K for MCP) are saved to disk with a "use read_file" hint. OpenMausBot measured that hint making the model read the file back (210,913 tokens with trim and path against 196,183 with no trim) | Before and after measured with `model_call` (`toolsChars`, `historyChars`) on the same tasks; keep whichever setting costs less without losing answers |
| Later | Final-screen screenshot after a browser task | OpenMausBot keeps one frame at turn end, only if a screen-changing tool ran and only if it differs from the last frame by sha256 (`server/screen-frame-gate.ts`). Proof the work happened. It means storing frames, which current policy never does, and the frame must pass the page privacy filter | An explicit decision to store frames, then one artifact per qualifying run |
| Later | Event-driven fallback preview | The fallback preview polls on a timer (5 s runner, 8 s app); the observe plan measured 55 MB/hour whether anything changed or not. OpenMausBot captures right after a screen-changing tool and skips unchanged frames (`server/screen-frame-source.ts`) | Capture on browser tool completion; "unchanged" instead of a repeated JPEG |
| Later | "Always allow" for one action on one target | The owner can only set a policy per operation for the whole business (`policy.ts`). OpenMausBot's `allowKey` is scoped to one action and one target (`server/peer-approval.ts`) | An approval card offers "don't ask again for this customer/calendar"; the grant is listed and revocable in Permissions |
| Later | Memory history with undo | Owners can Forget an entry but see no history, no source and no sign of how full memory is (Hermes caps at 2200/1375 characters). OpenMausBot diffs memory per turn and records which chat caused each change (`server/memory-journal.ts`) | The runner diffs `MEMORY.md`/`USER.md` around each task and posts changes with the run id to a table under RLS; the owner can undo one |
| Expansion | Specialists that work together | Kept for expansion on the owner's call, 24 Sep. Today one specialist answers each turn; Hermes `delegate_task` runs a sub-agent inside that same turn, and we record only its start and end (`worker/src/coordination.ts`, `agent.delegation`). No specialist can hand work to another that finishes later, and several cannot work one goal together. OpenMausBot has a Chief of Staff that routes and triages (`server/chief-of-staff.ts`), delegations whose results post back when done (`server/delegations.ts`), handoffs between bots (`server/room-handoffs.ts`) and a goal run shared across bots (`server/group-goal-run.ts`). Two constraints shape ours. The product thesis rules out a roster or workforce-management screen (`docs/marketing/product-thesis-and-homepage.md`), so the owner sees the outcome and who did which part, not a room to manage. And a sprite has one runner slot, so specialists cannot work in parallel until the runner can | A plan in `docs/plans/` first, covering the one-slot runner, the cost of each child run, and limits on depth and fan-out. Then: a specialist hands a sub-task to another as a child run linked to its parent and readable under the parent's visibility rule; the result returns to the asking run or chat; the owner gets one answer that says which specialist did what; every child action still goes through the same approval gate |
| Expansion | Composio for connector breadth | Kept for expansion on the owner's call, 24 Sep. Three connectors are live and nine are placeholders (`worker/src/connectors.ts`). Composio handles sign-in and actions for hundreds of apps (Gmail, Sheets, Drive, Slack, Notion…), which is the fastest way to widen coverage. It does not cover Bukku, Shopee, Billplz or WhatsApp, so it sits beside our own connectors rather than replacing them. OpenMausBot opens one Composio session and gives the agent generic search, schema, execute and connect tools (`server/composio.ts`, `server/connector-proxy.ts`, `docs/composio.md`). It checks nothing itself (`docs/approval-levels.md`), and that part we cannot copy | In order: (1) the approve-then-execute path from "Gaps in what is live" exists. (2) The Composio key lives only in the Worker and never reaches a sprite, because one project key opens every business's connected accounts; the business id is the Composio user id. (3) A per-tool allowlist: listed reads run, everything else becomes an `approval` row. (4) The privacy page says Composio holds the tokens, and disconnecting revokes them at Composio. (5) Decide between Composio's managed sign-in (Composio's name on Google's consent screen) and our own OAuth app (Google verification for Gmail's restricted scopes). (6) Pilot Gmail, Sheets and Drive. Each app joins `LIVE_CONNECTORS` only once its execute path, connect flow and name are all real |

Not worth taking, so it is not re-proposed: owner-added MCP servers and
Jentera as an MCP server; voice calls; per-turn git
checkpoints, compaction and context-diffing (Hermes owns sessions); peer
approval and room budgets. Where Jentera is already ahead and should not
copy: the durable Postgres queue and scheduler, the outcome assessor, the
worst-case budget reservation, approvals claimed under a lock with editable
drafts, real web push, step privacy, credentials never reaching the agent,
and business facts carrying their source.

## Closed

- 13 Sep — Step messages under a reply read again: the runner keeps the program of a command, the app folds runs of one kind into one line with a count and shows every step at the advanced level (ca66bbd, runtime 2026.09.13-5). Arguments stay hidden.
- 13 Sep — Installed app now looks for a release on every return to the foreground and hourly while open (`pwa/update-checks.ts`); the prompt still waits for a tap.
- 13 Sep — Service worker cache header on jentera.ai: dropped, not fixed. Only `/sw.js` gets the zone's `max-age=14400`; HTML, manifest and offline page keep their `no-cache`, old deployments' assets still resolve, and browsers bypass the HTTP cache for a service worker's main script on every update check (`updateViaCache` defaults to `imports`). The header changes nothing a user can see. What delays a phone is the update prompt (`registerType: 'prompt'`) and the check cadence, not the cache.
- 13 Sep — Real checkpoint ids on 12 of 13 rows, written by release 2026.09.13-4 (fix 51c844b). BoxCompute alone still says `Current`, and will until Fly clears its orphan `v31`.
