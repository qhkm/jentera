# Google Workspace CLI in Jentera

Implemented: 18 September 2026. This is a Calendar-first integration, not
authorization for Gmail, Drive, or every Workspace API. Upstream is
[googleworkspace/cli](https://github.com/googleworkspace/cli), pinned to 0.22.5.
It is not an officially supported Google product.

## Boundary

`gws` is the real upstream binary. `jentera-gws` is Jentera's managed adapter:
it runs `gws ... --dry-run` to prepare the request using Google's discovery
schema, checks the method and primary-calendar URL, and invokes the existing
tenant-bound Calendar gateway. It does **not** run authenticated upstream
requests or pretend to be a replacement implementation of the entire CLI.

Google OAuth access/refresh tokens remain in the control plane. Listing events
is a bounded read. Inserting an event creates the existing idempotent approval
proposal, not a Calendar event; only the owner's approval path mutates Google.
Runtime reads also honor the owner's read policy: blocked or approval-only reads
are refused before loading credentials (there is no read-approval workflow yet).
Unsupported arguments are rejected rather than silently discarded. No generic
Google proxy, token-export endpoint, local OAuth callback, or credential transfer
is introduced. The raw binary is useful for help/schema/dry-run but must not be
given Google credentials on a customer Sprite.

## Managed commands

```sh
jentera-gws auth login
jentera-gws calendar events list --params '{"calendarId":"primary","timeMin":"2026-09-18T00:00:00+08:00","timeMax":"2026-09-19T00:00:00+08:00"}'
jentera-gws calendar events insert --params '{"calendarId":"primary"}' --json '{"summary":"Supplier call","start":{"dateTime":"2026-09-18T10:00:00+08:00","timeZone":"Asia/Kuala_Lumpur"},"end":{"dateTime":"2026-09-18T10:30:00+08:00","timeZone":"Asia/Kuala_Lumpur"}}'
```

Add `--dry-run` to preview a Calendar request without reading business data or
creating an approval. Reads require timeMin/timeMax spanning at most 31 days.
Only primary-calendar timed events, summary, location and description are
supported; attendees, all-day events, recurrence, conferencing and mutation
methods other than proposing an insert are not supported yet.

The login command returns the existing owner-facing Jentera OAuth start URL.
The owner opens it in their normal browser, signed into the same Jentera account,
completes Google consent, and returns to Chat. A returned URL is not proof of a
connection, event approval, or automatic task resumption. Google app verification
is still necessary for public sensitive-scope access; CLI installation does not
change that. Existing accounts do not need reconnecting merely to use this adapter.

Both Calendar CLIs recover only missing model-transport variables from Hermes'
bootstrap-owned `.env`, without evaluating it as shell. This addresses a terminal
environment failure mode; it is not a claim to have diagnosed every production
"unavailable" response.

## Installation and rollout

`install-gws.sh` downloads the version-pinned Linux release, verifies both archive
and binary SHA-256, and reuses only a binary with the exact expected hash. It
supports x86_64/aarch64. Bootstrap installs shared public bytes before sealing
a spare so the claim phase does not download gws. No additional bootstrap secret
or transfer field is required.

Ship runner changes through `worker/scripts/ship-runtime.sh` and verify the fleet;
a Pages-only deploy cannot install this. The new prompt includes legacy
`jentera-calendar` fallback during convergence. After shipping, verify one owner
login, an event read, a pending proposal, refusal before approval, and final
creation after approval using a dedicated test Calendar. Local request preparation
and mocked gateway tests alone do not prove a live Google account works.

## Production deployment: 18 September 2026

- Runtime target: `2026.09.18-6`; bundle
  `f34c88b028eb28aaa9f0da26fccbc3a6ae61ec7f`; release commit
  `d7b99a9ff677555f78eb111bd78db61891193666`.
- Worker version: `456eece9-ea03-4507-8310-76ee0dcad729`.
  `/api/health` returned HTTP 200 after deployment.
- The standard release gate passed, including 46 bootstrap contract tests,
  public asset availability, Hermes pin resolution and transfer compatibility.
- The preceding bundle omitted `browser-recipes.mjs`, which `business-browser.mjs`
  imports. Production error classification confirmed this failure. Commit
  `f34c88b` supplies the dependency and adds a regression test checking the module
  graph and matching assets in both provisioning paths. Release `-6` supersedes
  the initial gws release `-5`; no Sprite was patched by hand.
- Real installed CLI/version, managed Calendar request preparation and
  normal-browser setup-link checks passed on all 24 tenant Sprites.
- After queued upgrades drained, all 24 runtime records reported the desired
  and observed release `2026.09.18-6` with status `ready` at 05:27 UTC.
  A fresh full-fleet verification passed 24/24: on-disk and serving release,
  Hermes dependency checks, and both runtime services running. Earlier checks
  caught a transient service restart; the settled check supersedes those results.
- A bounded real Calendar read passed on the founder's Kitakod Ventures runtime.
  Event contents were not printed or logged; no event or proposal was created.
  Live event-approval execution and a new browser consent remain separate tests.
- Unassigned inventory still contains two obsolete never-assigned spares from
  `2026.09.17-4`, quarantined after provider-unavailable retirement attempts.
  Read-only provider metadata confirms both still exist. They were not deleted,
  retired, assigned, or counted as current-release ready inventory. Cold
  provisioning remains available; the spare replenishment gate is not passed.
