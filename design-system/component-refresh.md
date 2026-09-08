# Component refinement · 8 September 2026

Reference: [Naive's current public site](https://usenaive.ai/), inspected in a
browser at desktop and mobile sizes. This updates the original extraction's
component treatments while keeping Jentera's charcoal surfaces, mint accent,
and existing-business positioning.

- Use Geist Pixel **Square** for display headings, from the installed Geist
  package. Use Geist Sans for controls and smaller public-page card titles.
- Buttons use a 12px radius and sentence case. Inputs use an 8px radius.
  The shared control height is 44px to provide a consistent touch target.
- Cards use a 16px radius, subtle borders, and restrained surface contrast.
- Public navigation sits in a floating, rounded frame. Tabs use an inset
  selected state; their keyboard behavior and selection semantics stay intact.
- Keep mono text for metadata and compact status labels.

Shared values live in `app/src/styles/tokens.css` and `theme.css`; public-page
composition lives in `component-refresh.css`. Both light and dark themes resolve
through existing color tokens. No reference-site artwork or product copy is used.
