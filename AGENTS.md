# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite + React app deployed to Cloudflare Pages.

- `app/` is the whole product: source, build config, and tests. See `app/README.md`.
- `app/src/lib/data/` holds the playbook, connector, country, i18n, recommendation, and risk data. Add a playbook with `scripts/add-playbook.mjs`, not by hand-editing it.
- `design-system/` documents the design system extracted into `app/src/styles/`.
- `_next/static/` stores exported CSS and font assets from the upstream build this design system was reverse-engineered from; not loaded by the app.
- `_headers` defines Cloudflare cache behavior: immutable for hashed assets, no-cache for everything else.
- `worker/` is the deployed backend (Neon via Hyperdrive, magic-link auth, RLS per tenant); the app can call it via `VITE_API_URL`, and runs on localStorage without it. No rate limiting, no webhook verification, no server-side tests yet.
- `PRODUCT_VISION.md` defines the target customer, positioning, language, and product principles.
- `TECHNICAL_ARCHITECTURE.md` defines the managed-agent boundary, backend components, safety model, and MVP sequence.

## Development, Verification & Deployment

Run commands from `app/`:

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck
pnpm test
pnpm build        # tsc -b && vite build
```

Before committing, visit `/`, `/onboard`, `/setup`, and `/app`; check browser-console errors, mobile layout, navigation, and local-storage-driven flows.

Use `./deploy.sh "type: concise description"` from the repository root only when intentionally releasing: it builds `app/` and publishes to the `aisar-jentera` Pages project, live at `jentera.ai` and `jentera.aisar.ai`. The apex `aisar.ai` is a separate project and is only published with `AISAR_PAGES_PROJECT=aisar ./deploy.sh "msg"`.

## Coding Style & Naming Conventions

Match the surrounding style. TypeScript and React under `app/`, two-space indentation, semicolons, single-quoted strings, camelCase. Import shared modules via the `@/` alias rather than long relative paths. Preserve accessibility labels, responsive behavior, and `prefers-reduced-motion` handling.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style subjects, primarily `fix:` and `feat:`, followed by a concise, outcome-focused description. Keep each commit scoped to one visible behavior. Pull requests should describe affected routes, manual verification performed, and deployment/cache implications. Include before-and-after screenshots for visual changes and call out any changes to `_headers`, shared storage keys, or onboarding data.

## Generated & Local Files

Do not commit `.wrangler/` or other local preview state. Treat `_next/static/` assets as deployed artifacts: remove or replace them only after confirming every HTML reference remains valid.
