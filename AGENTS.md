# Repository Guidelines

## Project Structure & Module Organization

This repository is a build-free static website deployed to Cloudflare Pages.

- `index.html` contains the public landing page.
- `onboard.html`, `setup.html`, and `app.html` implement the onboarding and dashboard flow.
- `biz-engine.js` contains shared client-side state, translations, navigation, and business-demo behavior.
- `_next/static/` stores exported CSS and font assets referenced by the HTML pages.
- `_headers` defines Cloudflare cache behavior for pages and shared scripts.
- `scripts/add-playbook.mjs` updates playbook data in `biz-engine.js`.
- `spec-minimart.json` is sample business input; `deploy.sh` publishes the site.
- `PRODUCT_VISION.md` defines the target customer, positioning, language, and product principles.

There is no separate source/build directory. Edit the deployed HTML, JavaScript, and assets directly.

## Development, Verification & Deployment

Run commands from the repository root:

```bash
wrangler pages dev . --port 5173
```

This serves the site with Cloudflare Pages routing, including extensionless paths such as `/app` and `/onboard`. Open `http://localhost:5173/` for the landing page.

There is no compilation step or automated test command. Before committing, visit `/`, `/onboard`, `/setup`, and `/app`; check browser-console errors, mobile layout, navigation, and local-storage-driven flows. A quick response check is:

```bash
curl -I http://localhost:5173/
```

Use `./deploy.sh "type: concise description"` only when intentionally releasing: it stages all changes, commits, pushes `main`, and publishes to Cloudflare Pages.

## Coding Style & Naming Conventions

Match the surrounding style. HTML uses two-space indentation and utility classes; keep inline page-specific CSS and scripts localized. JavaScript uses two spaces, semicolons, single-quoted strings, and camelCase functions. Shared helpers and DOM IDs commonly use the `kv`/`kv-` prefix. Preserve accessibility labels, responsive behavior, and `prefers-reduced-motion` handling. Update cache-busting query strings when changing cached shared assets.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style subjects, primarily `fix:` and `feat:`, followed by a concise, outcome-focused description. Keep each commit scoped to one visible behavior. Pull requests should describe affected routes, manual verification performed, and deployment/cache implications. Include before-and-after screenshots for visual changes and call out any changes to `_headers`, shared storage keys, or onboarding data.

## Generated & Local Files

Do not commit `.wrangler/` or other local preview state. Treat `_next/static/` assets as deployed artifacts: remove or replace them only after confirming every HTML reference remains valid.
