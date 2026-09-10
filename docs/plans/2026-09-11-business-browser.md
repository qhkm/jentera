# Managed business browser

One persistent Chromium profile per business Sprite. Hermes attaches through
loopback CDP; customers never receive a CDP URL, runner key, cookie export, or
Sprite credential. Owner control is exposed through authenticated Jentera
requests carrying bounded screenshot/input commands, not an arbitrary proxy.

## First slice

- My Business → Connections → Business browser.
- Owner-only takeover once the current agent run finishes. No interruption of
  an in-flight external action. The runner serializes takeover with task admission.
- Owner can navigate HTTPS sites, choose a tab, click, type, scroll, and send
  basic navigation keys. Password entry is sent directly to the browser, never
  placed in chat, application storage, audit events, or logs.
- An exclusive, short-lived controller lease binds one tab to one owner. A
  disconnected/expired controller leaves the agent paused; only an explicit
  hand-back allows new agent work. The paused state survives runner restart.
- Screenshots are transient, owner-only, no-store; no recordings. The browser
  profile remains private on the business Sprite. Login validity still depends
  on the destination service; MFA and reauthentication may recur.
- Hermes and the owner use the same loopback browser. Agent instructions
  explain the handoff and must not claim login succeeded without verification.

Not included: laptop browser pairing, importing personal Chrome profiles,
file uploads/download UI, passkey forwarding, audio/video, or a public CDP port.
Browser automation does not bypass site policies or existing action approvals.

## Release / verification

Runner assets and bootstrap configuration ship together through ship-runtime.sh.
Test controller isolation, expiry, restart safety, task-admission exclusion,
owner/tenant authorization, invalid inputs, and persistent-profile handoff.
No database migration or browser-session localStorage key is required.

Local real-browser smoke (uses a temporary profile and ephemeral CDP port,
never the owner's existing Chrome session):

```sh
BROWSER_SMOKE=1 BROWSER_SMOKE_CHANNEL=chrome node --test runner/test/business-browser-smoke.test.mjs
```

The navigate allowlist rejects non-HTTPS schemes and common private-address
literals. It is not a network firewall or DNS-rebinding defense; browser page
traffic retains the business Sprite's network permissions. No broader network
isolation is claimed by this feature. Before release, run the same handoff
against the pinned Hermes browser tools on a canary Sprite, including a real
service's login/MFA flow. Local tests use synthetic site state, not customer
credentials. Laptop pairing remains a separate feature.

### Kitakod startup regression (11 September)

The explicit `--remote-debugging-address=127.0.0.1` flag hung Chromium's
persistent launch on Kitakod's Sprite, although the original canary passed.
Removing only that flag made the same synthetic handoff/restart test pass
repeatedly in about 1.3–1.5 seconds. Keep Chromium's default loopback binding;
the Linux smoke now asserts the actual CDP socket is loopback-only via procfs.
Do not substitute a wildcard bind. Include Kitakod in future browser canaries.
