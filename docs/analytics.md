# Launch analytics

## Google Analytics 4

Public measurement ID: `G-VF5X89K0MC`. No secret or Google account credentials
are required in the frontend.

`app/src/components/GoogleAnalytics.tsx` observes public routes and obtains an
optional analytics choice. The script is asynchronous and does not load before
opt-in. The browser choice key is `jentera-google-analytics-choice-v1`, valid for
180 days. Global Privacy Control / Do Not Track overrides acceptance. Native
shells, localhost and Pages preview domains never send production GA events.

Only explicitly allowed public pages are tracked. URLs sent in pageviews omit
queries/fragments; titles come from public metadata, and referrers retain only
the origin. Unknown query parameters block the tag. When a Google-tagged public
SPA enters a private route, a navigation boundary disables Google measurement
and opens a new document without loading the tag. Private sign-in, onboarding,
Chat, billing, admin, join and workspace screens are not instrumented by GA.

Visitors can change their preference at `/privacy#analytics-settings`. Withdrawal
disables GA, clears accessible `_ga` cookies and reloads to unload third-party
code. Storage failure denies tracking; a failed withdrawal write still disables
measurement for the current document. Other existing analytics is separate.

### Required Google-side settings before release

In **Admin → Data streams → Jentera web stream**:

1. Turn **Enhanced measurement OFF**. We send manual pageviews; automatic
   history pageviews cause duplicates even with `send_page_view: false`.
   Forms, site search, outbound clicks and file downloads must not be collected.
2. Do not enable Google Signals, advertising personalization or user-provided
   data collection. The code also denies advertising consent and signals.
3. Enable email redaction and redact sensitive query parameters as defence in
   depth (for example `email`, `token`, `code`, `state`, `session_id`, `next`).
4. Choose suitable GA retention and account data-sharing settings. GA retention
   is controlled in Google, separately from our 180-day browser consent expiry.

No access to the Google property was available during implementation; these
settings must be verified by the property administrator. This is public-page
traffic tracking, not a finished signup-to-paid funnel. Do not treat a client
button click or checkout return URL as evidence of payment.

The operator confirmed Enhanced measurement was turned off on 17 September
2026. Other property settings and real ingestion still require verification.

### Campaign links

Use approved, non-personal labels only. Example:

`https://jentera.ai/?utm_source=whatsapp&utm_medium=social&utm_campaign=launch`

The source allowlist covers facebook, instagram, whatsapp, tiktok, google,
telegram, linkedin, youtube and email. Medium values are social, paid_social,
email, referral, cpc and organic. Campaigns are launch, jentera_launch and
launch_2026. Optional content values are hero, footer, announcement, founder,
launch_post and referral. Unknown or duplicate parameters disable GA for that
URL. Never put customer names, email addresses or tokens in campaign labels.

### Verification after an intentional deployment

Preserve the current live API, access-mode and checkout build configuration when
releasing. A developer's local environment is not authoritative billing/access
configuration. Local fixtures prove neither live signup nor paid activation.

Open a public page, allow analytics, then inspect GA **Reports → Realtime**.
Navigate to Pricing: each route should produce one pageview. Choose “No thanks”
in a fresh browser: no Google script or measurement request should occur.
Open Sign in from an opted-in public page: the new document must not request the
Google tag. Check the privacy preference control, DNT/GPC and mobile layout.

Automated QA must stub Google script/collection requests rather than polluting
the live property with fictional traffic. No real signup, checkout or payment
is required to test the tag integration.

References: [Google pageviews](https://developers.google.com/analytics/devguides/collection/ga4/views),
[consent mode](https://developers.google.com/tag-platform/security/guides/consent),
[avoiding PII](https://support.google.com/analytics/answer/6366371).

## Existing measurement

Cloudflare injects Web Analytics on the live custom domains; it is separate from
the GA tag. First-party activation events go to `/api/events` and the configured
`jentera_product` Analytics Engine dataset. Worker observability provides API
logs. The launch admin view contains limited server-observed trial milestones,
not a full visitor → signup → first successful task → trial limit → paid funnel.
