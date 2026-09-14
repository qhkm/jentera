# Jentera mobile apps

Status: design, 14 September 2026. Approved in conversation; no code, no
migrations, no store records created yet. The implementation plan follows this
document.

Jentera ships to the App Store and Google Play as one Capacitor project
wrapping the existing React app, with a bearer-token session on the phone.
Both developer accounts are organisation accounts, so Play's 12-testers-for-14-
days rule for new personal accounts does not apply and the two listings can run
in parallel.

## Why this shape

Three drivers decided it: a store listing customers can find, push that works
on iPhone, and a camera. The first needs a binary; the other two need native
code regardless of how the binary is built.

The web app is bundled into the binary rather than loaded from jentera.ai.
Loading the live site keeps the session cookie and the WebSocket working for
free, but Capacitor documents `server.url` as not intended for production, it
is the highest-risk shape under guideline 4.2 (it *is* the website), and any
XSS on jentera.ai would reach the native bridge — camera, secure storage, push
token. Bundling costs the cookie: the app's origin becomes `capacitor://…` on
iOS (an https scheme is impossible there — WKWebView already handles it) and
`SameSite=Lax` withholds the cookie from a cross-site fetch out of it. Loosening
the cookie to `SameSite=None` to compensate would expose the web app to CSRF,
since only three routes check Origin. So the phone carries a bearer instead,
which is CSRF-immune by construction.

A native-first rewrite in Expo was rejected on team size: it is a second UI to
keep in step with `app/`, indefinitely, for one person.

## What must be true before any of this ships

These are owed to the web product regardless, and two of them are store gates.
They are the first half of the work, not preamble.

### Document upload is broken in production, twice

`POST /api/runs/ingest/file` has never worked from a browser, which is why
`docs/todo.md` records it as "may not have been tried live".

- `index.ts:69` sends `Access-Control-Allow-Headers: Content-Type`, but
  `app/src/lib/repo/remote.ts:341` sends `X-Aisar-File-Name`, which is not
  safelisted. Every upload dies in preflight. This is the third bug of exactly
  this shape, after the push `PUT` and the routes before it.
- `request-guard.ts:7` caps every body at 128 KiB and `index.ts:117` runs the
  guard before `handleRuns` at `:141` with no path exemption, so the route's
  8 MiB `UPLOAD_DOCUMENT_LIMIT` is unreachable. A downscaled phone photo is
  300 KB to 1.5 MB and would 413 before reaching the route.

Neither is caught because `test/ingest-file.test.ts:49` calls `handleRuns`
directly, past both the guard and CORS.

Fix: give the guard a per-path cap so the ingest route gets its 8 MiB while
everything else keeps 128 KiB; add `X-Aisar-File-Name` to the allow-list; and
extend `test/cors.test.ts` to scan `remote.ts` for custom request headers and
assert each one appears there, the way it already scans routes against the
method lists. Add one test that goes through `index.ts`'s `fetch` with a 1 MiB
body, because a test that calls the route directly cannot see either fault.

### Account deletion

Apple 5.1.1(v) requires account deletion initiated inside the app, and Apple's
own FAQ closes the escape this design might otherwise invite: linking out to a
browser for account creation does not exempt an app. Google Play requires an
in-app path *and* a web URL, plus matching Data safety answers.

Deleting an owner is not a small route here. It ends the business, every
RLS-scoped row under it, sessions, devices and pending pushes, artifacts in R2,
`oauth_identity`, `login_token`, the email-keyed rows in `platform_access`,
`trial_redemption` and `waitlist_entry`, any invitation for the address — and
the business's Fly sprite, a real machine with a volume and checkpoints. Staff
lose the business when its owner deletes it. This wants its own spec and its
own plan; it is named here because the listings cannot go live without it.

### A privacy policy page

`app/src/routes/` has none. Both stores require the URL in the listing, and the
App Store privacy labels must match what is actually collected: email, usage
analytics (`PRODUCT_ANALYTICS`), and photographs that are transmitted and read
but not retained. Malaysia's PDPA as amended in 2024 requires the notice
independently of any store, with breach-notification and cross-border-transfer
duties — tenant data is in Singapore (Neon `ap-southeast-1`, sprites in `sin`)
and the notice should say so. Bilingual, like the dashboard.

### Web push proven on a real device

`push_subscription` is still empty (`docs/todo.md`). A second transport should
not be stacked on a first that has never delivered a notification in
production.

## Shape and layout

```
mobile/
  capacitor.config.ts
  package.json          # @capacitor/{core,cli,ios,android} and plugins
  ios/ android/         # generated native projects, committed
  scripts/sync.sh       # pnpm -C ../app build && cap sync
```

In this repository, not a separate one: the shell ships a frozen copy of
`app/dist`, and if the two live apart they drift without anyone noticing until
a customer reports a screen that no longer exists.

App name Jentera, bundle id `ai.jentera.app` on both platforms — not
`com.kitakod.*`, which is the Mac utilities' prefix, and a bundle id is
permanent once a listing exists.

`server.hostname` is set to `app.jentera.ai`, so the origins are
`capacitor://app.jentera.ai` and `https://app.jentera.ai` rather than
`localhost`. `https://localhost` is an origin any local process can present;
naming a host we control means the Origin-checked routes admit exactly one
native origin per platform. Both go in `ALLOWED_ORIGINS`. While editing that
variable, note it currently ships `http://localhost:5173` and `:4173` in
production and those belong behind an environment split.

`app/` gains one module, `app/src/lib/native/index.ts`, with a web no-op
behind the same interface: `isNative()`, `signIn()`, `registerForPush()`,
`capturePhoto()`, `secureStore`, `openArtifact()`. The claim that nothing else
in `app/` changes is false and was corrected in review — these touch points
each need a native branch and a test: the seven raw `fetch` sites in
`remote.ts` outside `call()` (`:232`, `:336`, `:368`, `:517`, `:526`, `:557`)
and `websocketUrl` (`:780`); `routes/SignIn.tsx`, which has no native branch at
all; `components/AccountMenu.tsx:18,35,89` and `InstallNudge.tsx`, which push
PWA install; `components/ServiceWorkerRegistration.tsx`, which registers
unconditionally; `gate.tsx:150`, which routes `NotSignedInError` to `/signin`;
and the artifact anchors in `FileExplorer.tsx:65`, `ArtifactList.tsx:57`,
`ArtifactPreview.tsx:170`, `routes/views/FilesView.tsx:71`.

No hand-written native code beyond configuration and plugin wiring. Choosing
APNs directly over FCM on iOS, below, is what keeps that true.

## Auth

### Worker changes

1. `readCookie` (`worker/src/auth.ts:425`) becomes `readSessionToken(request)`,
   reading `Authorization: Bearer` **first** and the cookie second. Header
   first, not cookie first: Android's WebView shares the system cookie jar, so
   a stale `Set-Cookie` from api.jentera.ai could otherwise shadow a valid
   bearer. Callers are `tenancy.ts:25`, `request-guard.ts:66`,
   `routes/session.ts:254/269/385/406`, `routes/access.ts:33`,
   `routes/launch-admin.ts:10`. `readNamedCookie` (`session.ts:55`) is the
   OAuth stash and is untouched. The runtime credential readers
   (`runtime/identity.ts:42`, `routes/model.ts:588`, `routes/support.ts:75`) do
   not go through `readCookie` and must not start: tests assert that a session
   bearer is refused at `/v1/model/*`, `/api/support/*` and
   `/v1/runtime/artifacts`, and that a `sk-jentera-v1.…` credential is refused
   at `/api/me`. They now share a header; nothing else about them is shared.
2. `Access-Control-Allow-Headers` (`index.ts:69`) gains `Authorization` and
   `X-Aisar-File-Name`.
3. `ALLOWED_ORIGINS` gains the two native origins.

### Getting a token onto the phone

The app never renders its own sign-in form. It opens the real page in
`ASWebAuthenticationSession` / Chrome Custom Tabs at
`jentera.ai/signin?native=1&state=…&code_challenge=…`. All three doors work
there unchanged, Turnstile keeps its widget, and Google — which refuses OAuth
in embedded webviews — works because this is a real browser.

**The callback is bound with `state` and PKCE.** The first draft of this design
had neither, which would have shipped a login-CSRF: an attacker mints a code on
their own account and gets the victim to open
`ai.jentera.app://auth?code=…`, after which the victim's phone is signed into
the attacker's business and every photograph and chat lands in their tenant.
`routes/session.ts:355-358` already documents this attack for Google and
defends it with `state`; the native path must not drop the defence. The app
generates `state` and a `code_verifier` per attempt, passes `state` and the
challenge on the sign-in URL, and rejects any callback whose `state` does not
match a pending attempt from this launch.

Callback transport is an https Universal Link / App Link where available
(iOS 17.4 and later can use `.https(host:path:)` directly with
`ASWebAuthenticationSession`), with the custom scheme as fallback: a custom
scheme is claimable by any other app on Android and is not unique on iOS.
`assetlinks.json` must carry the **Play App Signing** certificate hash, not the
upload key.

`POST /api/auth/native/code` is the most valuable route in the system —
it converts an HttpOnly cookie into an exportable bearer — and is hardened
accordingly: POST only, Origin checked against `ALLOWED_ORIGINS` the way
`routes/access.ts:12` already does, requires a verified address and passes
`accessForEmail`, binds the code to the minting session and user and to the
`code_challenge`, and stores only its SHA-256 with a 60-second TTL and a
single-use conditional UPDATE, exactly as the magic link does.
`POST /api/auth/native/token` takes `code`, `state` and `code_verifier`,
re-verifies that the minting session is still live, and **mints a new session
row** rather than handing over the browser's token, so revoking the phone does
not sign out the laptop. It sits behind the `AUTH_BURST` binding like
`/api/auth/request`.

Magic links from email carry `native=1` through `login_token` the way
`sealTrial` already carries an invite (`session.ts:126-127`), so consuming the
link in *any* browser — including the in-app browsers many mail clients use,
which never dispatch Universal Links — lands on a page that mints the code and
redirects. Universal Links are the enhancement, not the mechanism. The app
cancels an open auth sheet if the link arrives directly.

Sessions are already 30 days (`auth.ts:17`). `session` gains `kind`,
`device_label` and `last_seen_at`, and Settings gains a device list with
per-row revoke and a sign-out-everywhere. Native sign-out wipes local storage
even when the revoke call fails offline, and queues the revoke.

### The waitlist gate

`ACCESS_MODE = "waitlist"` is live (`wrangler.toml:49`) and `verifySession`
returns null for an address `accessForEmail` does not allow, so a native bearer
for an ungranted address 401s everywhere while `/api/me` answers 403
`ACCESS_REQUIRED`. The browser page must complete `/api/access/redeem` before
minting a native code. App Review needs a demo account that outlives the
72-hour trial — a `kind='paid'` grant for a reviewer address — and note that
completing onboarding provisions a sprite against the 10-concurrent org limit.

### Two surfaces that regress without further work

- **The run stream is cookie-only.** `routes/runs.ts:627` authenticates the
  WebSocket upgrade through `resolveTenant`, and a WebSocket cannot carry an
  `Authorization` header. Natively every ask would fall back to `pollAsk`: no
  streamed deltas, "reconnecting" on every task, which is the core experience.
  A short-lived stream ticket fixes it — POST with the bearer, receive a
  60-second single-use ticket bound to run and user, pass it as `?ticket=`.
- **Artifact downloads.** The four `<a href download target="_blank">` sites
  open in the system browser with no bearer and get 401, and WKWebView does not
  handle attachment downloads at all. `openArtifact()` fetches with the bearer,
  writes through `@capacitor/filesystem`, and hands off to the share sheet.

### The cost of a bearer

A 30-day token in JavaScript is a step down from HttpOnly: an XSS in
`app/src/lib/reply-markdown.tsx`, which renders model output, would exfiltrate
it rather than merely act inside the WebView. Mitigations: a strict CSP meta in
the bundled `index.html`, a shorter sliding session for `kind='native'`, and —
because the iOS Keychain survives app deletion — clearing stored credentials on
a fresh-install marker.

## Sign in with Apple

Guideline 4.8 requires an equivalent login option whenever a third-party login
sets up the primary account, and the second of its three criteria is that the
service "allows users to keep their email address private as part of setting up
their account". Magic link does not obviously satisfy that, since its mechanism
is the user handing over a real address; secondary sources claiming otherwise
do not address the point.

The owner wants the Google button on iPhone. So: ship 1.0 with all three doors
and magic link as the claimed equivalent, **and build the hide-Google-on-native
flag at the same time** — a conditional in `SignIn.tsx`, an hour's work. If
review raises 4.8, flip the flag and resubmit the same day; Google survives on
jentera.ai and on Android, and nobody is locked out, because the doors converge
on one email-keyed account and a Google-created account still accepts a magic
link. Sign in with Apple is built only if, after that, the iPhone Google button
is judged worth it: private-relay addresses land in `platform_access`,
`invitation`, `waitlist_entry` and the signup notice, all of which assume a
durable real address, and Resend needs the relay domain registered before mail
to them is delivered at all.

## Push

**APNs directly on iOS, FCM HTTP v1 on Android.** The first draft chose FCM for
both to have one sender; that was wrong. `@capacitor/push-notifications`
returns an *APNs* token on iOS, so routing iOS through FCM means adding the
Firebase iOS SDK, AppDelegate wiring, and an SDK that carries a privacy
manifest and a history of ITMS-91061 rejections — hand-written native code, to
replace a provider JWT that `worker/src/push/crypto.ts` already has the
primitive for: its ES256 VAPID signing is the same operation an APNs `kid`/
`iss` token needs, refreshed hourly.

Nothing above the transport changes. `notification`, `push_outbox`,
`enqueuePush`, `sweepPushOutbox` and the recipient rules for `work_needs_you`
and `approval_requested` stay as they are. `pushToUser(env, businessId, userId,
payload)` gains a second list beside `listPushSubscriptions` and fans out to
both.

**Device tokens are claimed, not conflicted.** `push_subscription` (migration
030) makes `endpoint` unique across the table so a second account on a shared
browser collides with an RLS-hidden row, gets 409, and takes a fresh
subscription. That pattern does not transfer: a native token belongs to the app
*installation*, `register()` returns the same APNs token every time, and
rotating an FCM token needs a Firebase Installations delete the plugin does not
expose. A user whose colleague signed out offline would be locked out forever.
Instead `claim_device_token(token, business_id, user_id)` — a security definer,
like the other cross-tenant helpers — deletes any foreign row and inserts,
because one installation has exactly one signed-in user. Rows are deleted on
sign-out and on `UNREGISTERED`/`NOT_FOUND` from either service. A test asserts
the previous owner stops receiving.

**Delivery is tracked per device before a second transport is added.**
`push/outbox.ts` marks a row delivered only when nothing failed, so one bad
device causes a retry that re-sends to every device that already succeeded.
With two transports and independent failure modes (FCM 429/5xx, APNs 503) that
becomes routine. Deliveries are recorded per device and retries skip what
landed.

Also needed: tap handling (`pushNotificationActionPerformed` navigating with
the same `safePath` rule `sw-push.ts` uses), `tag` mapped to
`apns-collapse-id` and `collapse_key`, and Android 13's `POST_NOTIFICATIONS`
permission. Permission is requested after the first sign-in, never at launch —
iOS gives one prompt per installation, forever.

Configuration is two secrets, `APNS_AUTH_KEY_P8` (with key id and team id) and
`FCM_SERVICE_ACCOUNT_JSON`; absent means no device sends and no switch, the way
missing VAPID behaves now.

**Duplicates are managed, not waved away.** Someone running the installed PWA
and the native app on one phone receives everything twice, and the web app
actively pushes installation. Both tables record `platform`; the Settings
device list shows every subscription and token with a remove button; and the
install nudge on a mobile browser becomes "Get the app" once the listings
exist.

## Camera

`@capacitor/camera` for photo and library, no native code. The target is
`POST /api/runs/ingest/file` once the two faults above are fixed: bytes go
through Workers AI's `toMarkdown` and then `extractFacts`, and what is found
lands in Knowledge unconfirmed with the file name as its source.

Owner-only, because the route checks `can(id, 'knowledge.manage')` and 403s
otherwise; staff must not see a button that always fails. The app downscales to
roughly 2000px on the long edge at JPEG q0.8. The image itself is not kept —
`ingest/file` stores what was learned and discards the bytes, deliberately.

So this is "photograph a document you would otherwise upload" — a menu, a price
list, a certificate — and the feature is presented that way. Receipts are not
it: `extractFacts` characterises a business, and a receipt yields facts like
totals. Receipt capture with a retained image and an expense draft is
`docs/plans/2026-09-12-mini-apps.md`, still unstarted, and its step-1 spike
should decide whether extraction is good enough before any of it is promised.

Outbound `@capacitor/share` is in. Inbound share is out of 1.0: Android is a
cheap intent filter but iOS needs a Share Extension — a separate native target,
real Swift, outside Capacitor — and one platform only would generate support
mail. `Info.plist` carries honest `NSCameraUsageDescription` and
`NSPhotoLibraryUsageDescription` strings; vague ones are a routine rejection.

## Updates

The binary carries a frozen `app/dist` while the worker ships most days and has
no API versioning. The app sends its version in the User-Agent via Capacitor's
`appendUserAgent` rather than a custom header, which needs no CORS change and
reaches every log line; `/api/me` answers `minAppVersion`; below it the app
shows a blocking update screen. **This ships in 1.0.0 or never** — a gate added
in 1.1 cannot reach phones already on 1.0.

Live web-layer updates (Capgo, Appflow, Capawesome) would make the gate a rare
fallback rather than a monthly event, and are generally read as permitted for
WebKit-interpreted code. That reading rests on secondary sources and the
services are a paid dependency, so 1.0 ships the gate alone and live updates
are decided separately, on the current guideline text.

The PWA machinery goes inert natively through the `lib/native` seam: no service
worker registration, no `pwa/update-checks.ts` polling, no `pwa/push.ts`
subscribe. Those exist for jentera.ai and would fight their native equivalents.

## Other review risk

- **4.2, repackaged website.** The app is the site plus push, camera and native
  auth. Moderate risk, and the honest mitigation is that the native features are
  real rather than decorative.
- **2.5.6.** `routes/views/BusinessBrowser.tsx` streams a remote Chromium the
  owner drives, and invites them to enter passwords and MFA in it. It is a
  remote-computer view, which is accepted, but a reviewer can read it as a
  non-WebKit browser. Review notes should explain it, or 1.0 hides it.
- **AI content policy.** Apple's revised age-rating questionnaire and Google
  Play's generative-AI policy, which expects in-app reporting of AI output for
  apps whose primary purpose is generative, both need reading against current
  text when the store records are created. Neither was verified for this design.
- **Listing hygiene.** Privacy and support URLs, privacy labels covering
  analytics and transmitted photographs, `ITSAppUsesNonExemptEncryption`,
  bilingual listing copy.

## Testing

Worker: `test/cors.test.ts` extended to assert both new allow-headers and to
scan `remote.ts` for custom headers; a test through `index.ts`'s `fetch` with a
1 MiB ingest body; `native-auth.test.ts` covering code issue, exchange, state
mismatch, verifier mismatch, replay, expiry, a revoked minting session, and the
cross-header refusals in the worker-changes section; `push-device.test.ts`
covering claim-and-reassign, dead-token deletion, and per-device retry. Assert
as `aisar_app` and arrange as owner, per `harness.ts` — a test that asserts as
the owner passes while production leaks.

App: the native seam's web no-op keeps the existing suite unchanged; each touch
point listed under layout gets a test for both branches.

Then real devices. No simulator receives a real APNs push, and the Universal
Link and `ASWebAuthenticationSession` cookie behaviour cited here are from
Apple forum threads rather than the documentation and must be confirmed on
hardware.

## Sequence

1. Fix the two upload faults. Prove web push on a real phone.
2. Account deletion, its own spec and plan.
3. Privacy policy page, bilingual.
4. Native auth: bearer, PKCE, stream ticket, artifact download, device list.
5. Push: APNs and FCM, claim-and-reassign, per-device delivery.
6. Camera, version gate, listings, TestFlight and Play closed test to the
   existing businesses.

Steps 1 to 3 are owed to the web product whether or not the apps ship.

## Out of scope for 1.0

Receipt retention and expense drafts, inbound share, offline beyond the shell,
biometric unlock, live web-layer updates, Sign in with Apple, and everything
else in the mini-apps plan.
