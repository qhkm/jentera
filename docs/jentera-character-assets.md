# Jentera character artwork

The owner selected a glossy character family on 22 September 2026. The emerald
character is used on the alternative landing preview (`/landing-v2`),
conversational onboarding and source loading screen. The original landing (`/`)
has been restored; the original robot and flat SVG concepts are retained.

- Owner's reference: `ChatGPT Image Sep 22, 2026, 05_35_21 PM.png` (six coloured characters).
- Web asset: `app/public/images/jentera-character-glossy-v1.webp`, 512 × 512,
  with transparency. WebP encoded at quality 92, alpha quality 100.
- Extraction: built-in imagegen, using the owner's image as the edit target.
  This is an AI-assisted cutout, not a pixel-exact crop of the original.
- Animation: CSS float/greeting around the whole image; no simulated eye
  blinking on this raster asset. Reduced-motion preferences are respected.

## Final extraction prompt

For the later five-style/colored-bot sheet and avatar picker, see
[AI bots and avatars](ai-bots-and-avatars.md). Those avatars use CSS crops of
the owner's supplied sheet, not generated cutouts.

Use case: background-extraction. Image 1 is the edit target. Extract ONLY the
large central emerald/turquoise-green smiling character (third from left) as a
clean transparent-background website mascot. Preserve its exact identity: soft
glossy rounded bean-square body, vivid turquoise green material with pale mint
rim highlight, two black upright oval eyes with tiny white highlights, black
curved happy smile, the floating mint rounded square and TWO mint accent strokes
above its top-left. Preserve proportions, expression, facing direction and 3D
lighting from the provided image. Remove all five other characters and the
entire dark background, floor and cast floor shadow. No redesign, no additional
features, no text. Output a single centered character on genuine RGBA
transparency, square canvas, tightly framed with about 8 percent transparent
padding so all upper accent strokes are visible; preserve soft edge antialiasing
without a dark halo.
