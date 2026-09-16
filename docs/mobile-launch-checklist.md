# Mobile launch checklist

Status: living list, started 15 September 2026, for a target of shipping the
iOS and Android apps the week of 22 September. One line per item with what it
depends on and how to tell it is done. The design is
[`docs/superpowers/specs/2026-09-14-mobile-apps-design.md`](superpowers/specs/2026-09-14-mobile-apps-design.md);
this is what is left between here and a listing.

Ordered by dependency, not by size. The first section blocks the second, which
blocks sign-in working at all inside the app.

## 1. Store identities — on the critical path

Neither hash below exists until these are done, and nothing in section 2 can
start without them. Both developer accounts are organisation accounts, so
Play's 12-testers-for-14-days rule for new personal accounts does not apply.

| Item | Done when |
|---|---|
| Apple App ID for `ai.jentera.app`, with the Associated Domains capability enabled | The identifier exists in the developer portal and you have the **team ID** |
| Play Console app for `ai.jentera.app`, Play App Signing enabled | You can read the **app signing certificate SHA-256** from Play Console → Setup → App integrity. Not the upload key: the upload key is the wrong hash and App Links will fail verification silently |
| Decide the listing owner entity | Kitakod Ventures, matching the privacy notice |

## 2. App Links and Universal Links — this is what unlocks sign-in

Until this is finished, the native sign-in doors stay shut
(`NATIVE_AUTH_ENABLED="false"`, `worker/wrangler.toml`). The minted code
currently travels to `ai.jentera.app:`, a custom URI scheme **any installed app
can claim**, so a verified link is the control that makes the callback safe.

| Item | Done when |
|---|---|
| `https://jentera.ai/.well-known/assetlinks.json` carrying the Play App Signing SHA-256 | `adb shell pm verify-app-links --re-verify ai.jentera.app` reports verified on a device, and the file is served as `application/json` |
| `https://jentera.ai/.well-known/apple-app-site-association` — no file extension, `application/json`, no redirect | `applinks` names `TEAMID.ai.jentera.app`; a tapped link opens the app rather than Safari |
| Android intent filter with `android:autoVerify="true"` | In `mobile/android/app/src/main/AndroidManifest.xml`, shipped in a build |
| iOS `applinks:jentera.ai` associated domain entitlement | In the App target's entitlements |
| Callback switched from the custom scheme to the https link, scheme kept only as the iOS < 17.4 fallback | `app/src/lib/native/index.ts` no longer treats `ai.jentera.app:` as the primary |
| **Flip `NATIVE_AUTH_ENABLED` to `"true"`** | Only after every row above. A real sign-in completes on a device and lands back in the app |

## 3. Store gates the platform does not meet yet

| Item | Why | Done when |
|---|---|---|
| **In-app account deletion** | Apple 5.1.1(v), and their FAQ closes the "we sign in on the web" escape. Google wants an in-app path *and* a web URL | Deletion is initiated in the app and actually deletes: business, RLS-scoped rows, R2 artifacts, `oauth_identity`, `login_token`, email-keyed `platform_access`/`trial_redemption`/`waitlist_entry`, invitations, push rows — and the Fly sprite. Needs its own spec; **not started** |
| Privacy policy reachable and linked | Both listings require the URL; PDPA requires the notice regardless, in Bahasa Malaysia and English | `https://jentera.ai/privacy` is live on the deployed app and linked from the footer. The page is committed (`0b72ffc`); **verify it is deployed** |
| App Store privacy labels / Play Data safety | Must match what is collected | Email, analytics (`PRODUCT_ANALYTICS`), and photographs transmitted-and-not-retained are all declared |
| Sign in with Apple decision (4.8) | Google is offered, so an equivalent is required | Either the hide-Google-on-native flag is flipped, or SIWA is built. Plan: ship with Google, flip the flag same-day if review raises it |
| Demo account for App Review | `ACCESS_MODE="waitlist"` and trials are 72 hours; review takes longer | A reviewer address holds a `kind='paid'` access grant and its onboarding is complete. It provisions a sprite, which is no longer a constraint: the Fly account moved to the Hero plan on 16 September and the org's concurrent-sprite limit went from 10 to 100 |
| `ITSAppUsesNonExemptEncryption` in Info.plist | Every submission asks | Declared |
| Review notes for the business browser | `routes/views/BusinessBrowser.tsx` streams a remote Chromium and invites password entry; a reviewer can read it as a non-WebKit browser (2.5.6) | Notes explain it is a remote-computer view, or 1.0 hides it |

## 4. Must ship inside 1.0.0 or it can never reach those phones

| Item | Why |
|---|---|
| The version gate (`minAppVersion` on `/api/me`, version in the User-Agent) | A binary carries a frozen `app/dist` while the worker ships most days. A gate added in 1.1 cannot reach phones stuck on 1.0 |

## 5. Known to regress natively, unfixed

| Item | Effect |
|---|---|
| The run stream is cookie-only (`routes/runs.ts:627`) and a WebSocket cannot carry a bearer | Every ask falls back to polling: no streamed deltas, "reconnecting" on every task. Needs a short-lived stream ticket |
| Artifact downloads are `<a href download>` opening in the system browser with no bearer | 401. Needs fetch-with-bearer into `@capacitor/filesystem`, then the share sheet |
| Native push | Not built. APNs directly on iOS, FCM on Android; `device_push_token` table, claim-and-reassign, per-device delivery tracking |

## 6. Operational

| Item | Done when |
|---|---|
| **Migration 046 applied to production** | `session.kind`, `device_label`, `last_seen_at` and `revoke_sessions_for_email` exist on the production database |
| A devices list, or at least a documented revoke | Native sessions are 7 days and portable. Revoking one today needs a writable owner connection: `psql "$(neonctl connection-string --role-name neondb_owner)" -c "select public.revoke_sessions_for_email('them@example.com')"`. `stats.sh` cannot do it — that connection is read-only by design |
| **Xcode installed** | Not installed as of 15 September: no `Xcode.app`, `xcode-select -p` points at CommandLineTools, zero simulators, CocoaPods broken on a missing `ffi` gem. `brew install cocoapods` after Xcode |
| **Android SDK installed** | Android Studio is present but there is no `~/Library/Android/sdk` and `ANDROID_HOME` is unset. The JDK on PATH is Java 20; Capacitor and AGP want 17 or 21 |
| `@types/node` declared in `worker/package.json` | `pnpm typecheck` currently passes only because TypeScript walks up to `~/ios/node_modules`. A fresh clone or CI fails |
| Real-device testing | An iPhone and an Android handset. No simulator receives a real APNs push, and the Universal Link behaviour must be confirmed on hardware |

## Ordering traps

- **Flag after the files, never before.** `NATIVE_AUTH_ENABLED="true"` without a
  published `assetlinks.json` and AASA reopens the takeover the flag closes.
  Same shape as the Turnstile rule: ship the app with the site key first, then
  set the secret.
- **The Play App Signing hash, not the upload key.** The wrong one fails
  verification quietly — links open the browser instead of the app and nothing
  says why.
- **A worker deploy today would open the native routes** if the flag were on.
  It is off; keep it off until section 2 is complete.
