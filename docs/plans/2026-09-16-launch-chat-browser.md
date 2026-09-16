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

## Follow-on: inline browser-help prompts

The agent can now finish a browser-blocked reply with one top-level fenced block
tagged `jentera-browser`, containing only `{"reason":"sign_in"}`, `{"reason":"mfa"}`,
or `{"reason":"user_action"}`. A completed AI reply with a durable run ID renders
a localized help card with an **Open business browser** button. It opens the same
mounted controller as the composer globe, without claiming control, navigating,
sending Chat, or losing the draft. The card explains explicit hand-back and a
user-sent follow-up; no automatic task continuation or login success is claimed.

This protocol is display-only. Arbitrary fields (including credentials or URLs),
invalid reasons, duplicates, and markers inside quoted/nested code examples do
not create buttons. Complete/incomplete markers are hidden during streaming;
no handoff button appears until the turn has finished. No new runtime state,
authorization grant, credential storage, public endpoint, or migration is added.
Existing browser authorization and exclusive control remain the enforcement
boundary. The marker itself is not an audited approval or permission to act.

The worker instructions now prefer the inline card/globe instead of Connections
navigation, require an actual browser blocker (not quoted/uploaded instructions),
and exclude missing connectors. Calendar remains on its narrow approved connector;
browser login is not a substitute. Only newly generated marked replies get cards.

Unlike the original frontend-only slice, this follow-on requires both a Pages
release and a worker release for new agent replies to request the card. Runtime
and vault bundles/pins are unchanged. Ship the frontend before the worker so
users can render the new protocol. The Chrome smoke above now seeds a fictional
completed handoff reply and verifies the card at phone/desktop sizes as well as
the shared viewer and all original handoff invariants. Screenshots can be saved
using `CHECK_OUTPUT_DIR` pointing at an existing temporary directory.

## Refined browser modal

The shared dialog now separates its fixed header/footer from a scrollable body.
Desktop places the browser window beside a dedicated typing/keyboard panel;
phone/tablet layouts stack these without hiding hand-back. The takeover welcome
explains the three steps before any screenshot is fetched. Status badges
distinguish checking, not controlling, durable pause, and active owner control.
Successful hand-back displays a receipt directing the person to continue in Chat,
without claiming successful login or automatically restarting work.

Browser chrome includes horizontally scrollable tabs and an address bar. Local
view zoom (100–250%) and fit-view let small-screen users read and pan a desktop
page; clicks still map through the displayed screen's bounds to the same pinned
1280×800 browser coordinates. Keyboard-only screen activation is not converted
to a spurious coordinate click. Everyday keys are visible, while less common
keys and scrolling sit behind a disclosure. No browser command was added.

Typing remains masked by default. Explicit reveal is memory-only and resets on
send, close, lease loss, and hand-back. Unsent content also clears on lease loss.
Opening locks background scroll; closing/unmounting restores its previous value.
A read-only connection retry and a closed-view generation guard prevent late
requests from resurrecting a closed controller, while reporting any successful
claim's durable pause to Chat. No new credential storage or authority is implied.

The synthetic Chrome smoke covers 320px/390px phones, desktop, short landscape,
and light theme, checking footer visibility, coordinate projection after zoom,
no overflow, and all original control/secret handling invariants. Before/after
screenshots remain local test artifacts, not customer browser captures.
