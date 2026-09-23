# Apps wired to automation: direction and catalogue

Status: direction agreed in a product brainstorm on 23 September 2026.
Planning only. No code, no migrations, no customer-facing promise. Each
project below gets its own spec before any build starts.

This supersedes the choice of first app in
[the mini-apps plan](2026-09-12-mini-apps.md): Receipts & Expenses is
deferred and Bookings goes first. That plan's registry, installation and
permission design still applies.

## The decision

Jentera can produce small **apps** as an output of the work it does: a page
the business's customers use, and the list behind it that the owner and staff
work from. Each app is wired to Jentera's records, approvals, routines and
connectors. The owner asks for the outcome; they do not build anything.

- **In scope:** the long tail of tools small businesses stitch together from
  Google Forms, Sheets, Airtable, Wix and a booking plugin. That includes
  booking and order pages, enquiry forms, trackers, checklists and status pages.
- **Out of scope:** replacing the systems businesses keep for trust, compliance
  or reach. That means accounting, e-invoice submission, payroll filing,
  payments, POS and marketplaces. See [Not doing](#not-doing).
- **Not a general app builder.** Jentera does not compete with Grok Build or
  Lovable on "describe any app". Its edge is that the app runs the business:
  the booking lands in Google Calendar, Jentera confirms it on WhatsApp, and
  the invoice goes to Bukku.

The thesis is unchanged: Jentera automates the everyday work. An app is one
form that work's result can take.

## Why, with the evidence at the time

**Market.** Building and sharing an app is becoming table stakes, so it is not
a moat on its own:

- xAI's [Grok Build](https://x.ai/news/grok-build-for-everyone) (19 Aug 2026)
  builds apps, sites and dashboards. It publishes them to `grok.me` or a custom
  domain, with private, link-only or public access, secrets and data
  connectors, on every plan.
- Meta's [Muse](https://ai.meta.com/muse/) (reported 8 Sep 2026) runs on a
  persistent VM, works over WhatsApp and says it builds its own software. It is
  US-only, at $20/month.

Neither of them reaches Southeast Asian systems: Bukku, MyInvois, Billplz, FPX
or EasyParcel.

**Retention.** Production on 23 Sep had 37 accounts, 41 businesses and 591
runs; 494 of those runs (84%) were Kitakod's. Across all businesses there was
1 routine, 2 approvals ever requested and 8 connections (Google and Telegram
only). Chat produces nothing durable to come back to. An app that staff open
every day is a reason to return.

**Caveat.** The catalogue below is a set of hypotheses. What owners typed is
not stored (the ask text is absent from `run_event`), so there is no usage
evidence for any specific app. The first pilots decide what is next.

## Rules against bloat

The workspace already has about 20 surfaces: Home, Ask, Activity, Approvals,
Customer Inbox, Goals, Routines, Skills, Files, Knowledge, Agent memory, Bots,
Team, Workspaces, Permissions, Connections, Business Browser, Desktop viewer,
Notifications and Task detail. Most are lightly used. These rules hold for
every app:

1. **One new concept: App.** An app is a public page plus the internal list
   behind it, under a single **Apps** entry. There is no navigation item per
   app. Everything else reuses what exists:

   | In an app | Existing concept |
   |---|---|
   | Owner confirms a booking, an order or a quote | Approvals |
   | Reminders, follow-ups, weekly checks | Routines |
   | WhatsApp, Calendar, Bukku | Connections |
   | Each handled request | Activity |
   | Services, prices, hours | Knowledge |

2. **A variant is configuration, not a new app.** Room rental is Bookings with
   nightly slots. A festive pre-order is Orders with a cutoff date and a quota.
   The catalogue groups apps into families for this reason.
3. **Build an app, not a platform.** Bookings is built as one concrete app. The
   general app platform is extracted only when a second app needs the same
   parts.
4. **Shipped apps first, generated apps later.** For now the agent
   *configures* a Jentera-shipped app for each business, setting services,
   hours and page copy. Agent-generated long-tail apps come after the data API
   and hosting have been proven on real apps. This defers the long-tail idea;
   it does not drop it.
5. **Every project has a kill criterion.** It is written into the project's
   spec before the build starts. Project 1's is below.

## How an app is built and served

**Build on the sprite, serve from the edge.** The sprite is the agent's
workshop: it can write, run, click through and fix an app, and checkpoints give
drafts and rollback for free. It is the wrong host for a page the public uses,
for reasons this repo has already measured:

| Why not serve from the sprite | Where it is recorded |
|---|---|
| A sprite pauses about 15 s after activity, and a cold wake restarts processes. A customer would wait seconds for the page. | `docs/reply-latency.md` |
| Releases re-bootstrap the fleet, and Fly has left sprites unable to wake (502/503) | `docs/todo.md`, Waiting on someone else |
| A file on a sprite is not durable until it is checkpointed | CLAUDE.md, Replacing a sprite |
| The sprite holds logged-in browser sessions and harvested credentials. Public traffic must not reach that. | `docs/todo.md`, the `connect_service` row |
| Awake time is billed, so crawlers hitting a public page would cost money | `docs/sprites-vs-dedicated-vms.md` |
| Sprites made before 10 Sep are in LAX or SJC | CLAUDE.md, Replacing a sprite |

So the design has three parts:

- **Published pages are served by Cloudflare,** on a public origin separate
  from the workspace so the session cookie is never in scope.
  - For a shipped app, publishing is **data, not code**: the business's
    configuration is rendered by Jentera's own app bundle.
  - Hosting a bundle per business (Workers for Platforms or R2) is only needed
    once generated apps exist.
- **App data lives in Postgres** as typed, tenant-scoped tables under forced
  RLS, reached through `withTenant`. Nothing an app stores lives on the sprite.
- **Actions go through the control plane.** A public form can create a
  request. It cannot send, charge or write to a connector. Anything
  customer-facing or sensitive is proposed, approved and executed exactly as a
  run's actions are today.

**Later, for generated apps: a generated front end on a governed back end.**
Generated code never holds a credential and never calls Bukku or WhatsApp
directly. It calls a Jentera app API that enforces the same permissions and
approvals as everything else. This is the rule the runtime already follows: an
adapter reads and reasons, and never writes or sends on its own.

## Projects and order

| # | Project | Depends on | Kill criterion |
|---|---|---|---|
| 1 | **Bookings app**: public booking page, internal bookings list, owner approval, Google Calendar event, day-before reminder routine. Customer replies go out through a `wa.me` link the owner taps. | nothing | 3 pilot businesses have not taken one real customer booking within 2 weeks of going live: stop before project 2 |
| 2 | **WhatsApp channel**: port the minimum from Loyca, tested on Kitakod's own number | nothing; runs alongside 1 | set in its spec |
| 3 | **Jentera Meta App Review**: a separate Meta app under the same verified business, screencasting the booking flow | 1 and 2 working; Loyca's review done first | none |
| 4 | *Only with pilot evidence:* a second app (Orders), then extract the platform, then generated apps | pilots from 1 | set per step |

### WhatsApp: port, with the minimum scope

Loyca (`~/ios/supateam/supateam-ai`) already runs the official Meta WhatsApp
Cloud API:

- genuine Embedded Signup, where each business connects its own number
- the Tech Provider path, where Meta bills each business directly
- 60-day token auto-refresh
- template provisioning

That is about 7,000 lines across about 12 files. **Port, do not share:** Loyca
stays its own product with its own copy. The cost is fixing Meta API changes
twice while both products live.

- **Port only what Bookings needs:**
  - Embedded Signup (`whatsappOAuthService`, `whatsappAuth`)
  - the inbound webhook
  - sending inside the 24-hour window (`whatsappService`, `whatsappWindowManager`)
  - two templates, confirmation and reminder (`whatsappTemplateProvisioning`)
  - token refresh
- **Leave behind:**
  - Messenger and Instagram (`metaChannels`)
  - the 600-line `templateLibrary`
  - anything that assumes Mastra
- **Adapt to Jentera's rules:**
  - tables become migrations under RLS
  - tokens go into the encrypted credential store
  - verification goes through `verifyWebhook`
  - inbound messages become runs
  - outbound messages go through the approval gate
- **Meta sequencing:**
  - Loyca's App Review was not approved as of 23 Sep, and the owner is still
    submitting it. Finish that submission as it is; its narrow use case
    (appointment confirmations and reminders) is what reviewers approve.
  - Jentera cannot submit its own review until its flow works, because Meta
    wants a screencast of the app under review.
  - Standard access already covers Kitakod's own numbers, so building and
    dogfooding are not blocked. Only other businesses' numbers wait on
    approval.

## App catalogue

Six families. Each family shares one shape of records and actions; the entries
inside a family and the variants are configurations of that shape.

Connector state on 23 Sep:

- **Live:** Telegram, Google Calendar, Bukku.
- **Pending:** WhatsApp (projects 2 and 3).
- **Planned, tier 1** (an owner can connect it once built): Billplz,
  ToyyibPay, senangPay, Stripe, EasyParcel, Shopify, Financio.
- **Tier 2** (registration needed): Shopee, Lazada, TikTok Shop, Ninja Van,
  J&T.

See [the Malaysian integrations plan](2026-09-11-malaysian-integrations.md).

Business types are the playbook keys in `app/src/lib/data/playbooks.ts`.

### A. Take requests

A customer asks through a public page. It lands in an internal list, the owner
decides, and the customer is told.

| App | Public side | Internal side | Automation it carries | Connectors | For | Variants |
|---|---|---|---|---|---|---|
| **Bookings** | Pick a service and a slot | Bookings by day, with status | Approve, then a Calendar event, confirmation, reminder the day before, no-show follow-up | Calendar (live), WhatsApp (pending), Telegram for owner alerts (live) | salon, clinic, gym, tuition, auto, petcare, photography, cleaning, laundry, services, property | room/unit rental by night; class and event registration; consultation calls; property viewings |
| **Orders** | Catalogue or menu with an order form | Orders board: new, confirmed, ready, delivered | Confirm, then a Bukku draft invoice, a payment link, then a ready or delivery notice | Bukku (live); payments planned; WhatsApp | restaurant, bakery, catering, florist, retail, smallretail | read-only menu page; festive pre-orders with cutoff and quota (Deepavali 8 Nov, CNY, Raya); catering with an event date |
| **Enquiries** | Contact or enquiry form | Leads with status | Jentera drafts a reply for approval, and follows up if there is no answer in N days | Telegram (live); WhatsApp | all, especially wedding, property, services, cleaning | must fold into Customer Inbox rather than add a second list |
| **Quotes** | Quote request with details and photos | Quote builder | Drafts a quote from the price list in Knowledge; the owner approves; a PDF is sent; an accepted quote becomes a Bukku invoice | Bukku (live) | wedding, catering, photography, cleaning, auto (repair estimates), property (renovation), services | none |
| **Walk-in queue** | Take a number and see your position | Call next | "Almost your turn" notice | WhatsApp (pending) | clinic, salon, auto, laundry | none |

### B. Keep customers informed

A public status page on an internal record, so customers stop asking "is it
ready yet?"

| App | Public side | Internal side | Automation it carries | Connectors | For |
|---|---|---|---|---|---|
| **Job tracker** | Status of my repair or service, with photos | Job board, assigned to staff | A status change notifies the customer; completion drafts an invoice | Bukku (live); WhatsApp | auto, cleaning, laundry, petcare (grooming), services (aircon, repair) |
| **Delivery status** | Where is my order, with tracking | Dispatch list | Shipment created, tracking link sent, follow-up on delivery | EasyParcel (planned) | retail, smallretail, bakery, florist |
| **Statement & pay** | One page per customer: unpaid invoices and a payment link | Overdue list | The thesis example: a weekly overdue check in Bukku, reminder drafts for approval, marked paid when the link settles | Bukku (live); Billplz or ToyyibPay (planned); WhatsApp | B2B services, tuition (fees), property (rent), catering |

### C. Run the back office

Internal only. Staff use these on their phones, which makes them daily habits.

| App | Staff side | Automation it carries | Connectors | For |
|---|---|---|---|---|
| **Checklists** | Opening, closing, cleaning or SOP checklists, ticked with photo proof | A missed or failed check alerts the owner | none | restaurant, cleaning, gym, clinic, bakery |
| **Stock count** | Count screen | Low stock produces a purchase-order draft to the supplier, for approval | none; later Shopify or StoreHub reads | restaurant, bakery, retail, smallretail, florist |
| **Daily closing** | Enter takings, or photograph the POS Z-report | Owner digest at end of day, with a weekly trend | none | restaurant, retail, laundry, salon |
| **Receipts & expenses** | Photograph a receipt, review the extracted fields | Draft expense, then a Bukku expense draft | Bukku (live) | all ([existing plan](2026-09-12-mini-apps.md)) |

### D. See the business

| App | What it is | Note |
|---|---|---|
| **Business numbers** | Today's bookings, orders, takings and overdue amounts, from Jentera's records and connectors, plus a morning brief | **Not a new app.** It is Home showing real numbers. Build it into Home. |

### E. Bring customers back

| App | Public side | Internal side | Automation it carries | For |
|---|---|---|---|---|
| **Feedback & reviews** | "How did we do?" page | Feedback list | Sent after a booking or order completes. A happy customer is nudged to Google Reviews; an unhappy one alerts the owner. | restaurant, salon, clinic, auto, cleaning |
| **Loyalty** | Stamp card or points, looked up by phone number | Members | A stamp on each order or booking, reward reminders, win-back after N days away | restaurant (cafés), salon, bakery, gym, petcare |
| **Service-due reminders** | none | Customers with due dates | "Car service due", "aircon every 6 months", "vaccination due", membership renewal | auto, petcare, cleaning, gym, clinic. A variant of Bookings or Job tracker plus a routine, not its own app. |

### F. Presence and the long tail

| App | What it is | When |
|---|---|---|
| **Business page** | One public page for the business: name, hours, location and services, taken from the imported profile. It hosts the other apps' public pages (Book, Order, Enquire, Pay). It is a container, not a website builder: no themes, no blog. | A minimal header ships with project 1 because the booking page needs one. It grows only as apps are added. |
| **Custom forms** | Registration, waiver, survey, warranty claim, job application | Project 4; the on-ramp to generated apps |
| **Generated apps** | Anything else, written by the agent on the governed back end | Project 4, only with evidence |

## Priority

These are hypotheses, to be re-ranked by what pilots actually use. Columns
use H/M/L, except Reach, which counts matching playbooks.

- **Daily use** is the retention argument.
- **Reach** is how many playbooks the app fits.
- **Stake** is what it costs if the app gets something wrong.
- **Shareable** is the distribution argument: every public link shows
  Jentera to someone new.

| App | Daily use | Reach | Connectors ready | Build cost | Stake | Shareable | Tier |
|---|---|---|---|---|---|---|---|
| Bookings | H | 11 | Calendar yes, WhatsApp pending | M | M | H | **Now: project 1** |
| Orders | H | 6 | Bukku yes, payments no | M–H | M–H | H | **Next: second app, which triggers platform extraction** |
| Enquiries | M | all | yes | L | L–M | M | Candidate third |
| Job tracker | H | 5 | yes | M | L–M | M | Candidate third |
| Statement & pay | L (weekly) | 4 + B2B | Bukku yes, payments no | M | H | M | Candidate third |
| Checklists | H | 5 | none needed | L | L | none | Candidate third |
| Daily closing | H | 4 | none needed | L | L | none | Candidate third |
| Feedback & reviews | M | 5 | WhatsApp helps | L | L | H | Candidate; add-on to Bookings or Orders |
| Stock count | H | 5 | none needed | L–M | L–M | none | Later |
| Quotes | L–M | 7 | Bukku yes | M | M | M | Later |
| Walk-in queue | H for those who use it | 4 | needs WhatsApp | L–M | L | M | Later, after WhatsApp |
| Delivery status | M | 4 | EasyParcel not built | M | L | M | Later |
| Receipts & expenses | M | all | Bukku yes | M | L | none | Later ([existing plan](2026-09-12-mini-apps.md)) |
| Loyalty | M | 5 | none needed | M | L–M | H | Later |
| Business page | L | all | n/a | L–M | L | H | Minimal, with project 1 |
| Business numbers | H | all | partly | M | L | none | Fold into Home |
| Custom forms, generated apps | varies | all | n/a | H | varies | M | Project 4 |

## Not doing

This follows the line in
[the Malaysian integrations plan](2026-09-11-malaysian-integrations.md):
**prepare, do not file.**

| Do | Do not |
|---|---|
| Create a payment link and report whether it was paid | Hold, route or move money |
| Draft an invoice or e-invoice in Bukku | Replace the accounting system, or submit to LHDN or MyInvois |
| Prepare a payroll summary for the owner | File with KWSP, PERKESO or EIS, or run payroll |
| Take orders on a page | Build a full online store or compete with Shopee, Lazada or Shopify |
| Record daily takings | Build a POS |
| Publish a business page | Build a website builder with themes, blogs or SEO tooling |
| Staff checklists | HR compliance, leave entitlement or payroll-linked attendance |

## Open questions

- **Pilots.** Which 3 to 5 businesses run Bookings first? Services businesses
  already on Jentera (NEOREKA ASIA, Aster Edu, the room rental) are
  candidates, and asking them which three apps they would use is the cheapest
  evidence available.
- **Price.** Are apps included in the RM99/RM199 plan? Is a custom domain
  extra?
- **The public origin.** Which hostname serves published pages, so they are
  kept apart from the workspace session? Decide in project 1's spec.
- **Subtraction.** Which of the roughly 20 existing surfaces are hidden from
  owners so that Apps is not simply added on top? Decide before Apps ships.
- **Loyca's future.** Loyca stays separate for now. Whether Jentera and Loyca
  ever merge is a later decision, made on whichever one wins customers.
- **The Jentera Meta app.** Its name and use-case wording for review. Reuse
  Loyca's wording where the flow is the same.
