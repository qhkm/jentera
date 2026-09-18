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
