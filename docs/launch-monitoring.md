# Launch usage monitoring

Prepared and enabled locally on 17 September 2026. This is monitoring, not
authorization to retry customer tasks, alter access, charge customers or deploy.

## Recurring execution

The local LaunchAgent `com.kitakod.jentera-launch-usage` collects a snapshot
every 900 seconds and once at load. Its plist is installed at
`/Users/dr.noranizaahmad/Library/LaunchAgents/com.kitakod.jentera-launch-usage.plist`.
It calls `worker/scripts/launch-usage.mjs` and appends one JSON line to
`/Users/dr.noranizaahmad/.hermes/logs/jentera-launch-usage.jsonl`.
The job and log were verified after bootstrap; the log is owner-readable only.

This requires this Mac to be awake, connected and logged in. It is not cloud
uptime monitoring. Alerts are flags in the local journal, not emails, Telegram
messages or automatic notifications in a closed Codex conversation. Existing
weekly pulse is separate and its last exit was 9; the old health LaunchAgent
was not loaded when checked. Neither was modified or sent a test alert.

```bash
node worker/scripts/launch-usage.mjs
node --test worker/scripts/launch-usage.test.mjs
launchctl print gui/501/com.kitakod.jentera-launch-usage
tail -n 1 /Users/dr.noranizaahmad/.hermes/logs/jentera-launch-usage.jsonl
# Stop only this monitor (does not change production):
launchctl bootout gui/501/com.kitakod.jentera-launch-usage
```

Exit 0 means collection succeeded without alert flags; 1 means a collected
snapshot contains flags; 2 means collection failed. Failed collection reports
`metrics_available: false`, never fabricated zero usage.

## Scope and safety

- Reads the existing `~/.config/neon/owner-url` in memory; validates the exact
  production host, database and owner role. No credential is stored in source,
  arguments, logs or the plist. Does not run an interactive Neon login.
- PostgreSQL enforces `default_transaction_read_only=on` and a 20-second
  statement timeout. Queries use aggregate counts only. No chat/file text,
  event payloads, credentials or customer addresses are read into snapshots.
- Excludes the four known owner/test emails and `AISAR AI` names; excludes
  fictional `example.invalid` accounts. Customer business metrics require a
  non-test owner and exclude businesses co-owned by known test accounts.
  This is a known exclusion set, not proof every remaining account is a buyer.
- Public site/API checks follow normal redirects; no Sprite probe/wake,
  provider/model calls, payments, account changes or task retries.
- Daily metrics start at midnight `Asia/Kuala_Lumpur`. They are not cumulative
  since launch. Runs are tasks, not a count of every chat message.
- Payment counts use the existing server payment-evidence table. They do not
  independently reconcile Stripe balances or prove webhook receipt completeness.
- Separates measured application-recorded AI cost from estimated finalizations.
  Neither is a provider invoice; Sprite infrastructure spend is not included.
- `created_to_run_started_seconds` is lifecycle timing, not first thinking/token
  latency. Historical `runtime-latency` logs and GA traffic are not queried by
  this monitor; no visitor or model-start latency numbers are claimed.

Flags cover public health failure, stale due tasks over 15 minutes with no recent
update (and expired leases for leased tasks), runtime errors, task failures in
the last hour and trial intake failures today. Owner-approval waits are excluded
from stale-task checks. Flags require operator review, not automatic remediation.

## First observed launch issue

At approximately 12:25 MYT on 17 September, two customer provisioning jobs were
still queued, created at 09:31 and 11:15 MYT, with no runtime rows despite
completed business setup. Read-only access checks and code inspection identified
an onboarding/preview admission mismatch: a preview request admits its own task
ID, not the separately enqueued provision task. The provisioning consumer can
acknowledge an unadmitted task without changing its queued database status.

Initial diagnosis was read-only. After the user explicitly authorized a fix,
commit `97d297f` added narrow lifecycle admission for an existing provision task
owned by a verified, onboarded preview owner with chats remaining. It excludes
other task kinds, cross-business task IDs, exhausted previews and accounts with
an existing access grant or redeemed invitation. It does not grant platform
access, alter chat counters or admit ordinary model/background work.

All 1,195 backend tests, typechecking, the runtime release gate and the pinned
14-field bootstrap compatibility check passed. The control-plane Worker was
deployed as version `6ebf4584-ae76-4352-b2ae-4901c5801e4f`; the runtime release,
bundle commit and Hermes pin were unchanged. Post-deployment API health was
healthy and paid checkout remained enabled.

At 12:39 MYT, only the two original jobs were submitted to the existing
authenticated single-task support handler, retaining its lease/deduplication
machinery. Both entered installation, with zero preview chats consumed. Recovery
completed at 12:45 MYT: both tasks were `completed`, both runtimes were `ready`,
and their observed release matched the existing `2026.09.16-4` release. Both
preview counters remained zero, retaining all 10 chats. No broad drift sweep,
access grant or quota reset was performed.

The operator HTTP clients timed out after five minutes while the setups continued
through readiness and checkpointing. No duplicate retry was sent: subsequent
read-only database checks confirmed both original jobs completed and had no
recorded error. Treat an operator transport timeout as ambiguous, not evidence
that provisioning failed; check durable task state before attempting recovery.

The final read-only launch snapshot at 12:46 MYT showed zero stale customer tasks,
zero runtime errors and no monitor alert flags. All five public site/API checks
returned HTTP 200. The recurring local monitor remains enabled with the same
15-minute interval and Mac-availability limitations described above.

## Production fleet verification

On 17 September, the Sprites account inventory matched all 19 live production
runtime rows. The separate `aisar-poc-b1` resource is a proof of concept, not a
production tenant, and was excluded from production verification.

Read-only live checks through the sanctioned `fleet-exec.sh` path passed on all
19 production Sprites: runtime configuration and authenticated `/readyz` both
reported `2026.09.16-4`, the Hermes checkout matched pinned commit
`ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413`, reviewed dependency/API-server patches
verified, and both `hermes` and `aisar-runner` services were running. These checks
may resume sleeping Sprites, but did not upgrade them, send customer work or call
a model. The local audit summary is under `/tmp/jentera-fleet-audit.3brA8x`.

Two runtime rows retained existing checkpoint warnings; both were ready, on the
correct release and passed the live checks. No checkpoint repair was attempted.
The preview provisioning fix is in the shared Worker, deployed at 100% on version
`6ebf4584-ae76-4352-b2ae-4901c5801e4f`, not a new Sprite bundle.

The desktop browser frame refinement was subsequently committed as `84f9571`
and deployed to `https://348b9177.aisar-jentera.pages.dev` on the production
`aisar-jentera` branch. Both custom hostnames served the exact built JS/CSS
hashes. All 1,075 frontend tests, typechecking, 10 mocked responsive browser
checks and deployed desktop dark/light checks passed. Public navigation checks
passed without a production session. Existing typing behavior, mobile sizing,
browser owner-control gates and runtime pins were unchanged. Direct keyboard
typing was discussed as a separate proposal, not implemented in this release.
