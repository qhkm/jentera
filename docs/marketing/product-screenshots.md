# Product walkthrough screenshots

Implemented and deployed, 12 September 2026. Captures live under
`app/public/images/product-tour/`; the walkthrough appears immediately after the
homepage hero. The secondary hero link opens it. Existing hero wording is unchanged.

Actual app components captured with fictional local API fixtures. These are
illustrations of available screens, not customer records or measured outcomes.
No production credentials or requests are used. Approval illustrates the existing
terminal permission card, not an unavailable customer-messaging integration.

Regenerate from `app/`:

```sh
VITE_API_URL=http://127.0.0.1:5179 pnpm dev --port 5179
# In a second terminal (omit CHROME_CHANNEL to use bundled Chromium):
CHROME_CHANNEL=chrome node scripts/capture-product-tour.mjs
```

Desktop and mobile captures are separate, tightly cropped screenshots. Keep the
visible demo disclosure in ProductTour. Bump the asset suffix when replacing
published screenshots so cached images cannot lag a new interface.

Verification: all 485 frontend tests pass (67 files), including keyboard screenshot
selection and asset-existence coverage. Production build passes. Browser checks at
1440px and 390px verified all four images load, the appropriate responsive source
is selected, and no horizontal overflow or JavaScript exceptions occur. Fixed
bottom navigation is excluded from cropped captures so it cannot obscure content.
No storage keys, API contracts, or cache headers changed.

Production: commit `c2ccd41`, Pages deployment
`b9c15206.aisar-jentera.pages.dev`, entry asset `/assets/index-AVW07pMa.js`.
Both `jentera.ai` and `jentera.aisar.ai` serve that build; all eight live PNGs
match their local SHA-256 hashes. Live Chrome checks at 1440px and 390px passed
the hero link, all four screenshot selectors, responsive image selection, and
image decoding without JavaScript errors or horizontal overflow. Backend and
runtime were not redeployed; `aisar.ai` was not touched.
