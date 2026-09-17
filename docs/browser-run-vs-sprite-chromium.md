# Jentera Computer: Cloudflare Browser Run vs the sprite's own Chromium

Recorded: 17 September 2026.
Status: retain the sprite's Chromium for anything logged in or owner-driven.
Browser Run is a good fit for stateless page reads and is worth a pilot there;
nothing here is provisioned or approved.

## Recommendation

**Split the work rather than replace the browser.** Use Browser Run for
stateless jobs — fetch a page, read it, screenshot it — and keep Chromium on
the sprite for the logged-in profile and the owner-driven session.

And set the expectation correctly: **this does not shorten provisioning.** The
72 s `playwright` stage only disappears if the sprite stops needing Chromium at
all, and the business browser prevents that. What the split buys is less work
per stateless job and one less thing to scale, not a faster cold start. If
provisioning time is the goal, the levers are in
[`provisioning-time.md`](provisioning-time.md) and
[the prebuilt-bytes plan](plans/2026-09-17-prebuilt-bootstrap-bytes.md).

## What the sprite's browser actually is

`runner/src/business-browser.mjs` launches Chromium with
`--remote-debugging-port=9222 --restore-last-session`, `chromiumSandbox: true`,
a 1280×800 viewport and a ten-minute lease, against a profile that lives on the
sprite's own disk. Three properties matter, and all three are load-bearing:

1. **The profile persists indefinitely.** The agent signs in to a business's
   tools once and stays signed in across runs, days apart. That is the feature.
2. **The owner drives it directly.** `app/src/routes/views/BusinessBrowser.tsx`
   streams the session and invites the owner to enter passwords and MFA into
   it. Live screencasting shipped in `2026.09.14-3`.
3. **The credentials never leave the machine that belongs to that business.**
   CDP is on loopback; the worker proxies with a sealed runner key and
   deliberately accepts no CDP URL from a caller (`worker/src/routes/browser.ts`).

## What Browser Run offers

Renamed from Browser Rendering in April 2026. Checked 17 September 2026:

| | |
|---|---|
| Concurrency | 120 browsers per account on Workers Paid, raised from 30 on 20 August 2026; limits are defaults and can be raised on request |
| New browsers | 1 per second, raised from 30 per minute |
| Idle timeout | 60 s by default, extendable to **10 minutes** with `keep_alive` |
| Lifetime | No fixed maximum while the session stays active |
| Isolation | Session reuse to cut startup; incognito contexts to isolate cookies and cache |
| Interface | Puppeteer and Playwright APIs through a Workers binding, and a REST API |

## Why it cannot take the logged-in browser

**Ten minutes against weeks.** The profile's whole value is that it outlives
the run. Browser Run's ceiling is a ten-minute idle window, so a logged-in
session would have to be exported and re-imported as `storageState` on every
use.

**That export is the real objection.** It moves a customer's live session
cookies off the machine that belongs to them and through a shared rendering
fleet. Today the answer to "where are my logins kept" is "on your own
computer, and the CDP endpoint is loopback". Afterwards it is "in transit to a
third-party browser pool, per job". That is a different disclosure under
Malaysia's PDPA, not merely a different implementation, and it is the sort of
claim `docs/marketing/product-thesis-and-homepage.md` requires us to be able to
stand behind.

**The screencast would be rebuilt, not simplified.** The owner-driven view
works because CDP sits on loopback next to the browser. Through Browser Run the
same experience means proxying CDP out of a Worker and re-implementing the
streaming, input and lease handling that `business-browser.mjs` already does.
That is a larger surface than the one it replaces.

**The sandbox choice is deliberate.** `chromiumSandbox: true` with a comment
forbidding a silent `--no-sandbox` fallback. Any replacement has to be at least
as explicit about what it runs untrusted pages inside.

## Where it fits, and what that is worth

Stateless work: read a supplier's page, screenshot a listing, check whether a
site is up, scrape a price. No profile, no login, nothing to persist. For those
jobs Browser Run is better than a sprite browser — it starts fast, scales to
120 concurrent against a fleet of 100 sprites, and needs no per-sprite Chromium
upgrade.

The honest accounting of the benefit:

- **Removes a class of per-sprite work**, not a stage of the bootstrap.
- **Removes browser upgrades from the fleet release** for those jobs only.
- **Costs a new dependency** in the reply path, and a decision about what
  happens when Browser Run is unavailable — the sprite browser is the obvious
  fallback, which means keeping both working.

## What would have to be true to go further

Retiring the sprite's Chromium entirely needs a persistent, per-tenant browser
profile with a lifetime measured in weeks, and a way for an owner to drive it
that does not route their password through a shared fleet. Browser Run does not
offer that today. If Cloudflare ships per-tenant persistent profiles, this is
worth re-opening, and the 72 s `playwright` stage and the browser's share of
fleet upgrades both come off at once.

## Pilot and decision gate

1. Pick one stateless tool the agent already uses and route it to Browser Run
   behind a flag, leaving the sprite browser as the fallback.
2. Measure: time per job against the sprite browser, and failure rate.
3. Keep it only if it is faster per job *and* the fallback proves it degrades
   rather than fails when Browser Run is unavailable.
4. Do not extend it to anything that logs in, or anything the owner sees, until
   the persistence question above has changed.

Sources: [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) ·
[Run more headless browsers concurrently, 20 Aug 2026](https://developers.cloudflare.com/changelog/post/2026-08-20-limits-increase/) ·
[Browser Rendering is now Browser Run, 15 Apr 2026](https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/) ·
[Browser Run for AI agents](https://blog.cloudflare.com/browser-run-for-ai-agents/)
