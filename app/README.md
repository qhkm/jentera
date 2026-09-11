# Jentera — Vite + React scaffold

React rebuild of the static site, wired to the design system extracted in `../design-system/`.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # tsc -b && vite build → dist/
pnpm typecheck
pnpm deploy       # build + publish to aisar-jentera (jentera.ai)
```

## What's here

| Path | Contents |
|---|---|
| `src/lib/data/` | Hand-maintained data: 20 playbooks, 16 connectors, 6 countries, i18n, recommendations, risk table. Add playbooks via `../scripts/add-playbook.mjs`, not by hand-editing `playbooks.ts`. |
| `src/lib/` | Ported logic: storage, country resolution, inference, business resolution, agent tool contract + approval queue |
| `src/i18n/` | `I18nProvider` + `useT()`. `pages.ts` holds copy new to the React app; `lib/data/i18n.ts` stays a pure port |
| `src/components/ui/` | Component kit — every element resolves through tokens, no literal colors |
| `src/styles/` | `tokens.css` (both themes), `theme.css` (Tailwind `@theme` + components), `fonts.css` |
| `src/routes/` | Landing, Onboard, Setup, Dashboard |

## Things worth knowing

**The data layer is hand-maintained.** Add a playbook with `../scripts/add-playbook.mjs`, which edits `playbooks.ts` directly, typechecks, and verifies the new keywords infer back to the new key — don't hand-merge entries.

**Business resolution is a pure function.** The old engine memoised into a module-level `BIZ` cache and hand-invalidated it on every mutation (`delete BIZ[key]`). Here `resolveBusiness(key)` is pure and `useBusiness` memoises it, so there is no cache to forget to clear.

**Theme is one class on `<html>`.** `useTheme` toggles `theme-light`. That flips `--border-ink` from white to black, and every border, surface overlay and label ink re-resolves from it. Nothing else changes.

**No `!important` button override.** The static site carried a duplicated `@layer components` block in all four HTML files, because the upstream prebuilt CSS is light-first and forces `padding-block:0 !important`. Here the buttons are authored dark-first against the tokens. Do not port that block across.

**Fonts install from npm.** Geist Sans / Mono / Pixel via `geist` (SIL OFL), JetBrains Mono via `@fontsource`. `fonts.css` declares `@font-face` against the raw `.woff2` in `node_modules` because the `geist` package's own entry points are `next/font` wrappers. Paths are relative — a bare `geist/...` specifier does **not** resolve in CSS `url()` and fails silently to system fonts.

**English by default.** The engine defaulted from the country locale, so Malaysia opened in BM; `initialLang()` now returns `DEFAULT_LANG` (`en`) unless the user has explicitly picked a language. Any string rendered in a page must still live in `i18n/pages.ts` or the UI mixes languages when someone switches to BM.

## Workspace modes

The header switches between two experiences, using the existing view URLs:

| Mode | Entry | Contents |
|---|---|---|
| Chat | `/app?view=chat` | Full-height Ask Jentera, searchable conversation sidebar, per-chat drafts and replies |
| Dashboard | `/app?view=home` (also the `/app` default) | Home, Activity (`view=work`), My Business (`view=business`) |

Chat has no dashboard sidebar or bottom navigation. Below 1024px, its conversation
list opens in a native modal dialog with keyboard focus containment and Escape
dismissal. Dashboard uses a desktop sidebar and a three-section mobile bottom bar.

The conversation component stays mounted when switching modes: drafts and pending
replies survive a visit to Dashboard. The mode switch returns to the last dashboard
section and business tab visited in that mounted workspace. Direct links and browser
Back/Forward use the existing `view` and `tab` parameters. Mode switching does not
create a conversation or send a request.

Completed chat history remains in the existing account-scoped browser storage;
this is not cross-device chat synchronisation. No storage keys or API contracts
were changed for the mode split. Customer-facing agents remain unavailable.

### Connected task cards

Work replies with a server-issued run ID open `/app?view=work&run=<uuid>`.
Task details read the existing tenant-scoped run endpoint, independently of the
50 most recent Activity records, and refresh every three seconds while pending.
Switching modes preserves the selected task and the current chat draft.

The frontend retains accepted run IDs through reply failures so the owner can
check the existing task before sending another request. Completed and failed
reply links survive refresh in the same account-scoped chat storage; in-flight
chat pairs still do not survive reload. Older replies without IDs open general
Activity and are never matched by their wording. No storage keys, onboarding
data, cache headers or backend endpoints changed. Approval links open the
existing inbox; they do not infer which approval belongs to a task.

### Daily business brief

Signed-in Home replaces the repeated handled summary and generic chat launcher
with a brief from existing Activity data. It prioritises pending approvals,
today's failed/blocked records, running work (including earlier days), then
business knowledge or the next chat. Actions navigate; none execute work.

“Recorded today” uses `Asia/Kuala_Lumpur` and shows at most two recent records.
The feed is capped at 50; `occurredAt` is a record date, not a completion date,
so the brief does not claim a daily completed total. All-time counters stay
separate below. The date updates on a minute tick and when the tab returns;
the visible refresh time belongs to the last successful Activity fetch. Refresh
reads existing endpoints, with explicit loading/error states. This is an on-screen
summary, not a scheduled delivery or an AI-generated report. No backend, storage
key, onboarding or cache-header changes are needed.

### Routines (capability-gated)

`/app?view=routines` is available only when the authenticated `/api/me`
advertises `features.routines.apiVersion: 1`. Missing or unsupported discovery
means no navigation and no Routines requests, including in the anonymous demo.
No frontend override enables scheduling. The backend contract is
[`docs/plans/2026-09-09-routines-api-v1.md`](../docs/plans/2026-09-09-routines-api-v1.md),
including Claude's twelve amendments on main (`d40c508`).

Three deterministic jobs produce workspace-only results. Owners review a
Malaysia-time schedule before saving or activating; run-once and pause/resume
also require confirmation. Staff can read. Current server capabilities gate
all writes, including the ability to pause while new scheduling is unavailable.
Skipped occurrences are distinct from completed tasks, and real run IDs open
the existing task detail endpoint. The backend still needs its deterministic
result fallback, migration and scheduler acceptance gate before enabling v1.

Writes never update status optimistically. Lost responses retain their exact
request ID/body for explicit retry, including across Chat/Dashboard switches;
conflicts force review of fresh records. Replay responses are followed by reads.
The screen stays mounted during mode switches, but drafts and unresolved write
requests are not persisted across a full reload. No storage keys, onboarding
data, cache headers, backend routes or runtime settings changed in this slice.

Verified against mocked responses: owner/staff, missing discovery, review,
pause/resume availability, idempotent retry, revision conflicts, result links,
pagination and errors. Browser checks cover 1440/1024/390/320px, dark/light,
EN/BM, 15px body and 16px inputs, plus the existing public/onboarding routes.

## Installing as an app

Jentera is a progressive web app: an owner can put it on the home screen
and it opens full-screen into `/app`, with its own icon and splash. The
pieces, and where each one lives:

- **Manifest.** `src/pwa/manifest.ts` is the single source; `vite-plugin-pwa`
  writes it to `/manifest.webmanifest` at build time and injects the link
  into `index.html`, which the prerender step copies into every route shell.
  `src/pwa/__tests__/manifest.test.ts` checks the fields a store or home
  screen refuses without. Icons are rendered from `public/favicon.svg` into
  `public/icons/` (192, 512, and a full-bleed maskable 512) and
  `public/apple-touch-icon.png`; regenerate with `rsvg-convert` if the mark
  changes.
- **Service worker.** Generated by Workbox from the config in
  `vite.config.ts`. It precaches the hashed bundle so the shell boots
  offline, answers navigations network-first with a five-second timeout
  (route shells change on every deploy; a cached one must never win while
  the network is there), and shows `public/offline.html` when there is no
  network and nothing cached. Nothing from `api.jentera.ai` is cached: it is
  another origin and no route matches it. `_headers` asks for `no-cache` on
  `sw.js`, `manifest.webmanifest` and `offline.html`; the manifest gets it,
  while Pages serves `sw.js` with `max-age=14400` regardless (observed
  2026-09-12). That does not pin anyone to a release: browsers fetch the
  worker script past the HTTP cache when they check for updates, which
  the registration does on every launch. Pages also serves `offline.html`
  at `/offline` and redirects the `.html` URL; Workbox precaches it through
  the redirect and the entry is a plain 200.
- **Updates wait for the owner.** `PwaUpdateNotice` (mounted once in
  `Shell`) registers the worker through `src/pwa/register.ts` and, when a
  newer build has been fetched in the background, offers Reload or Later
  rather than reloading a page mid-reply. Under vitest the virtual module is
  aliased to `src/test-support/pwa-register.ts`, so the app renders as if no
  worker existed.
- **Install entry point.** The account menu shows "Install Jentera app" to a
  signed-in owner when Chromium has offered its install prompt
  (`beforeinstallprompt`, captured at module load in `src/pwa/install.ts`
  because it fires before React mounts), or on an iPhone, where no browser
  prompts and the item explains Share → Add to Home Screen. The item is
  hidden once the app is running from the home screen.

- **Push notifications.** The account menu's "Notifications on this
  device" switch (`src/pwa/push.ts`) asks the browser's permission on the
  tap, subscribes with the server's VAPID key from
  `GET /api/push/vapid-public-key`, and hands the subscription to
  `PUT /api/push/subscription`, which answers with a first push so the
  device is seen working. The worker (`src/sw.ts`, built in injectManifest
  mode so it can carry handlers) shows the payload as a notification and
  opens the app at the payload's path on tap; `src/pwa/sw-push.ts` keeps
  that shaping testable and refuses any URL off this origin. Signing out
  unsubscribes the browser first, so a shared device does not keep the
  previous owner's notifications. A 409 from the server means the same
  browser is registered to another account; the hook drops that
  subscription and takes a fresh endpoint. iPhone receives push only once
  the app is on the home screen, which is why the switch is hidden in
  Safari itself.

**Signing in inside the installed app.** iOS gives a home-screen app its own
cookie jar, separate from Safari. A magic link tapped in Mail opens in
Safari and signs Safari in, not the installed app. Password and Google
sign-in work inside the app; the magic link does not carry across. Android
and desktop Chromium share cookies with the browser and are unaffected.

## Public SEO and link previews

`pnpm build` now renders `/` and `/connect` to static HTML from their actual
React components, then hydrates those pages in the browser. Public copy and
metadata are available without JavaScript or an API request. Private route
shells stay empty and retain the existing authentication/onboarding flow.

`src/lib/seo.ts` owns titles, descriptions, canonical URLs, Open Graph/Twitter
tags and factual structured data. `PageMetadata` applies the same values during
client navigation. Only the two public pages appear in the generated sitemap.
Each `lastmod` is the most recent commit that materially changed that page,
not the deployment time; a source archive without git history omits it instead
of inventing one. Canonical URLs point to `https://jentera.ai`, including on
the secondary host.
Cloudflare's preview-deployment `noindex` header is preserved; the verifier
allows that on `pages.dev` while enforcing indexability on the live custom domain.
No invented prices, reviews, customer numbers or available integrations are
added to structured data.

`public/_headers` adds `X-Robots-Tag: noindex, nofollow` for private routes;
the corresponding HTML includes the same directive. Cache/security policies
are otherwise unchanged. `robots.txt` owns only the sitemap directive because
Cloudflare may prepend its managed content signals; crawling remains allowed so
crawlers can read private-route `noindex`. This is indexing guidance, not access
control. `_redirects`
no longer rewrites every missing URL to a 200 landing page: each known route
has a generated HTML file, trailing slashes redirect, and `404.html` handles
unknown routes and missing assets with a real 404 on Pages.

The social preview is a committed 1200×630 PNG, rendered from
`scripts/social-card.html` using the existing mark and Geist fonts:

```bash
pnpm exec playwright install chromium  # only needed to regenerate the artwork
pnpm social:image
# Or use an installed Chrome: SOCIAL_CHROME_CHANNEL=chrome pnpm social:image
pnpm build
pnpm verify:seo
SEO_BASE=http://127.0.0.1:5192 pnpm verify:seo # against wrangler pages dev dist
SEO_BASE=https://jentera.ai pnpm verify:seo   # after an intentional Pages release
```

Inspect the rendered image before committing. Use a new versioned filename
when replacing it so shared-link caches can pick up the new image. The build
copies the checked-in PNG; it does not download a browser or render artwork.

The verifier checks raw HTML, canonical/noindex tags, readable public content,
the sitemap and PNG dimensions/hash. Sitemap checks include strict XML,
duplicates, canonical origin, verifiable timestamps and live 200/indexable
targets. Against a Pages URL it also checks real status codes, headers and
image content type. The secondary `jentera.aisar.ai` hostname carries the same
HTML canonical, but hostname-level redirects are unsupported in Pages
`_redirects`; add an account-level Cloudflare Bulk Redirect to `jentera.ai`
when that alias no longer needs to serve directly. Implementation references:
[Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics),
[Open Graph](https://ogp.me/), and
[Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/).

## Backend (optional)

The app runs fully local by default — approvals in localStorage, tool calls mocked. Set `VITE_API_URL` (see `.env.example`) and approvals plus execution route to the Worker in `../worker`, which persists to D1 and enforces the risk gate server-side. Nothing else changes; that is what the tool contract buys.

## Known issues

- **Demo conversation seeds only exist for four agent names.** The hand-written chat threads are keyed on the restaurant/retail agents; the other 16 playbooks fall back to their own `work` items, which are industry-correct but shorter. Quick replies now fall back to a business-neutral set.
- **`extractName` is a weak heuristic.** "Saya buka kedai gunting rambut di Shah Alam" becomes the business name "Saya Buka Kedai Gunting Rambut". This is faithful to the original algorithm, not a port defect — but it is visible in the sidebar and worth improving.
