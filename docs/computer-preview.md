# Read-only task browser preview

The authenticated `/api/browser` preview and preview-stream actions require `browser.control`
permission (owner), a trusted Origin and a tenant-owned active run. The Worker
resolves the runtime task ID; callers cannot choose a machine or task ID.
The runner checks the active task before and after capture. Preview never
claims control, starts a browser, changes viewport, or writes image files.

Frames are opt-in, memory-only and `private, no-store`. The remote repository
opens a streamed POST (NDJSON), independently of the chat transport. The runner
samples validated JPEG frames with a one-second minimum capture gap, rather
than the UI making a new HTTP screenshot request every eight seconds. This is
a low-frame-rate browser feed, not a 30fps video or desktop/VNC implementation.
The runner observes new tabs and main-frame navigation to follow browser work.

Viewer leases last 45 seconds, then reconnect through fresh owner/tenant/run
authorization. The Worker has a 55-second upper bound and sanitizes every frame.
The client aborts after 12 seconds without a frame/status. It backs off and
offers explicit retry after three transport failures. A runtime permits one
viewer at a time; backpressure prevents screenshot queues. Closing a viewer
does not cancel, extend or otherwise control the underlying task.

Collapse, hidden/offline state, privacy, inactive-task and access-denial events
clear images. A transient disconnect retains the last safe frame explicitly
labelled as reconnecting, with its capture timestamp. Returning online/visible
reconnects immediately. Frames never enter chat replay history or localStorage.
The older one-shot preview endpoint remains available for existing clients.
DOM privacy checks have independent one-second timeouts and capture has a
three-second timeout. Reconnection attaches only to the existing browser.

Privacy filtering rejects non-HTTPS, query/hash URLs, login/payment/account
URL patterns, form fields, editable content and embedded frames. Checks run
before and after capture; navigation or owner takeover discards the image.
This is conservative best-effort filtering, not a guarantee that every
sensitive screen is recognized. Owners are warned in the viewer. It is not
a full desktop or terminal feed.

## Durable Object decision

Existing `RunStream` Durable Objects already coordinate run event delivery.
Screenshots must not be added to their replay history or persistent storage.
The tenant's single runner owns capture serialization, viewer leases and
throttling. A second coordinator is unnecessary for the single-owner stream.
If multiple viewers need synchronized frames,
consider an owner-authorized ephemeral broadcast lane, with fresh permission
checks, no replay or persisted images, and bounded viewer leases. Never use
preview polling or Durable Object alarms to extend a task's execution budget.

## Release

Requires runner, Worker and web releases; deploy runner support first. Provision
assets include browser-preview-stream.mjs; do not deploy the importing server
without that file. Old runners reject streaming and the UI displays unavailable. Verify a
real owner task browsing a public page, a blocked login page, task completion,
tab hiding and takeover before enabling broadly. Run the isolated real-browser
transport smoke with `BROWSER_SMOKE=1 BROWSER_SMOKE_CHANNEL=chrome node --test
runner/test/browser-preview-smoke.test.mjs`. It checks changing image bytes,
login suppression and task completion over HTTP without touching customer
browser profiles. This does not replace an authenticated production UI test.

The deadline regression test now makes completion observable before admission
returns. Its previous 100ms fixture could expire before completion was set.
Production run deadlines, including the quick-task cap, are unchanged.
