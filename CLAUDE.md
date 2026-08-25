# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` carries the same house rules in shorter form. `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md` and `TECHNICAL_ARCHITECTURE.md` carry product direction — read those before changing what the product *does*, not just how it's built.

## Two implementations, mid-consolidation

This repo currently contains the same product twice. That is temporary and deliberate.

**This section and everything it describes is scheduled for deletion.** Slice 0 of the
backend integration retires the static implementation and `scripts/parity-audit.mjs`
outright, because a backend cannot be integrated against two front-ends. Until that lands,
the dual-maintenance rules below still apply. See
`docs/superpowers/specs/2026-08-21-backend-integration-design.md`.

| | Path | Status |
|---|---|---|
| **Static site** | `index.html`, `onboard.html`, `setup.html`, `app.html`, `biz-engine.js` | Reference only. No longer published by any script |
| **React rebuild** | `app/` (branch `design-system`) | Product of record. `./deploy.sh` publishes it to **`jentera.ai`** (Pages project `aisar-jentera`, which also serves `jentera.aisar.ai`) |

The apex `aisar.ai` is a **separate** Pages project (`aisar`) and is not touched by `./deploy.sh`. Publishing there is deliberately manual: `AISAR_PAGES_PROJECT=aisar ./deploy.sh "msg"`.

Every product change made to one has to be made to the other until the cutover happens. If you are changing behaviour, check whether both need it.

`scripts/parity-audit.mjs` is the gate — run it before claiming parity:

```bash
node scripts/parity-audit.mjs      # exits non-zero on any gap
```

It proves *coverage* (data, strings, storage keys, routes, nav, landing sections, and that keys the static site writes are also written by the app). It cannot prove the UI behaves the same. It has twice passed while a real structural gap existed — treat green as necessary, not sufficient.

## Static site

Build-free. No package.json, no bundler. The deployed files *are* the source.

```bash
wrangler pages dev . --port 5173   # Pages routing, so /app /onboard /setup resolve
./deploy.sh "fix: concise description"   # commits, pushes main, publishes. A real release.
node scripts/add-playbook.mjs --file spec-minimart.json
```

### Page flow

```
index.html  (/)          landing
onboard.html (/onboard)  6 steps: import-or-manual → scan → confirm → channels → pain → recommendation
setup.html  (/setup)     scripted connect sequence → aisar-setup-done-v1
app.html    (/app)       dashboard; redirects to /onboard without aisar-onboarded-v1
```

### biz-engine.js

~3,400 lines, plain ES5, everything on `window` under a `kv`/`KV_` prefix, sections marked with `/* ==== NAME ==== */`. Comments in Malay; user-facing copy in `KV_I18N`.

The core idea: **no hardcoded per-customer profile.** Free text → `kvInfer()` → one of ~20 `PLAYBOOKS` → the whole dashboard is generated from that template. Adding an industry = adding one `PLAYBOOKS` entry.

Roughly half the file is the `PLAYBOOKS` data block. Do not hand-edit it; use the generator.

**Dashboard is four areas**, not eight — Home, Ask AISAR (with a Customer inbox tab), Activity (work + approvals), My Business (profile + responsibilities + connections). Agent rosters, connections and approvals are deliberately *not* separate top-level views; see `DISCUSSION_SUMMARY.md`.

### The button-CSS override

The prebuilt Tailwind v4 chunk in `_next/static/chunks/` forces `padding-block: 0 !important` on `.btn` inside `@layer components`. Unlayered `!important` **loses** to it — cascade layers outrank importance. The fix is an `@layer components` block, later in source order, scoped to `html.site-theme-dark`.

That block is duplicated verbatim in all four HTML files. **Change one, change all four.**

This trap bites in both directions. In the React app the same mechanism caused an unlayered `:focus-visible` to override a component's `outline: none`. When a rule mysteriously wins or loses, check layering before specificity.

### Caching

`_headers` sets `no-store` on the pages and `biz-engine.js`. On top of that, `app.html` loads `/biz-engine.js?v=N` while `onboard.html` loads it unversioned. **After editing `biz-engine.js`, bump the `?v=N` in `app.html`.**

## React rebuild (`app/`)

```bash
cd app && pnpm install
pnpm dev        # :5173
pnpm build      # tsc -b && vite build
pnpm typecheck
```

Deploy with `./deploy.sh "msg"` — builds `app/` and publishes to the **`aisar-jentera`** project, live at `jentera.ai`. That project serves two hostnames, `jentera.ai` and `jentera.aisar.ai`, from the same deployment; `deploy.sh` verifies the first. Preview instead with `AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "msg"`. The script verifies the served CSS and JS are real assets, not the SPA fallback HTML, and fails loudly if they are not.

`app/README.md` has the detail. The parts worth knowing here:

- `app/src/lib/data/` is **generated** by evaluating `biz-engine.js` in Node and serialising the globals. Re-extract rather than hand-merging when the engine changes.
- Controls share `--control-h` / `--control-pad-y`. A `text-*` or `py-*` utility on a `.btn`/`.input` overrides the component and breaks the shared height — this caused three separate visual bugs. Let components own their type and padding.
- The engine writes work-done indices as **strings**; the app reads either format and writes strings, so existing users' approvals survive the cutover.

## localStorage keys

The full persisted surface. Changing or adding one affects the flow gates, so call it out in the commit — and make sure both implementations write it, not just read it.

| Key | Meaning |
|---|---|
| `aisar-onboarded-v1` | `'1'` = onboarding done; `/app` redirects without it |
| `aisar-setup-done-v1` | `'1'` = setup done; drives command-centre stage |
| `aisar-biz-type` | Playbook key |
| `aisar-biz-name`, `aisar-biz-loc` | User overrides on playbook defaults |
| `aisar-channels` | JSON array from onboarding step 4 |
| `aisar-conns` | JSON array of connected connectors (seeded from playbook) |
| `aisar-country`, `aisar-lang` | `'MY'` etc. / `'en'` \| `'bm'` |
| `aisar-approvals` | JSON queue of pending agent actions |
| `aisar-work-done:{bizType}` | Per-playbook completed work, **string indices** |
| `aisar-learn:{key}` | Self-improving demo — counts of user picks |

## Adding a playbook

```bash
node scripts/add-playbook.mjs --file spec.json          # or --deploy
```

Only `key` (lowercase/underscore, not `generic`) and `keywords` (3–8 terms, BM + EN) are required. The script injects into `PLAYBOOKS`, syntax-checks, asserts every keyword infers back to the new key, then inserts a demo chip in `app.html` and a type pill in `onboard.html` anchored on the existing `generic` entries. **If you move or rename those anchors the injection dies.** Re-extract the React data afterwards.

Demo chips are hidden unless `/app?demo=1`.

## Backend (`worker/`)

A Cloudflare Worker implementing the client's tool contract — risk gate, approval queue in D1, audit log. The app runs fully without it; set `VITE_API_URL` to route through it.

**Not deployed, and must not be until it has authentication.** `business` is caller-supplied, so any caller could read or approve another tenant's queue. No rate limiting, no webhook verification. Connector execution is stubbed in `src/connectors.ts` pending OAuth app registrations.

## Conventions

- HTML: two-space indent, Tailwind utilities, page-specific CSS/JS inline in that page.
- Engine JS: two spaces, semicolons, single quotes, camelCase, `var`, `kv`/`kv-` prefix.
- Escape interpolated strings with `kvEsc()` when building innerHTML.
- Preserve `prefers-reduced-motion` handling and accessibility labels.
- Commits: Conventional Commit subjects, one visible behaviour per commit.

## Gotchas

- `_next/static/` are deployed artifacts from an upstream Next.js build that is **not in this repo**. Treat as opaque. The React app does not load them — its design system was extracted into `design-system/` and reimplemented.
- `biz-engine.js` comments reference `AISAR-INTEGRATION-STRATEGY.md`, which is not in this repo. Don't go looking.
- The landing page is English-only in both implementations; only the dashboard is bilingual.
- `node_modules/` at the repo root is empty — the static site has no dependencies.
