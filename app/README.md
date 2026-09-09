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

## Backend (optional)

The app runs fully local by default — approvals in localStorage, tool calls mocked. Set `VITE_API_URL` (see `.env.example`) and approvals plus execution route to the Worker in `../worker`, which persists to D1 and enforces the risk gate server-side. Nothing else changes; that is what the tool contract buys.

## Known issues

- **Demo conversation seeds only exist for four agent names.** The hand-written chat threads are keyed on the restaurant/retail agents; the other 16 playbooks fall back to their own `work` items, which are industry-correct but shorter. Quick replies now fall back to a business-neutral set.
- **`extractName` is a weak heuristic.** "Saya buka kedai gunting rambut di Shah Alam" becomes the business name "Saya Buka Kedai Gunting Rambut". This is faithful to the original algorithm, not a port defect — but it is visible in the sidebar and worth improving.
