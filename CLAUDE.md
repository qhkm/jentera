# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` carries the same house rules in shorter form. `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md` and `TECHNICAL_ARCHITECTURE.md` carry product direction — read those before changing what the product *does*, not just how it's built.

## React rebuild (`app/`)

```bash
cd app && pnpm install
pnpm dev        # :5173
pnpm build      # tsc -b && vite build
pnpm typecheck
```

Deploy with `./deploy.sh "msg"` — builds `app/` and publishes to the **`aisar-jentera`** project, live at `jentera.ai`. That project serves two hostnames, `jentera.ai` and `jentera.aisar.ai`, from the same deployment; `deploy.sh` verifies the first. Preview instead with `AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "msg"`. The script verifies the served CSS and JS are real assets, not the SPA fallback HTML, and fails loudly if they are not.

`app/README.md` has the detail. The parts worth knowing here:

- `app/src/lib/data/` is hand-maintained TypeScript. Add a playbook with `scripts/add-playbook.mjs`, which edits `playbooks.ts` directly — don't hand-merge.
- Controls share `--control-h` / `--control-pad-y`. A `text-*` or `py-*` utility on a `.btn`/`.input` overrides the component and breaks the shared height — this caused three separate visual bugs. Let components own their type and padding.
- The old static engine wrote work-done indices as **strings**; the app reads either format and writes strings, so existing users' approvals survive the cutover.

## localStorage keys

The full persisted surface. Changing or adding one affects the flow gates, so call it out in the commit.

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
node scripts/add-playbook.mjs --file spec.json
```

Only `key` (lowercase/underscore, not `generic`) and `keywords` (3–8 terms, BM + EN) are required. The script injects the new entry into `app/src/lib/data/playbooks.ts` ahead of `generic`, typechecks, and asserts every keyword infers back to the new key.

## Backend (`worker/`)

A Cloudflare Worker implementing the client's tool contract — risk gate, approval queue in D1, audit log. The app runs fully without it; set `VITE_API_URL` to route through it.

**Not deployed, and must not be until it has authentication.** `business` is caller-supplied, so any caller could read or approve another tenant's queue. No rate limiting, no webhook verification. Connector execution is stubbed in `src/connectors.ts` pending OAuth app registrations.

## Conventions

- TypeScript + React under `app/`, two-space indent, semicolons, single quotes, camelCase.
- Import shared modules via the `@/` alias rather than long relative paths.
- Preserve `prefers-reduced-motion` handling and accessibility labels.
- Commits: Conventional Commit subjects, one visible behaviour per commit.

## Gotchas

- `_next/static/` are deployed artifacts from an upstream Next.js build that is **not in this repo**. Treat as opaque. The React app does not load them — its design system was extracted into `design-system/` and reimplemented.
- The landing page is English-only; only the dashboard is bilingual.
