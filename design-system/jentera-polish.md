# Jentera visual polish · 8 September 2026

The existing charcoal, mint, Geist Sans and Geist Pixel Square theme remains the foundation.

- Identity: a geometric J with a separate square, drawn as SVG paths so it stays sharp at favicon sizes. `app/public/favicon.svg` is the shared source used by `JenteraMark`; the root favicon and the state-coloured `WorkPulse` carry the same geometry.
- Landing: a restrained entrance animation, a highlighted 24/7 phrase, trade-specific preview icons, and illustrated enquiry, checklist, report and approval cards. Examples stay explicitly labelled. Business categories use the existing Phosphor icon mapping.
- Dashboard: prominent access to Ask Jentera, summary metrics, review links, dated activity records, and shortcuts to business knowledge and connections. Empty, loading and error states continue to use the repository's actual state.
- Chat: starting suggestions fill the composer and leave sending to the owner. Existing conversations and account-scoped history are preserved.
- Accessibility: reduced motion remains supported; muted text and neutral labels have stronger contrast; onboarding steps have a main heading. New dashboard copy is available in English and Bahasa Malaysia.

No storage keys, API contracts, cache headers or backend behavior changed.

Verification: full frontend suite (237 tests), production build, desktop/mobile browser review, English/Bahasa Malaysia, dark/light themes, and populated/empty/loading/error dashboard fixtures. Browser fixtures are isolated and never send requests to a real business account.
