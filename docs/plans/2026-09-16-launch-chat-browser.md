# Launch slice: browser handoff from Chat

Implemented 16 September 2026. Frontend-only change; no new credential provider,
database migration, runner bundle, or authorization boundary.

Chat now opens the existing managed business-browser dialog directly from a
compact globe tool in the existing composer row. The paused notice opens that
same controller instead of sending the owner through Connections. The composer
height and mobile row count are unchanged.

The owner waits for the current agent task to finish, takes exclusive browser
control, signs in or completes MFA in the browser, explicitly hands it back,
closes the dialog, and continues in Chat. Closing without hand-back keeps the
durable pause and disables sending. Existing expired-session recovery remains
available. Opening a viewer alone neither claims nor releases control.

The shared dialog is portaled outside the composer; its submit events are also
stopped at the dialog because React portal events still bubble through their
logical parent. Browser navigation/typing must never submit a Chat draft. Typed
input and screenshots remain memory-only and are cleared on close. No CDP URL,
cookie export, runner credential, or new vault reveal capability is exposed.

This is a manual handoff MVP, not automatic in-chat browser intervention. It does
not add a destination-site credential vault, passkey forwarding, site-specific
approval enforcement, a browser network firewall, or a claim that every browser
action is gated. Existing runtime/connector approval limits still apply. The
Telegram direct-deposit vault remains a separate, narrower boundary.

Verification: full frontend suite, typecheck/build, native sync/typecheck, and
fictional API real-Chrome smoke at 390px/1440px. The smoke covers direct opening,
exclusive controller ID reuse, no Chat submission by browser forms, empty input
after typing, secret-free localStorage, pause on close, explicit hand-back, draft
preservation, no horizontal overflow, and no page exceptions. No real customer
credential or third-party login is used by the smoke.

```sh
cd app
VITE_API_URL=http://127.0.0.1:5183 pnpm dev --host 127.0.0.1 --port 5183
# In another terminal:
CHROME_CHANNEL=chrome node scripts/check-chat-browser.mjs
```
