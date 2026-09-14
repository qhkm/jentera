# Jentera mobile shell

One Capacitor project packages the production build from `../app` for iOS and
Android. The app id is `ai.jentera.app`; the bundled origins are
`capacitor://app.jentera.ai` on iOS and `https://app.jentera.ai` on Android.
There is no production `server.url`: every binary carries a frozen copy of the
web app.

```bash
pnpm install
pnpm assets      # regenerate native icons and splash screens from assets/logo.svg
pnpm sync
pnpm open:ios
pnpm open:android
```

`pnpm sync` always rebuilds `app/` before copying assets and reconciling native
plugins. Commit native project changes produced by a Capacitor upgrade.

The native projects require full Xcode and an Android SDK respectively. This
repository can still build, test and sync the web bundle without signing
credentials. Authentication, push delivery, camera UI and the minimum-version
gate are separate implementation slices described in
`docs/superpowers/specs/2026-09-14-mobile-apps-design.md`.
