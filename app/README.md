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
| `src/lib/data/` | **Generated.** Verbatim port of the engine's data — 20 playbooks, 16 connectors, 6 countries, i18n, recommendations, risk table. Regenerate rather than hand-edit. |
| `src/lib/` | Ported logic: storage, country resolution, inference, business resolution, agent tool contract + approval queue |
| `src/i18n/` | `I18nProvider` + `useT()`. `pages.ts` holds copy new to the React app; `lib/data/i18n.ts` stays a pure port |
| `src/components/ui/` | Component kit — every element resolves through tokens, no literal colors |
| `src/styles/` | `tokens.css` (both themes), `theme.css` (Tailwind `@theme` + components), `fonts.css` |
| `src/routes/` | Landing, Onboard, Setup, Dashboard |

## Things worth knowing

**The data layer is generated.** It was extracted by evaluating `biz-engine.js` in Node and serialising the globals. If the static site's playbooks change, re-extract rather than hand-merging.

**Business resolution is a pure function.** The old engine memoised into a module-level `BIZ` cache and hand-invalidated it on every mutation (`delete BIZ[key]`). Here `resolveBusiness(key)` is pure and `useBusiness` memoises it, so there is no cache to forget to clear.

**Theme is one class on `<html>`.** `useTheme` toggles `theme-light`. That flips `--border-ink` from white to black, and every border, surface overlay and label ink re-resolves from it. Nothing else changes.

**No `!important` button override.** The static site carries a duplicated `@layer components` block in all four HTML files, because the upstream prebuilt CSS is light-first and forces `padding-block:0 !important`. Here the buttons are authored dark-first against the tokens. Do not port that block across.

**Fonts install from npm.** Geist Sans / Mono / Pixel via `geist` (SIL OFL), JetBrains Mono via `@fontsource`. `fonts.css` declares `@font-face` against the raw `.woff2` in `node_modules` because the `geist` package's own entry points are `next/font` wrappers. Paths are relative — a bare `geist/...` specifier does **not** resolve in CSS `url()` and fails silently to system fonts.

**Default language is BM, not English.** Malaysia's country locale is `bm` and a `bm` table exists, so `initialLang()` resolves to it — same as the original engine. Any string rendered in a page must live in `i18n/pages.ts` or the UI mixes languages.

## Still to port

The scaffold covers the flow end to end (landing → onboard → setup → dashboard) and five dashboard views. Not yet ported from `biz-engine.js`:

- **Chat view** (`kvChatState`, ~210 lines) — per-agent conversations, takeover, templates
- **Team Chat view** (~185 lines) — channels, @mentions, typing indicator
- **Business view** — the editable profile panel
- **Work filters** — the needs-you / auto / done / all tab strip
- **Mobile drawer + bottom nav** — the dashboard is responsive but has no mobile nav yet
- **Toast** — `kvToast` has no equivalent; connection toggles currently give no feedback

## Known issues

- **Light-theme accent contrast.** The emerald accent at 0.75–0.8 alpha was designed against a black ground; on the warm paper light theme, `.tag-green` and `.btn-reco` label text sit near the low end of legibility. Worth a contrast pass before shipping light mode.
- **`extractName` is a weak heuristic.** "Saya buka kedai gunting rambut di Shah Alam" becomes the business name "Saya Buka Kedai Gunting Rambut". This is faithful to the original algorithm, not a port defect — but it is visible in the sidebar and worth improving.
