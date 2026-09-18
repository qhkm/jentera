# Runtime incident: 2026-09-18

Investigation snapshot: 03:44–03:46 UTC (11:44–11:46 MYT). This is a
diagnostic record, not a claim that recovery or deployment completed.

## Two distinct failures

### Release 2026.09.18-2: bootstrap rejects the new Hermes tag

The central pin is `v2026.9.18-1` at
`0f45fad93f82dd9ff12d5d3755f883b1881ac748`. However,
`runner/bin/bootstrap-runtime.sh` accepts only
`^v[0-9]{4}\.[0-9]+\.[0-9]+$` and exits 1 on any other tag.
The new tag fails this guard before the installer or dependency patcher runs.

At 03:44:09 UTC, all 24 assigned runtimes desired release 2026.09.18-2:
23 still observed 2026.09.18-1 and were in error; the other still observed
2026.09.17-6. Subsequent checks showed setup retries continuing.
The 23 newer runtimes reported bootstrap failures, not provider 502s.

A read-only probe of one reachable runtime found the old Hermes commit
`70351f98fbec39cce50638cf3aa9bdaf41d01f02`, no installer stashes, and the
new bundle files present but the startup patch not applied. The local
clean-install contract tests all passed (7/7) against the new pin; they do
not execute this bootstrap tag guard. Thus passing that test alone does
not establish upgrade readiness.

The chat warning shown by the user originates in
`AskJenteraView.refreshBrowserControl`. It calls `/api/browser` rather than
the general API health endpoint. The browser route returns 503 for runtime
states outside ready/cold/idle/busy, including error and upgrading. That
becomes the generic "Could not check Jentera’s status" banner. This explains
why a healthy Worker can still produce that warning during this incident;
the exact signed-in request was not captured.

Prepared correction: permit a bounded numeric tag revision suffix, retain
the exact commit pin/checksum checks, and add tests covering the current
central pin and rejected tag forms. Both release and predeploy gates now
exercise the pinned bootstrap's actual Bash guard and fail closed on an
unreadable contract. Tests also found that IFS splitting could remove one
base64 padding byte; parsing now splits only at the first equals sign and
tests prove invalid UUID suffixes cannot disappear through truncation.
Release only through the standard runtime shipping path. No manual Sprite
patch was performed. This note alone is not evidence of live deployment.

### One assigned Sprite: provider wake/access failure

- Organization: `aisar`
- Sprite: `aisar-p-aa39ec7b8d8e447a8560e8b8d012600d`
- Provider ID: `sprite-7b31b207-534d-4c94-b950-292bf477ebb4`
- Provider URL: `https://aisar-p-aa39ec7b8d8e447a8560e8b8d012600d-bzzpg.sprites.app`
- Runtime ID: `e8289cb7-fc67-4601-9d4e-8f83dea25c95`
- Observed release: `2026.09.17-6`
- Last database-recorded checkpoint: `v7` (not freshly verified)

Provider metadata returns 200 and matches the assigned resource. It reports
`cold`. IPv4 authenticated filesystem reads and HTTP wake fail before our
bootstrap can run. The same credential/API successfully read the public
runner source on a control Sprite in approximately 0.1 seconds.

| Probe | Result | Elapsed | UTC response time | Fly request ID |
| --- | --- | --- | --- | --- |
| Authenticated `/healthz` wake | 502, empty body | 38.502 s | 03:40:47 | `01M2S9K9K2RHKYEH1DM1Z9QQR6-sin` |
| Public runner source read | 502, empty body | 37.824 s | 03:44:27 | `01M2S9T16QAZPP8767XG6YVC7V-sin` |

Checkpoint listing timed out without response bytes. The original upgrade
task exhausted eight attempts; further standard repair attempts also failed
on provider file writes. This suggests a provider-side stuck/unwakeable
Sprite, but does not prove a particular host, storage or file-descriptor
fault. The [Fly staff recovery precedent](https://community.fly.io/t/cant-reach-unwakeable-sprites/28240)
has similar symptoms; its underlying diagnosis must not be assumed here.

This is an assigned customer Sprite, not unused pool inventory. Its spare
record's original release/checkpoint are historical preparation metadata,
not evidence that tenant state may safely be discarded.

## Provider support draft — not sent

Subject: Assigned Sprite cannot wake; authenticated HTTP and filesystem return 502

Hello Fly/Sprites support,

Please investigate and recover Sprite
`aisar-p-aa39ec7b8d8e447a8560e8b8d012600d` in organization `aisar`
(ID `sprite-7b31b207-534d-4c94-b950-292bf477ebb4`). Metadata is reachable
and reports cold, but authenticated HTTP wake and filesystem access return
empty 502s after approximately 38 seconds. Checkpoint listing also times
out. Other Sprites are reachable with the same credentials.

On 2026-09-18, the wake response at 03:40:47 UTC had request ID
`01M2S9K9K2RHKYEH1DM1Z9QQR6-sin`; the public-source file read at 03:44:27
UTC had request ID `01M2S9T16QAZPP8767XG6YVC7V-sin`.

This resource holds customer state. Please preserve its disk and all
checkpoints. Do not delete it, replace it or restore an older checkpoint
without our explicit agreement. Can you recover its ability to wake and
confirm the underlying cause?

## Recovery boundaries

No Sprite was deleted, replaced, restored, made public or hand-patched.
No customer messages, credentials, screenshots or typed input were collected
for this note. No provider ticket/email/forum post was sent.

Use the organization's verified support route from the Fly dashboard if
available, or the community forum, as described in
[Fly's support instructions](https://fly.io/docs/about/support/).
Do not guess an organization-specific support email address.

After provider recovery and the bootstrap correction, use authenticated
readiness checks and the standard release/drift-sweep/fleet-verification
workflow. Do not manually mark the runtime ready or exclude it from the
fleet merely to make deployment verification pass.
