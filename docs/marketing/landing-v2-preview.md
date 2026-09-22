# Landing V2 — independent review concept

22 September 2026. Local preview only; not deployed or selected as the homepage.

- `/` retains the committed original landing. The uncommitted mascot-only
  changes to `Landing.tsx` and `entrances.css` have been reverted precisely.
- `/landing-v2` is a lazy-loaded alternative based on the owner's light
  reference: split hero, bot lineup, tools, three steps, product evidence and
  dark closing CTA. Its CSS is scoped under `.lv2`, not shared landing classes.
- Onboarding, bot configuration and their artwork are retained unchanged.
- The preview has an explicit comparison link, no public navigation link,
  no sitemap entry, and noindex/nofollow metadata and Cloudflare header.
  It is unlisted, not access-controlled. The build emits its own noindex shell.
- Existing transparent emerald artwork is reused. CSS hue variations represent
  example roles, not new assets or newly granted capabilities.
- The hero and finished-work section use newly generated transparent 3D
  illustrations, not real screenshots. Both are labeled as concepts, not live
  product UI or customer evidence. Prompts and assets are recorded in
  [landing-v2-artwork.md](landing-v2-artwork.md).
- A keyboard-accessible sun/moon toggle switches the entire V2 page between
  light and dark. Light is the initial default; `jentera-landing-v2-theme` stores
  the visitor's selection. This new localStorage key is preview-only and never
  changes the app's theme or flow gates. Blocked storage still allows toggling
  during the current visit. The original homepage stays unchanged.
- No invented testimonials, customer counts or trust badges.
- Connections name only supported services, noting the Calendar pilot and
  variable website access. Bots share the business workspace, not one VM each.
- CTAs use the current sign-in route and shared launch pricing. No new offer,
  payment behavior, analytics event or production deployment is introduced.

Review both routes on desktop and mobile before choosing a direction. Publishing
V2 as the homepage requires a separate explicit decision; this change does not
redirect or replace `/` or `/ms`.

## Local verification — illustrated light/dark revision

- Typecheck and production build pass; the emitted preview shell is noindex.
- 55 focused landing, preview and SEO tests pass, including theme persistence,
  unavailable storage, generated artwork and mobile navigation.
- Chrome checks: both themes at 320, 390, 768, 900 and 1440px; no horizontal
  overflow, both illustrations loaded, theme control visible. Reduced-motion
  preference disables the hero animation. Mobile menu links dismiss the menu.
- Desktop and mobile captures: `/tmp/jentera-v2-{light,dark}-{1440,390}.png`.
- Original landing source and stylesheet still match HEAD. No deployment.
