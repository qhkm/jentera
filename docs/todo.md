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
| Document upload | `POST /api/runs/ingest/file` shipped 12 Sep; the release was verified as served, the upload itself may not have been tried live | Upload one PDF and one CSV on production; facts land unconfirmed with the file name as source |

## Next runtime release must carry

| Item | Why | Done when |
|---|---|---|
| Real checkpoint ids on all 13 rows | Rows written before 51c844b say `latest_checkpoint_id = 'Current'`; the next clean checkpoint overwrites them | `select latest_checkpoint_id, count(*) from agent_runtime group by 1` shows only `v<number>` |
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

## Closed

_(none yet; move items here with date and commit)_
