# Watching the agent work — a view-only desktop

The desktop viewer already exists: x11vnc on the sprite's `:99`, a private UNIX
socket, an HMAC ticket through Sprites' authenticated proxy, noVNC in the app.
It is wired as a **takeover**. `desktopControlValid` requires a durable owner
pause and a live control lease, so the only way to see the desktop today is to
stop the agent.

This adds a second mode beside it. An **observe** session injects nothing, so it
needs neither the pause nor the lease, and it can run while the agent works.
The existing control mode is unchanged.

## Why the page preview is not enough

The live-while-working surface today is `ComputerPreview` — a JPEG of the
current Chromium page behind a privacy filter. Measured 23 September:

- The filter's URL half refuses any `?query`, so **every search-engine result
  page is hidden**. Six of twelve realistic research URLs were refused before
  the page loaded.
- Its DOM half refuses a page containing any `input, textarea, select, iframe,
  frame, [contenteditable], [autocomplete]`. A Wikipedia article is hidden by
  the sidebar's `input[type=checkbox]`; `smecorp.gov.my` by a single
  `input[type=hidden]`. Of the pages tried, only `mdec.my`'s homepage passed
  both halves.
- It is also not the cheap option it looks like. A real content page at the
  sprite's actual `1280x800` geometry, JPEG quality 45 — the values in the
  code — is **125.5 KB**. At the 8-second fallback cadence that is **55.2 MB
  an hour, paid whether anything changed or not**, and the frame is up to
  eight seconds stale. The streaming path (`browser-preview-stream.mjs`,
  100 ms poll) sends a *full* frame per change, so active browsing is far
  worse.

RFB sends changed rectangles. An idle desktop — which is most of a run, while
the model thinks — costs close to nothing. That is the reason to prefer it, not
a general preference for streams.

## The slice

- The "Preview computer" control under a running task opens a **live, read-only
  desktop** when the business is eligible and the runner advertises
  `desktopView`. Everything the agent sees: headed Chromium, tabs, the Linux
  taskbar.
- **The screenshot preview stays** as the fallback, unchanged, for every
  business and every case where observe is unavailable, ineligible, latched or
  refused. Nothing is removed.
- Observe requires no pause and no lease. The agent keeps working.
- Owner only, same as control: `can(identity, 'browser.control')` plus
  `desktopEnabledFor`. Staff never reach it.
- Scope stays the pilot list. `DESKTOP_VIEW_BUSINESS_IDS` holds one business
  and is capped at ten with no wildcard; this does not widen it.

Not included: input of any kind from an observe session, clipboard, audio,
recording or persistence of frames, a second concurrent viewer, fleet-wide
enablement, or any change to the control mode's pause and hand-back contract.

## Ticket contract

The separation is the ticket `purpose`, which the HMAC covers, not a flag a
later edit can flip:

```
control  { purpose: 'jentera-desktop-v1',         businessId, ownerId, controlId, nonce, issuedAt, expiresAt }
observe  { purpose: 'jentera-desktop-observe-v1', businessId, ownerId, runId,     nonce, issuedAt, expiresAt }
```

An observe ticket therefore cannot be replayed as a control ticket, and a
control ticket cannot be presented to the observe path. `controlId` is absent
from an observe ticket because there is no lease to name; `runId` records what
is being watched and is validated as a UUID, nothing more.

Observe tickets keep the existing single-use `nonce`, the `seen` replay map and
the same bounded TTL. Reconnection re-mints through an authenticated Worker
request exactly as control does.

## Runner (`runner/src/desktop-gateway.mjs`)

- `openDesktop({ viewOnly })` adds `-viewonly` to the x11vnc argument list.
  x11vnc discards client input itself; this is not the gateway choosing not to
  forward.
- **Client bytes still flow, and must.** RFB is two-way for its whole life:
  the protocol handshake, `SetEncodings` and every `FramebufferUpdateRequest`
  travel client to server, and noVNC's own `viewOnly` suppresses key and
  pointer *events* while still driving the protocol. A gateway that dropped
  client bytes would never deliver a frame. `-viewonly` is therefore the
  single enforcement point, in x11vnc, which processes those messages and
  discards `KeyEvent` and `PointerEvent`. An earlier draft of this plan
  claimed a second lock at the byte level; that is not implementable without
  an RFB message parser, and was removed rather than left as a comfortable
  fiction. The existing byte-rate cap still applies, and an observer never
  touches a control lease because there is none to extend.
- An observe session validates the ticket signature, purpose, expiry and nonce,
  and `config.desktopEnabled`. It does **not** call `desktopControlValid` or
  `touchDesktopControl`.
- Teardown for observe stops the process and unlinks the socket, and **skips
  `desktop-release-keys.py`**. Nothing was injected, so there are no keys or
  buttons to release. This is deliberate: that script's failure is what latches
  `cleanupBlocked`, and a latched gateway is indistinguishable from a disabled
  one (see `docs/desktop-streaming.md`, 21 September). Observe cannot latch it.
- Concurrency is unchanged in shape: one `viewer` at a time. Observe is refused
  while the browser is paused or controlled, and the existing
  `onControlChanging(disconnect)` drops a live observe session the moment an
  owner takes control.

## Worker (`worker/src/routes/browser-desktop.ts`, `runtime/desktop.ts`)

- A separate path, `/api/browser/observe`, rather than a mode on the existing
  one, so a control request can never become an observe request by editing a
  header. Two registrations neither route's own tests can see:
  `Access-Control-Allow-Methods` in `index.ts`, and the `runStream`
  classification in `request-guard.ts:165`, which is what puts a long-lived
  socket in the run-stream rate-limit bucket instead of the general one.
  `test/cors.test.ts` scans the routes.
- Its own subprotocol, `binary, jentera-observe.<runId>`, parsed by a sibling
  of `desktopControlProtocol` that rejects the `jentera-control.` prefix
  outright. A control subprotocol on the observe path is a 400, and the
  reverse likewise.
- Same gates as control except the lease: exact allowed `Origin`, verified
  session, resolved tenant, `can(identity, 'browser.control')`,
  `desktopEnabledFor`, no query string.
- Same Sprites proxy call, same server-side token, same 8 MiB/s and 64 MiB
  output bounds, same close-on-overflow.

## App (`ComputerPreview.tsx`, `DesktopViewer.tsx`)

- `ComputerPreview` asks whether observe is available. If it is, it mounts
  `DesktopViewer` with noVNC `viewOnly: true` and no control affordances —
  no keyboard bar, no clipboard, no take-control button.
- If it is not, the existing screenshot preview renders exactly as now,
  including every current `previewStatus` message.
- A failed or refused observe connection falls back to the screenshot rather
  than showing an error, and says which one is being shown.

## The privacy decision, recorded

The screenshot path's filter exists to avoid putting a login page, a checkout
or a filled form into a frame. **A desktop stream has no such filter and cannot
have a useful one** — it shows the screen, including a vault-filled password
mid-type and any signed-in session the agent is using.

That is accepted here, deliberately and for the pilot business only, because
watching the agent work is the point of the feature and the frames stay
owner-only, memory-only and unrecorded. It is a reduction in a control that was
built on purpose. Widening `DESKTOP_VIEW_BUSINESS_IDS` is a separate decision
and should be taken with this paragraph in front of whoever takes it.

The page-level privacy filter is *not* changed by this plan. It remains
over-broad — the measurements above stand — and fixing it is worth doing on its
own merits for the fallback path. Tracked separately.

## Delivery order

1. Runner gateway and `openDesktop` change, with tests, on main.
2. `ship-runtime.sh -m "…"` pins that commit, bumps `RUNTIME_RELEASE`, runs the
   gate and deploys the Worker at step 4. The Worker route ships in that same
   release, so the app never calls a route the fleet cannot serve. That release
   also carries the pending `AISAR_KEEPALIVE_GRACE_HOURS` 0 -> 1 change.
3. `deploy.sh` for the app, last — the fallback means an app that shipped early
   would simply keep showing screenshots.

No new bootstrap transfer field, so the pin-ordering rule in `CLAUDE.md` does
not bite here. `-viewonly` is a runner-side argument carried by the bundle.

## Acceptance gate

- Observe opens on the pilot business **while a task is running**, with the
  agent never pausing: `run.status` stays `working` throughout.
- Keyboard and pointer events from the viewer change nothing on the sprite,
  verified with x11vnc `-viewonly` in place *and* with the gateway's input drop
  independently exercised.
- Taking control while observing drops the observe session and enters the
  existing control flow unchanged; hand-back still clears the durable pause.
- An observe session that ends — cleanly, by close, or by timeout — leaves no
  x11vnc process, no socket, and `cleanupBlocked` false. Assert the flag is
  untouched after a forced teardown.
- A control ticket presented to `/api/browser/observe`, and an observe ticket
  presented to the control gateway, are both refused.
- Staff and non-eligible businesses receive the screenshot fallback, never a
  403 that reveals the pilot.
- Sprite CPU during a 10-minute observe session recorded on the canary before
  any widening. x11vnc polls the framebuffer; the cost is unmeasured.

## Open

- **CPU on a small sprite** is the real unknown. If framebuffer polling
  measurably slows the agent, the answer is to cap observe duration or fall
  back, not to widen the pilot.
- **Bandwidth is expected to beat the JPEG path but is unmeasured.** The claim
  in this document is about the encoding, not a figure. Record a real number
  from the canary and put it here.
- Whether observe should auto-open when a task starts, or stay a click. A click
  to begin with; an always-on stream per run is a cost decision, not a UI one.
