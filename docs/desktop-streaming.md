# Business desktop streaming pilot

Implemented behind disabled-by-default gates. This is **not deployed or enabled
for customers**. The current page-only Business Browser remains the fallback.

The viewer shows actual headed Chromium tabs, navigation controls and the Linux
taskbar; it is not an iframe, screenshot of a fake Chrome frame, or a new agent
`computer_use` capability. The agent continues using the same CDP port and
persistent business profile.

## Boundary and controls

The browser connects to `/api/browser/desktop` over WSS with its HttpOnly session
cookie. The Worker requires an exact allowed Origin, verified session, resolved
tenant, owner permission and explicit business pilot eligibility. The only
client selector is an existing window control UUID in the WebSocket subprotocol;
query parameters, arbitrary targets and additional protocols are refused.

The Worker opens Sprites' authenticated WebSocket/TCP proxy to **localhost:5901**.
Provider credentials remain server-side. A purpose-bound HMAC ticket containing
server-resolved business/owner/window identity is delivered only inside that
tunnel. Tickets are single-use, expire within one minute, and are never returned
to the frontend, placed in URLs or persisted.

The loopback runner gateway separately verifies the signature, exact live lease
and durable owner pause before starting one x11vnc process. Raw VNC uses a
mode-0600 UNIX socket, not an exposed TCP listener. Lease checks run for every
input chunk and every 250ms. Input, messages, handshakes, admitted output and
connection lifetime are bounded; the Node TCP path uses stream backpressure.
Worker WebSockets do not provide application backpressure, so output is bounded
to 8MiB/second and 64MiB per minute-long connection, closing on overflow.

Each minute the viewer reconnects using a fresh authenticated Worker request and
new ticket. It does not claim/reclaim control, replay keys/text, or resume the
agent. Two brief failed retries return the user to explicit Take control.

## When the desktop quietly stops being offered

A failed teardown latches `cleanupBlocked` in `desktop-gateway.mjs`, which is
deliberate: it refuses every later desktop stream rather than risk a half-
released keyboard on a browser holding the business's live sessions.

It is hard to recognise, because nothing names it. The flag is in memory and
unexported, and the only symptom is `desktopView` disappearing from
`/v1/browser` status — `status()` emits that field only when
`config.desktopEnabled && desktopReady()`, and `desktopReady` is
`server.listening && !closing && !cleanupBlocked`. So a latched gateway looks
exactly like a disabled one, and on 21 September it was first read as a
configuration mismatch between the worker and the sprite.

**Check the two terms you can see before assuming the third.** If
`AISAR_DESKTOP_VIEW=1` is in `runtime.env`, in the runner process's own
environment (`/proc/<pid>/environ`) and on the `x11-display` service, and
`127.0.0.1:5901` is listening, then `closing` is false and the latch is the
only term left.

Clearing it is the reviewed runtime recovery the design asks for, and in
practice that is restarting the runner so the flag resets:

```bash
sprite-env services restart aisar-runner
```

What that costs, measured on Kitakod: the durable pause survives, because it
is a file; the owner's control lease does not, because it is in memory, so
they must take control again. Chromium is replaced rather than reattached —
the PID changed — but the profile is on disk, so every signed-in session
survives the new process.

Hand-back/recovery waits for the old VNC process to exit and verifies native X11
key/button release before changing the lease or clearing the durable pause.
Cleanup failure blocks hand-back and further desktop streams until reviewed
runtime recovery; it must not be bypassed by clearing the pause file.

Closing the modal, disconnecting or allowing the lease to expire **does not
resume Jentera**. Only explicit Hand back does. Clipboard synchronization is
disabled in both directions. Keyboard/paste input is ephemeral, masked and
cleared immediately; pasted newlines do not submit website forms.

This is full owner access to the tenant's computer, not field-bound DOM typing.
An owner can use native browser/OS controls, change their own files, or inspect
their own runtime. It does not create a stronger security boundary between
processes sharing the tenant VM/UID, or replace the separate credential vault,
action approvals and audit controls. Do not advertise it as bypassing Google
OAuth verification, bot detection, or website security restrictions.

## Gates and migration

- Worker: `DESKTOP_VIEW_ENABLED=true` **and** `DESKTOP_VIEW_BUSINESS_IDS` containing
  the server business UUID. The list is strict, maximum ten entries, no wildcard.
- Bootstrap: only eligible businesses receive `DESKTOP_ENABLED_B64=MQ==`.
- Runner: bootstrap writes `AISAR_DESKTOP_VIEW=1` only after an isolated headed
  **sandbox-enabled** Chrome/RFB/native-cleanup smoke passes. Missing sandbox or
  OS dependencies fails closed; never add an automatic `--no-sandbox` fallback.
- Readiness: the runner advertises `desktopView:1` only when its gateway is ready,
  and the Worker relays it only to eligible owners.

Bootstrap installs Xvfb/Openbox/dbus, tint2, x11vnc, xauth, Python and XTEST from
the OS package manager and starts the supervised display before Hermes/runner.
CUA/driver attestation stays independently gated. Hermes remains pinned to
`v2026.9.8` at `ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413`.

After explicit owner claim has durably paused the agent, the runner can migrate
headless/unsandboxed Chrome only if its command line proves the **exact existing
business profile**. CDP command-line inspection has a bounded Linux `/proc`
fallback. Ambiguous/wrong-profile identification refuses migration. Chrome is
closed normally and reopens the same profile with session restore; the previous
business page is brought forward instead of the new empty startup tab. Saved
cookies/localStorage were verified with synthetic data, not customer logins.

## Local verification

No cloud credentials, model calls, customer profiles or cloud provisioning are
needed. QA entrypoints are not production build inputs/assets.

```bash
docker build -t jentera-desktop-test:2026-09-17 \
  -f runner/qa/desktop-linux/Dockerfile runner/qa/desktop-linux
docker run --rm --init --name jentera-desktop-qa-20260917 \
  --security-opt seccomp=unconfined -p 127.0.0.1:3980:3980 \
  --mount type=bind,source="$PWD/runner",target=/workspace/runner,readonly \
  --mount type=bind,source="$PWD/app/node_modules",target=/workspace/app/node_modules,readonly \
  jentera-desktop-test:2026-09-17
# In separate terminals:
cd worker && pnpm exec wrangler dev --config test/desktop-transport.wrangler.json
cd app && pnpm exec vite --config qa/vite.config.ts
cd app && CHROME_CHANNEL=chrome node scripts/check-desktop.mjs
```

The disposable container runs Chrome as non-root. The test-only seccomp override
allows its nested Chrome user namespace; it is **not production deployment
advice**. Sprites must pass the sandbox smoke with their ordinary privileges.
The local Sprites proxy is a protocol fixture; real Sprites proxy compatibility,
VM wake/restart behavior, Linux x86_64 and physical iOS/Android keyboards still
require a controlled canary check. Responsive emulation is not device testing.

## Release and rollback

1. Review and commit/push the complete frontend, Worker and runner asset bundle.
   Do not deploy this Worker with the old `RUNTIME_BUNDLE_COMMIT`: new mandatory
   runner assets and the new transfer field require a matching published bundle.
2. Follow [the release playbook](release-playbook.md), with desktop flags **off**
   initially. Keep Hermes unchanged and verify the legacy fleet baseline.
3. Enable only an operator-owned test business, with a reviewed runtime upgrade
   using the published matching bundle. A global runtime release can upgrade
   other runtimes too; eligibility must remain owner-only, not fleet-wide.
4. Verify actual Sprites WSS auth/proxy, sandbox, loopback ports, saved session,
   direct typing/drag, ten-minute renewal, stale-window rejection, durable pause,
   physical mobile typing and explicit hand-back. Inspect logs for sensitive
   payload leakage without copying those payloads into diagnostics.
5. Expand only after the canary passes. Do not turn on agent CUA as a side effect.

Emergency disable: turn the Worker pilot flag off; existing connections are
bounded to one minute and the next handshake is refused. This keeps the pause,
does not hand the browser back, and does not delete a profile. Removing a flag
does not update existing runtime OS services automatically. Use the standard
reviewed runtime rollback to remove the desktop gateway/display; preserve the
browser profile and pause state. Never kill the display beneath an actively
controlled session or reset `browser-control.json` to force a recovery.

References: [Sprites TCP proxy](https://sprites.dev/api/sprites/proxy),
[noVNC API](https://github.com/novnc/noVNC/blob/master/docs/API.md),
[Cloudflare WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/).
