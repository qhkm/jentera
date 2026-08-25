# Design system readout

Reverse-engineered from the prebuilt CSS shipped in `_next/static/chunks/`. Everything documented here was read out of `07r-6xz-uoanc.css` (197 KB) and `391k8ovo_r0qj.css` (14 KB); nothing is guessed.

## Where the design system actually lives

**`app/src/styles/` is the source of truth.** This folder is documentation — the *why*
behind the tokens — and holds no CSS of its own.

| File | Lines | Holds |
|---|---|---|
| `app/src/styles/tokens.css` | 225 | Semantic custom properties, both themes |
| `app/src/styles/theme.css` | 450 | Component classes: `.btn`, `.card`, `.input`, `.tag`, `.chip`, control sizing |
| `app/src/styles/fonts.css` | 60 | `@font-face` for Geist and JetBrains Mono |
| `app/src/styles/landing.css` | 191 | AISAR marketing page only — not part of the system |

This folder previously carried its own `tokens.css` and `theme.css`. They were a snapshot
taken at extraction and drifted badly: 49 changed lines in the tokens and 200 in the theme,
against 19 commits to the app's copies and 5 to theirs. Most damagingly they still had
`--bg: #000`, the pure-black ground that `0322bca` deliberately lifted to `#1f1f1f`. Anyone
seeding a new project from them would have inherited a fixed bug. They were deleted on
2026-08-21 rather than resynchronised, because two copies of one thing is the problem, not
the fix. Recover them from `63baaa1` if you ever need the historical state.

`ink-and-strength.html` beside this file is the rendered readout — open it in a browser to
see the alpha ladder, the semantic tokens, the easing curves and the light-mode swatches
drawn rather than described. **Its dark swatches are stale for the same reason** (`#000`
and `#161616` appear in it); the structure it illustrates is still accurate, the two
darkest values are not.

## What the upstream stack was

- **Tailwind v4** — the `@layer theme` / `@layer properties` structure and `--tw-*` property registration are v4-specific.
- **Next.js** with `next/font` — CSS-module-hashed font variables (`geist_a71539c9-module__T19VSG__variable`) on the `<html>` element.
- **Lightning CSS** — `--lightningcss-light` / `--lightningcss-dark` sentinels appear in both theme blocks.
- The palette was **tree-shaken**: only shades actually used in the real product survived. That pruned set is a precise readout of their working range, which is why `tokens.css` ships it as-is.

## The one idea worth stealing: ink + strength borders

Borders are never hardcoded. They're composed:

```css
--border-ink:      255 255 255;   /* 0 0 0 in light theme */
--border-strength: .1;

--border:       rgb(var(--border-ink) / calc(var(--border-strength) * .7));    /*  7%  */
--rail:         rgb(var(--border-ink) / var(--border-strength));               /* 10%  */
--border-light: rgb(var(--border-ink) / calc(var(--border-strength) * 1.35));  /* 13.5% */
```

Flipping `--border-ink` between white and black re-themes every border in the product, and `--border-strength` is a single global contrast dial. Three tiers derived from one number, so they can never drift out of relationship with each other.

The same discipline runs through the surfaces — there are no opaque grey fills anywhere. Everything is an overlay at a fixed step on the alpha ladder:

| Step | Role |
|---|---|
| `.02` | card fill |
| `.07` | progress track |
| `.10` | default border |
| `.12` | raised border, toggle track |
| `.15` | input border |
| `.45` / `.50` | tag / chip label ink |

That's why the UI reads as one material rather than a set of separately-styled boxes.

## Themes

Two, and the light one is the interesting half.

| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#1f1f1f` | `#fbf9f6` |
| `--bg-card` | `#262626` | `#efedeb` |
| `--bg-card-hover` | `#2e2e2e` | `#eee` |
| `--text` | `#fff` | `#000` |
| `--text-secondary` | `#b4b4b4` | `#555` |
| `--text-muted` | `#8a8a8a` | `#6e6e6e` |
| `--border-ink` | `255 255 255` | `0 0 0` |

The dark ground is **`#1f1f1f`, not black**. It was `#000` at extraction and was lifted
deliberately: pure black gives cards nothing to sit on, so every surface had to be
separated by a border rather than by fill. Raising the ground two steps let the alpha
ladder do that work instead. Going back to `#000` undoes the whole surface system.

Light mode is **warm paper (`#fbf9f6`), not white** — and the card surface is a warmer grey than a neutral tint would give. That's a deliberate signature; a naive `#fff` / `#f5f5f5` light theme loses the character immediately.

Scoping is `:root` for dark, `html.site-theme-light` / `body.site-theme-light` to flip. The static site pins `site-theme-dark` on `<html>` and never uses light.

## Type

| Role | Stack |
|---|---|
| Sans | Geist Sans → DM Sans → system |
| Mono | Geist Mono → SF Mono → IBM Plex Mono |
| Pixel (display) | Geist Pixel Circle → monospace |
| Nav | JetBrains Mono → Geist Mono |

Five Geist Pixel cuts are shipped (Circle, Grid, Line, Square, Triangle) but only **Circle** is wired to `--font-pixel`. The other four are dead weight in this repo.

There's an optical-compensation set for the pixel face, applied by size — worth keeping, since pixel faces get visually heavy at display sizes:

```css
--pixel-stroke-display:    .5px;
--pixel-stroke-heading-sm: .2px;
--pixel-stroke-logo:       .15px;
```

Scale is stock Tailwind (`--text-xs` … `--text-9xl`), weights 300–700, tracking `-.05em` … `.1em`.

### Sourcing the fonts

Do **not** reuse the `.woff2` files in `_next/static/media/` — they're content-hashed subsets from someone else's build, tied to CSS-module class names you'd have to reverse too. Install from source instead:

- **Geist / Geist Mono** — `npm i geist`, or `vercel/geist-font`. SIL OFL 1.1.
- **JetBrains Mono** — `npm i @fontsource/jetbrains-mono`. SIL OFL 1.1.
- **DM Sans / IBM Plex Mono** — fallbacks only; Google Fonts, both OFL.
- **Geist Pixel** — newer Vercel release. Confirm its license terms before shipping; I did not verify it, and it's the one face here I wouldn't assume is OFL.

With `next/font` or `@fontsource`, the `--font-geist-sans` style variables regenerate automatically and the hashed module classes on `<html>` disappear.

## Motion

One dominant curve, used 14× across the CSS:

```css
--ease-signature: cubic-bezier(.22, 1, .36, 1);
```

Fast out, long settle, no overshoot. Everything interactive uses it. Duration ladder: **75 ms** (active press), **.15 s** (default, dominant), **.2 s**, **.3 s** (toast/drawer).

The `.15s` default paired with that curve is most of why the UI feels crisp rather than floaty. `theme.css` sets it as Tailwind's `--default-transition-*` so it applies without anyone remembering to.

## Radii

`4px` tag → `8px` nav item → `10px` avatar / option → `12px` card → `999px` chip, progress, toggle. Small elements get tight radii, containers get 12, anything pill-shaped goes fully round. No 16px+ rounding anywhere.

## Component grammar

The recognisable texture is **mono + uppercase + wide tracking (`.12em`) at tiny sizes (9–10 px)** for every label, tag, chip, and eyebrow — set against normally-tracked sans body copy. That contrast is doing most of the stylistic work.

Accent is `#00d294` (exactly `emerald-400` from their palette) with its own alpha ladder: `.12` fill, `.3`–`.6` borders, `.75`–`.8` text. It's used for state (active, live, connected), never for large fills.

## Upstream vs. AISAR-added

Worth knowing which half is which before you rebuild:

| | Where | What |
|---|---|---|
| **Upstream** | `_next/static/chunks/` | All tokens, both themes, border system, type scale, fonts, `.btn*`, `.link`, `.nav-link`, `.section-eyebrow`, `.cli-chip` |
| **AISAR-added** | inline `<style>` in the static site's HTML pages (~17 KB in the former `app.html` alone; the static site is gone, see `theme.css` for where this lives now) | Every `.as-*` and `.kv-*` class — cards, tags, chips, sidebar, chat UI, drawer, toast, toggle, avatar, steps |

The AISAR layer is more systematic than it looks; it just wasn't tokenized. `theme.css` promotes it into proper components (`.card`, `.tag`, `.chip`, `.avatar`, `.input`, `.progress`).

## The light-first / dark-first trap

**The upstream design system is light-first.** Its `.btn-primary` is `background: var(--color-black); color: var(--color-white)` — black button on a light page.

The static site ran dark and inverted that, which was the entire origin of its override war: the prebuilt chunk sets `padding-block: 0 !important` inside `@layer components`, and unlayered `!important` *loses* to a layered rule regardless of importance. Hence the duplicated `@layer components` block that used to sit at the top of all four HTML files.

**In the React rebuild this problem does not exist**, because you generate the CSS yourself. `theme.css` authors the buttons dark-first with the semantic vars, so nothing needs overriding. Do not port the old `!important` block across — it's a workaround for a constraint you're leaving behind.

## Using it in this repo

`app/src/styles/index.css` already wires everything, in this order:

```css
@import "tailwindcss";
@import "./fonts.css";
@import "./tokens.css";
@import "./theme.css";
@import "./landing.css";
```

Then `bg-bg`, `text-text-muted`, `border-rail`, `font-pixel`, `ease-signature`, `.card`,
`.tag`, `.chip` are all available. Theme switching is one class on `<html>`.

## Reusing it in another app

Copy these three files — they are plain CSS with no framework dependency, so they work in
React, Vue, Svelte, or hand-written HTML:

```
app/src/styles/tokens.css     →  the palette and both themes
app/src/styles/theme.css      →  the component classes
app/src/styles/fonts.css      →  the faces
```

Skip `landing.css` — it is AISAR's marketing page, not part of the system.

For React, `app/src/components/ui/index.tsx` (140 lines) is a thin set of wrappers over
those classes: `Button`, `Card`, `Tag`, `Chip`, `Eyebrow`, `Avatar`, `Input`, `Progress`,
`Section`. `Tabs.tsx` and `Toast.tsx` are generic too. Do **not** take `Shell.tsx` (AISAR's
navigation) or `Icon.tsx` (a domain-specific emoji map).

Install the fonts from source rather than copying `.woff2` files — see *Sourcing the fonts*
above.

### Two traps that cost real debugging time here

**Controls own their own type and padding.** `.btn` and `.input` share `--control-h` and
`--control-pad-y` so they line up. Putting a `text-*` or `py-*` utility on either overrides
the component and silently breaks the shared height. That caused three separate visual bugs
in this repo before the pattern was understood. Let the component own it.

**Cascade layers outrank importance.** A rule inside `@layer components` beats an unlayered
`!important` rule, regardless of the `!important`. If a rule mysteriously wins or loses,
check layering before you check specificity. This is only a problem when you inherit
someone else's layered CSS — authoring your own from these files, it does not arise.

### Making it yours rather than a clone

Keep the **structure**: ink+strength borders, the alpha ladder, the mono-uppercase label
texture, the signature curve, the warm light mode. Change the **accent** off `#00d294` and
the display face off Geist Pixel. Those two carry nearly all of the brand identity; the
rest is a well-built neutral chassis.

