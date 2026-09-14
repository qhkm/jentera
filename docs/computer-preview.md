# Read-only task browser preview

The authenticated `/api/browser` preview action requires `browser.control`
permission (owner), a trusted Origin and a tenant-owned active run. The Worker
resolves the runtime task ID; callers cannot choose a machine or task ID.
The runner checks the active task before and after capture. Preview never
claims control, starts a browser, changes viewport, or writes image files.

Frames are opt-in, memory-only and `private, no-store`. The UI clears frames
on refresh, collapse and visibility loss, aborts outstanding requests, and
stops polling on an inactive response. Worker requests are limited to eight
seconds, client requests to twelve. Runner capture is single-flight with a
five-second minimum gap. DOM privacy checks have independent one-second
timeouts and screenshot capture has a three-second timeout.

Privacy filtering rejects non-HTTPS, query/hash URLs, login/payment/account
URL patterns, form fields, editable content and embedded frames. Checks run
before and after capture; navigation or owner takeover discards the image.
This is conservative best-effort filtering, not a guarantee that every
sensitive screen is recognized. Owners are warned in the viewer. It is not
a full desktop or terminal feed.

## Durable Object decision

Existing `RunStream` Durable Objects already coordinate run event delivery.
Screenshots must not be added to their replay history or persistent storage.
For this first version, the tenant's single runner owns capture serialization
and throttling. A second coordinator would add latency without solving a
current ownership problem. If multiple viewers need synchronized frames,
consider an owner-authorized ephemeral broadcast lane, with fresh permission
checks, no replay or persisted images, and bounded viewer leases. Never use
preview polling or Durable Object alarms to extend a task's execution budget.

## Release

Requires runner, Worker and web releases; deploy runner support first. Old
runners reject the preview action and the UI displays unavailable. Verify a
real owner task browsing a public page, a blocked login page, task completion,
tab hiding and takeover before enabling broadly. Unit tests use fake screens;
they do not demonstrate capture compatibility on the production machine.

The deadline regression test now makes completion observable before admission
returns. Its previous 100ms fixture could expire before completion was set.
Production run deadlines, including the quick-task cap, are unchanged.
