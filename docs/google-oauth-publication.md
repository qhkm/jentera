# Google OAuth publication checks

Prepared 16 September 2026. This is a review checklist, not confirmation of
Google approval, legal enforceability or complete security compliance.

## Branding fields

After the web changes are intentionally deployed and the public HTML is checked:

- Application home page: `https://jentera.ai/`
- Application privacy policy: `https://jentera.ai/privacy`
- Application terms of service: `https://jentera.ai/terms`
- Authorised domain: `jentera.ai`
- OAuth redirect: `https://api.jentera.ai/api/auth/google/callback`

The legal routes render without authentication or API access and are statically
prerendered so their full English text is available without JavaScript. Both
offer Bahasa Malaysia in the browser and are linked from the homepage footer.
`/terms` uses the same no-cache policy as `/privacy`; its trailing slash
redirects to the canonical URL and it is included in the public sitemap.
Publishing these URLs does not change the OAuth audience or verify the app.

Verification from `app/`: `pnpm typecheck`, `pnpm test`, `pnpm build`,
`pnpm verify:seo`. For browser checks, serve `app/dist` on port 4175, then run
`CHROME_CHANNEL=chrome node scripts/check-legal-pages.mjs`. This uses anonymous
API fixtures only and checks public English HTML, EN/BM switching, phone/desktop
overflow, console/hydration errors and the four existing lifecycle routes.

## Owner review before publication

- Confirm the operator, SSM number and monitored contact email already used in
  the privacy notice are correct.
- Have Malaysian counsel review the terms, privacy disclosures, international
  transfers, retention/deletion procedures and how user agreement is obtained.
  This change does not add a recorded terms-acceptance flow or retroactively
  prove users accepted a version.
- Verify actual subprocessors and their contractual data-use/retention terms.
  Calendar event information can enter model prompts; the current Worker sends
  model calls directly to DeepSeek (`AISAR_MODEL_BASE`). Do not claim provider
  no-training, contractual processor-only use or full Google Limited Use
  compliance without evidence that covers this API account and downstream data.
  The general DeepSeek privacy policy excludes downstream-app processing rules,
  so it is not evidence of an API no-training agreement.
- Confirm support can fulfil access and deletion requests across application
  records, private attachments, business-computer copies and provider retention.
  Disconnecting Calendar does not erase historic chats or created events.
- Keep Calendar on a controlled pilot until the above checks and real owner
  authorisation/read/approved-create/disconnect tests are complete. Do not
  silently publish the Google OAuth audience to bypass review.

## Google review

- Add the exact pilot Google accounts under Google Auth Platform → Audience →
  Test users. Calendar authorisations in Testing expire after seven days.
- Verify domain ownership through Search Console using a project owner/editor.
- Configure the public homepage and policy URLs in Branding; check that each
  returns real public content rather than sign-in or a SPA soft 404.
- Declare the scopes requested in code: `openid`, `email`, `profile`,
  `https://www.googleapis.com/auth/calendar.events.owned`.
- Complete branding and any required sensitive-scope review. Provide accurate
  scope justification and a demonstration of sign-in, optional Calendar
  consent, bounded reads, owner-approved event creation and disconnection.

The permission permits event management on owned calendars; current Jentera
tools only read the primary calendar (31-day ranges, at most 50 events per call)
and create events after owner approval. Editing/deletion, Gmail, Drive and
universal browser-action approval enforcement are not implemented by this flow.

## References

- [Google branding and public policy requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google audience and Testing limits](https://support.google.com/cloud/answer/15549945?hl=en)
- [DeepSeek general privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [Malaysia privacy-notice guidance](https://www.pdp.gov.my/ppdpv1/en/akta/guidance-on-the-preparation-of-personal-data-protection-notices/)
