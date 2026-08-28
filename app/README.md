# AISAR — Vite + React scaffold

React rebuild of the static site, wired to the design system extracted in `../design-system/`.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # tsc -b && vite build → dist/
pnpm typecheck
pnpm deploy       # build + wrangler pages deploy dist --project-name aisar
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

## Views

All eight dashboard views are ported, plus the landing and onboarding flows. Signed-in
setup reads the real private-runtime state and embeds the live, private-owner Telegram pairing flow;
only the anonymous demo uses the original timed setup preview.

| View | Notes |
|---|---|
| Home | Stage-driven — setup / connect / operating, one action each |
| Chat | Per-agent threads, take over and hand back, quick replies, typing indicator |
| Team Chat | Channels, @mention routing, and #escalations mirrored from Work |
| Your Business | Editable name and location; edits propagate to every view |
| AI Team | Agents plus recommendations derived from opportunity functions |
| Work | Filter tabs, summary counts, approve and edit |
| Connections | Tier, auth method and scope per connector |
| Approvals | Risk-tiered queue; nothing sends without a human |

Mobile has a hamburger drawer and a four-item bottom bar; the desktop sidebar is hidden below the `lg` breakpoint.

### Cross-view wiring

Approving an item in **Work** appends a closure message to **Team Chat → #escalations**, deduped by source index so the sync is idempotent. The escalation channel is derived state, not a hand-written thread.

## Backend (optional)

The app runs fully local by default — approvals in localStorage, tool calls mocked. Set `VITE_API_URL` (see `.env.example`) and approvals plus execution route to the Worker in `../worker`, which persists to D1 and enforces the risk gate server-side. Nothing else changes; that is what the tool contract buys.

## Known issues

- **Demo conversation seeds only exist for four agent names.** The hand-written chat threads are keyed on the restaurant/retail agents; the other 16 playbooks fall back to their own `work` items, which are industry-correct but shorter. Quick replies now fall back to a business-neutral set.
- **`extractName` is a weak heuristic.** "Saya buka kedai gunting rambut di Shah Alam" becomes the business name "Saya Buka Kedai Gunting Rambut". This is faithful to the original algorithm, not a port defect — but it is visible in the sidebar and worth improving.
