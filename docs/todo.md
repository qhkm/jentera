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
| **`connect_service`, the conversational connect** | Shipped 19 Sep in `2026.09.18-4` (Hermes `v2026.9.18-2`), carried forward into `-6`; verified registered on a sprite alongside `business_records`. Never run by a person. The whole path is untried: agent tool → `/v1/runtime/connect` → offers → owner's choice → `harvest` recipe → verify → store | From Kitakod (Bukku is disconnected), ask in chat to connect Bukku. It should offer two ways and say what each grants — including that a browser sign-in leaves the session where the agent can read it — ask for the subdomain rather than guess it, and never ask for a token in chat. Then read `run_event` for the run: `agent.tool` naming `connect_service`, and a `connection` row attributed to the owner. Anything it does beyond that — asking for a token in chat, or typing a password — is a bug, not a quirk: the tool description forbids both, and a description is a request rather than a constraint |
| Team flow end to end | Steps 0–7 of `docs/plans/2026-09-12-team-features.md` shipped 12 Sep; Kitakod Ventures is on the plan; no invitation has ever been sent live | From Kitakod, invite a second address you control; the email arrives through Resend; `/join` accepts; a chat opened in a workspace is readable by the other member; `DELETE /api/team/members/:userId` ends their session at once. Note anything off in `docs/team-plan.md` |
| Restore path | `provider.restore` has never run in production, and until 51c844b (12 Sep) the stored id was Fly's `Current` pseudo-entry, so a restore would have gone to the last hourly snapshot | On the poc sprite, restore to a real `vN` id and watch the runner come back on the expected release |
| Web push on a real device | Until the evening of 12 Sep the API refused the switch's PUT twice over (CORS preflight, then the pre-route guard), so no device has ever subscribed; `push_subscription` is empty | Turn "Notifications on this device" on from a phone or desktop; the welcome push arrives; one row in `push_subscription` |
| Turnstile on the sign-in doors | Live since 13 Sep: site key in the app build, secret on the worker; a bare link request answers 400 `TURNSTILE` | A real signup from a fresh browser passes the check and lands in the signup notice; the worker logs no `[turnstile]` warnings for a day |
| Signup notice | Shipped 13 Sep 10:27 MYT; two real accounts followed at 11:28 and 12:03 | Owner confirms two emails in qhkmdev90@gmail.com with door, verified state, MYT time and the account count |
| Document upload | `POST /api/runs/ingest/file` shipped 12 Sep; the release was verified as served, the upload itself may not have been tried live | Upload one PDF and one CSV on production; facts land unconfirmed with the file name as source |
| **Browser restart recovers a latched desktop (`23e7f7b`)** | The restart action first shipped in `2026.09.21-3` calling `changingControl()`, and a latched gateway throws from that listener — so the recovery failed in exactly the state it exists for, and the owner saw "The browser did not restart" on a healthy browser. The fix is inside the pin of `2026.09.21-4` (`e789c0b`), on 13 of 16 sprites, and has never been pressed against a genuinely latched gateway | Latch a desktop, press Restart browser, and get `desktopView: 1` rather than an error; the fallback if it still fails is `sprite-env services restart aisar-runner` |
| **Browser tool calls fail fast while the owner holds the browser** | Shipped 22 Sep in `2026.09.22-2` (Hermes `v2026.9.22`). Admission already refused a task with 409 `business_browser_paused`, but a task admitted *before* the claim still reached for the browser and waited: run `2048b734` called `browser_console` six seconds in, produced nothing for five minutes and ended `expired`. Hermes now reads `browser.hold_file` — the runner's own `/var/lib/aisar/browser-control.json` — before every browser command and before raw CDP, and refuses at once. It fails open, so a hold file it cannot read would be a fix that silently does nothing — checked on 22 Sep and it is not: `guard=True`, the config resolves, and on the two sprites that have ever claimed a browser the Hermes interpreter reads the file (0600 `sprite:sprite`, uid 1001 on both sides). The file only exists once a browser has been claimed, so most sprites show nothing to read yet | Take the browser on a sprite mid-run and ask for something that needs it: the reply says the owner has the browser within seconds and the run ends `completed`, not `expired` |
| Bookings v1 end to end | Plans 1–4 built on branch `bookings-v1` (not merged, nothing applied). Release order and checks are in each plan's "As built" | On Kitakod: apply 068 (`pnpm db:migrate:apps-bookings`), merge, deploy the app first, then `aisar-api`, then `pnpm deploy:sites`, set `TURNSTILE_SECRET` on sites, add Kitakod's id to both flag lists and flip `APPS_ENABLED`; set up a service, book from a phone, confirm from the notification, see the event in Google Calendar, cancel, see it removed |
| Calendar deleted-id behaviour | The spec's "Calendar deleted-id verification" was never run live; the code treats a 409 plus a `cancelled` read-back as deleted either way | In a disposable test calendar: insert with a deterministic id, delete, insert again, fetch; record status codes and event status (no customer data) |

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
- Turnstile on the booking page. The sites deploy checks Turnstile only once `TURNSTILE_SECRET` is set there, and the widget must list the sites hostname. Add `jentera-sites.qhkmdev90.workers.dev` to the widget, then `wrangler secret put TURNSTILE_SECRET --env sites`; do both before `APPS_ENABLED` is true.

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

Bookings v1, left out of the pilot (spec:
`docs/plans/2026-09-23-apps-shell-and-bookings-v1.md`):

- Customer data retention (PDPA). Bookings keeps customers' names, phone
  numbers and notes with no retention period or deletion route. A retention
  period and a way to act on a customer's deletion request are decided and
  built **before the pilot widens beyond the first businesses**.
- Bookings, later projects. Out of scope for v1: automatic WhatsApp,
  payments or deposits, customer reminders, customer cancel/reschedule,
  shared staff or resource scheduling, availability from existing Calendar
  events, staff access, Activity rows, a custom domain, businesses outside
  Malaysia, and editing the page by chat (plan 5). Each is its own plan when
  chosen.
- Bookings on its own Hyperdrive config. The sites deploy shares
  `aisar-api`'s Hyperdrive pool; a public flood is braked before the
  database but still shares the origin connections. Decide before widening
  the pilot: a separate config with caching off and a low connection cap.

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
