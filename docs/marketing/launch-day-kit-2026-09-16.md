# Jentera launch-day kit

Prepared 16 September 2026. Drafts only: no post, email, customer invitation,
paid entitlement, merge or deployment is authorized by this document.

## Current launch decision

**Paid self-serve checkout: not ready.** The live Stripe catalog is verified, but
the paid checkout endpoint is absent and the hardened Stripe branch is unmerged,
deliberately local-sandbox-only. Its trial/credit helpers do not enforce agent
usage yet. Announcing an invitation-based early-access opening is an option;
do not represent it as the planned ten-question self-serve trial or paid launch.

The following table records the initial preparation check. The public offer/UI
row was superseded by the authorized frontend release below; backend and paid
checkout were not released by that deployment.

The production site was checked directly during this preparation:

| Area | Observed status |
| --- | --- |
| Landing, waitlist, sign-in, privacy, terms | HTTP 200 |
| API health, database | Passed existing read-only health check |
| Task queue | No queued/leased task older than 15 minutes |
| Runtime fleet | 17 active runtime records matched their desired releases; none in error/deleting. All 18 listed computers were cold at the check |
| Access policy | `/api/access`: `restricted: true`; no anonymous founder invitation |
| Billing | `/api/billing/status`: HTTP 404; no Stripe API or webhook secret names configured in Worker |
| Founder support | No `LAUNCH_FOUNDER_GROUP_URL` secret configured; invite remains private and payment-only |
| Public offer | Live landing still had the old headline and lacked RM199 disclosure in its HTML; updated local landing requires release |
| Observability | Workers observability enabled in source; health launchd job loaded with last exit 0; pulse job loaded with last exit 9. End-to-end alert delivery not verified |

HTTP 200 is not proof of working signup, file analysis, payment or useful work.
The health script matches observed versus desired releases; it does not prove
every runtime is on the latest globally requested release. Cold computers wake
on demand, so do not advertise an instant first reply. No runtime was woken or
updated by this check. No live account, file, agent job or payment was created.

## Early-access announcement — usable after checking the public signup path

### Bahasa Malaysia

Hari ini saya memperkenalkan Jentera — Staf AI untuk bantu kerja harian bisnes.

Mulakan dengan satu kerja yang selalu berulang: draf laporan, susun maklumat,
buat kajian, atau sediakan mesej susulan untuk anda semak.

Kami membuka akses awal secara jemputan. Sertai senarai menunggu di
https://jentera.ai/waitlist dan beritahu kami kerja yang anda mahu Jentera bantu.

Tiada bayaran hari ini. Langganan belum dibuka. Tawaran langganan yang dirancang:
RM99/bulan untuk 3 bulan pertama, kemudian RM199/bulan. Had penggunaan dan terma
akan diterbitkan sebelum pembayaran dibuka.

Kami mahu bina produk ini bersama pengguna awal dan dengar maklum balas anda.

Apa kerja paling repetitive dalam bisnes anda sekarang?

### English

Meet Jentera — AI Staff to help with your business’s everyday work.

Start with one repetitive task: draft a report, organise information, research
an option, or prepare a follow-up message for you to review.

We’re opening invitation-based early access. Join at
https://jentera.ai/waitlist and tell us the first task you’d like help with.

No payment today; subscriptions are not open yet. The planned launch subscription
is RM99/month for your first 3 months, then RM199/month. Usage limits and terms
will be published before checkout opens.

We’d love to build Jentera together and listen to your feedback.

What is one piece of work you repeat every day or every week?

## Waitlist appreciation email — draft, do not send automatically

Subject: Thank you for joining Jentera early

Thank you for being here at the beginning of Jentera.

We want to build a genuinely useful AI Staff for your business, together with
our early users. Your ideas, questions and feedback will help shape the product.

What is one task you repeat every day or every week? Reply and tell us how you
currently do it. We’ll use that to help find a useful place to start.

Access is invitation-based for now. Joining the waitlist does not create a paid
subscription or guarantee an invitation. There is no payment today.

— The Jentera founder

Send only through the reviewed announcement path to eligible recipients, with
a verified working reply-to and unsubscribe address. Preview first and approve
the actual audience before sending. Do not include the private WhatsApp group
invite: joining the waitlist or creating an account is not payment evidence.

## Post-payment appreciation — hold until actual payment verification

Thank you for supporting Jentera early. You’re helping us build something
awesome, and we’d love to work together and listen to your feedback.

You’re invited to our Founder WhatsApp Group for direct access to the founder:
share ideas, report an issue, or get help with your first workflow.

Use the private invitation shown in your platform account after verified
payment. Joining is optional. Other members may see your WhatsApp profile and
what you share; please keep passwords, customer data and confidential files out
of the group.

No URL belongs in this public document or the frontend bundle. The automated
paid appreciation sender is not implemented yet; do not promise it is live.

## Before publishing a paid-launch announcement

- [ ] Rotate the exposed restricted key; review Stripe request logs; put the
  replacement runtime key in the Worker secrets vault, not chat or source.
- [ ] Reconcile the Stripe branch and migration numbering without restoring
  the deferred external-trigger pilot. Keep payment disabled until verified.
- [ ] Wire one monthly launch plan to its verified Price **and** Coupon; do not
  configure the generic current route with the RM199 Price alone.
- [ ] Finish first-purchase identity/account ownership and mandatory signed,
  durable payment/subscription/invoice webhooks, including failures, renewal,
  cancellation, refunds/disputes, duplicate and out-of-order delivery.
- [ ] Enforce the ten-query trial and published included allowance/cost caps on
  app, Telegram, routines/resumes and model/computer/tool execution; no unlimited
  usage claim. State any top-up price, credited amount and expiry before sale.
- [ ] Publish reviewed renewal, cancellation/refund, usage/credit and support
  terms and confirm tax treatment/required registrations. Do not enable automatic
  tax based on a flag alone. Confirm whether RM99 is the final customer total.
- [ ] Verify payment-only founder invitation and appreciation delivery; check
  optional joining, group admission and support eligibility.
- [ ] Run isolated payment canaries through RM99 months 1–3 and RM199 month 4.
- [ ] Release the verified frontend first, then compatible backend; verify served
  assets, headers, public offer, signup and billing on the actual live host.

The implementation giveaway remains out of public copy until its rules,
eligibility, selection method, dates and fulfilment scope are decided.

## First-customer smoke — fictional/non-sensitive data only

1. Start in a fresh phone browser. Verify a real signup and sign-in round trip;
   a waitlist submission alone is not an account. Check the welcome and access
   instructions. For an invited trial, explicitly redeem an issued invitation.
2. Describe the business, choose one repetitive task, review facts and continue
   to computer setup. Never mark the computer ready merely because a timer ends.
3. Ask: “Draft a short follow-up message for a customer asking about our service.
   Don’t send it anywhere.” Check for a useful result and no external sending.
4. Upload a picture containing fictional product details and ask what it shows.
   Then upload a small Excel sheet with five fictional orders and ask for total
   sales. Confirm the numeric answer yourself and check attachments remain usable
   in follow-ups. UI tests do not replace these real extraction/analysis canaries.
5. Check request status/recovery, browser takeover/hand-back and an approval
   using an owner-controlled test destination. No real customer messages or
   passwords in chat. A Google connection uses normal-browser OAuth, not cloud
   browser password entry. Routine execution remains canary-restricted.
6. Verify logout, isolation from a second account, private downloads and expired
   access. Confirm rollback and restore procedures before broad customer intake.

Do not claim these real canaries have passed based on synthetic browser fixtures.

## First 48 hours

Use a small founder-supported cohort and help each person choose one workflow.
For each customer, record: agreed task, inputs/access needed, useful deliverable,
owner acceptance, next repeat and any blocker. Keep private business data out of
public sheets and WhatsApp. Do not auto-enable a routine or send a drafted message.

After payment is ready, the primary metric is paying customers with one accepted,
useful business workflow result within 48 hours of their first successful payment.
Before then, track invited-user results separately, not invented paid activation.

## Operator watch during launch

Run `bash worker/scripts/health.sh --json` for non-waking health checks. The existing
health-alert wrapper sends external messages, so running it or a deliberate alert
canary requires an approved owner-controlled recipient; preparation did not do so.
The loaded monitor depends on this Mac remaining awake and connected. Fix the pulse
job's observed last exit 9 and test alert delivery before claiming reliable alerting.

Watch API errors, stuck tasks, failed signup delivery, cold-start latency and real
provider spend. Existing diagnostics are not a prepaid usage ledger. Do not run
model load tests or wake the whole fleet just to decorate the launch experience.

## UI changes prepared in this worktree

The frontend items below were subsequently deployed in the scoped release.
The email-log hardening is a separate local Worker change and was not deployed.

- Dismissible public launch bar on landing, browser sign-in and access/waitlist;
  both prices, three-month duration and no-payment door remain visible.
- Welcoming early-user card only after server-confirmed sign-in on Access and
  initial business onboarding. No `?welcome=1` or browser `paid=true` trust signal.
- Friendly email-signup confirmation with email → sign-in → first-job steps and
  an explicit sign-in button. It preserves account-existence privacy, does not
  auto-login, and clears the submitted password from form state.
- Email diagnostic logs no longer include authentication links, recipients,
  notice subjects or raw provider bodies. Actual email payloads, unsubscribe and
  reply-to behavior remain unchanged.
- Header keyboard skip link remains hidden below the announcement until focused;
  the browser check verifies both hidden and focused states.

No new storage key, paid entitlement, signup API or runtime pin was introduced.
Announcement dismissal is memory-only and resets when its route remounts.

## Local verification for the announcement and welcome

- App typecheck, production build and static SEO checks passed.
- Sign-in and business onboarding suites passed in the first focused run;
  the final Access, announcement/welcome and Chat suites passed 34 tests after
  narrowing an ambiguous test selector and fixing async test-fixture cleanup.
  The broader app run used an earlier fixture and reported a cleanup-race failure
  and a setup-readiness test failure; it was stopped before a complete result.
  This is not a claim that a fresh full app regression has passed.
- The setup-readiness suite passed all 11 tests on an isolated rerun, without
  changing its assertions or extending its timeout.
- Worker typecheck and five focused suites passed 48 tests, including delivery
  log privacy, signup notices, announcements, access and founder-group eligibility.
- Synthetic Chrome checks passed at 320, 390, 768 and 1440px, plus Bahasa Malaysia
  and light mode: announcement dismissal, keyboard skip link, signed-in-only
  welcome, first-workflow choice, readiness and payment-only invitation behavior.
  Screenshots were inspected locally. All API responses and accounts were fixtures;
  remote navigation was blocked and no real signup, payment or provider call occurred.
- Real signup delivery, attachment analysis, live payment and an accepted first
  business workflow still require the manual canaries above.
- At preparation time all changes were local. The authorized frontend release
  below supersedes that deployment status only. Nothing was posted or emailed;
  production payment settings, secrets, database and runtime fleet were unchanged.

## Authorized frontend release — 16 September 2026

The operator requested deployment and paid checkout. Only the scoped
announcement, welcome, first-workflow and payment-gated founder-invitation
frontend was released. An isolated worktree preserved unrelated dirty main
changes; the Stripe branch, Worker/email-log changes and deferred external-trigger
pilot were excluded. Main and the Stripe branch were not blindly merged.

- Local release commit: `425dcf8` — `feat: launch announcement and early-user welcome`.
- Cloudflare Pages project: `aisar-jentera`; production deployment `89a09013`.
- Deployment URL: https://89a09013.aisar-jentera.pages.dev.
- Release main asset: `/assets/index-C5_r-PAr.js`; CSS `/assets/index-BsRfybSW.css`.
- Both `jentera.ai` and `jentera.aisar.ai` served the exact release JS bytes,
  verified against the local build with SHA256. Landing HTML contains RM199
  renewal disclosure and the announcement.
- `/`, `/signin`, `/waitlist`, `/onboard`, `/setup`, `/app`, `/privacy`, `/terms`
  returned HTTP 200 on both hostnames after normal redirects.
- Isolated release typecheck/build, static SEO and ten focused suites passed
  **120 tests**. Six local synthetic Chrome configurations passed, covering
  mobile/tablet/desktop, Bahasa Malaysia and light mode. This is not a full main
  regression or evidence of real signup, file analysis or paid activation.
- The six synthetic Chrome configurations also passed against assets served
  from `https://jentera.ai`. The harness removes only the Pages-injected analytics
  tag, stubs authentication/API responses and blocks external navigation; it
  never changes the served app JS/CSS or sends analytics, signup or payment calls.
  The initial live-host attempts failed because the deliberately substituted
  analytics script conflicted with its integrity hash. Removing that tag in QA
  fixed the harness; no production integrity attribute was weakened.
- No apex `aisar.ai`, native build, Worker, database migration or runtime release
  was deployed. Billing status remains HTTP 404; checkout is not open.

The same live Stripe catalog was re-inspected successfully with the explicitly
authorized restricted key, supplied transiently without source/log persistence.
No live checkout/customer/subscription or charge was created. The key still
requires rotation before runtime deployment.

The unmerged Stripe worktree now has a canonical single-plan sandbox Checkout,
verified first-purchase owner onboarding and payment-history-based promotion
eligibility. Worker/test typechecks and seven focused suites passed **113 tests**.
See `docs/plans/2026-09-16-stripe-launch-integration.md` for remaining production
gates, including all-entry-point usage enforcement, payment reversals/lifecycle
canaries and the still-unconfirmed monthly included AI allowance. Do not announce
paid checkout or ten-query self-serve trial as live on the basis of this UI release.

## Local layout correction — after the release

The operator reported an oversized announcement and misaligned hero content.
The layout correction was first prepared in main and the isolated release
worktree. At this checkpoint it was **not deployed** and did not enable billing.
The later authorized deployment below supersedes this local-only status.

- Removed the announcement's redundant headline and stacked link subtitle.
  Both prices, three-month duration and no-payment disclosure remain visible.
  Default desktop height is now 45px rather than 69px; at 390px the bar is 89px
  rather than 150.5px. Links and dismiss actions retain 44px touch targets.
- Centered the hero pricing note with automatic inline margins in the existing
  centered composition. Limited the benefits to 640px on desktop and a readable
  320px single column on phones, instead of spreading them across the 1100px hero.
- The chat composer, billing routes, access policy, storage keys and runtime
  configuration were not changed by this correction.
- Main typecheck and the two affected suites passed 15 tests. The isolated
  production build, static SEO and ten focused release suites passed 121 tests.
  Eight synthetic Chrome configurations passed at 320, 390, 768, 1024, 1440 and
  2048px plus Bahasa Malaysia and light mode. New assertions protect announcement
  height, touch targets, centered note/list and phone single-column benefits.
- Before/after screenshots and measured bounds are in the local QA directory
  `/tmp/jentera-landing-layout-qa.s6zUV6`; phone and desktop images were inspected.
  All authentication/API responses were fictional. No account, payment, model
  request, email, WhatsApp invitation or deployment was created by these checks.

## Authorized layout-fix deployment — 16 September 2026

The operator explicitly requested deployment of the layout correction. The five
scoped component/style/test files were committed in the isolated release
worktree as `9ae16d1` — `fix: slim launch announcement and align landing offer`.
Unrelated dirty main changes, the Stripe worktree, Worker and deferred pilot
remain excluded; neither main nor the Stripe branch was blindly merged/pushed.

- `AISAR_PAGES_PROJECT=aisar-jentera ./deploy.sh` completed successfully.
- Production deployment: `9489f778`; URL
  https://9489f778.aisar-jentera.pages.dev.
- Live main asset: `/assets/index-BvevTg4U.js`; CSS `/assets/index-BgehQg0J.css`.
- Both `jentera.ai` and `jentera.aisar.ai` served the exact local build JS/CSS
  bytes (SHA256 verified). Landing HTML no longer has the redundant announcement
  headline; RM199 renewal disclosure remains visible.
- `/`, `/signin`, `/waitlist`, `/onboard`, `/setup`, `/app`, `/privacy`, `/terms`
  returned 200 on both domains, referencing this release after normal redirects.
- Frozen-lockfile install and production typecheck/build passed during deployment;
  the two affected suites passed 15 tests again after installation. The preceding
  isolated verification passed 121 focused tests and eight local browser layouts.
- All eight synthetic browser configurations also passed against live-host
  assets at `https://jentera.ai`, including slim-bar height/touch-target checks,
  centered hero note/benefits, mobile single-column layout and page overflow.
  Authentication/API responses remained fictional and the analytics tag was
  removed only from fixture navigation; no real signup or payment was performed.
- No apex `aisar.ai`, native build, Worker, cloud migration, payment configuration
  or runtime release was deployed. Production billing status is still 404;
  paid checkout is unchanged and remains closed.

## Restored hero and automatic activation — 17 September 2026

- Original hero restored: “AI staff that works 24/7 for Malaysian businesses.”
  The slim announcement remains; outdated purchases-closed/no-payment-today copy
  was removed. The pricing CTA goes to the verified-account `/subscribe` entry.
- Scoped frontend commit `a0ad5b5`; production Pages deployment `d6a05f68`.
  JS `/assets/index-S8KXCl6R.js`, CSS `/assets/index-DnnOqMgy.css` are byte-identical
  on `jentera.ai` and `jentera.aisar.ai`. Public/legal/app/onboarding routes return
  200; `/subscribe` is no-store and noindex.
- All eight synthetic Chrome layouts pass against live release assets. All API,
  identity, entitlement and provider responses remain fixtures: this is not a
  real customer payment or computer-provisioning canary.
- Scoped backend `d671439` implements verified Stripe payment → expiring paid
  account access, renewals, failures, cancellation, refund/dispute review holds
  and atomic replay protection. Additive billing migrations were applied to Neon.
- Replacement Stripe key, signing secret and private founder-group invite are
  stored in the Worker secret vault, not in source or frontend build assets.
- Full main Worker suite: 98 suites / 1,153 tests passed; full frontend: 103 suites
  / 945 tests passed. Protected read-only vault readiness checks were added.
- **Checkout remains closed.** Automatic sandbox creation required Stripe browser
  authentication. No customer, subscription or card payment was created by these
  checks. Seller permissions, portal controls and live webhook delivery still
  need confirmation; prepaid credits, top-ups and ten-query trial admission are
  not claimed as production features. See `docs/billing/automatic-activation.md`.
- Runtime release/pin, deferred trigger pilot, native shell and apex `aisar.ai`
  were not changed or published.
