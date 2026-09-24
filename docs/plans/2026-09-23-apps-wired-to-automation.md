# Apps wired to automation: direction and catalogue

Status: direction agreed in a product brainstorm on 23 September 2026. Project 1 (Bookings v1) is built on branch `bookings-v1` as plans 1–4, not yet released; see `2026-09-23-apps-shell-and-bookings-v1.md`.
Planning only otherwise. No code, no migrations, no customer-facing promise. Each
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

### Where the pieces come from

Two of the owner's other products already carry pieces this needs. Jentera
becomes the platform they converge into, rather than a fourth product beside
them. The pattern is the same for both, and was agreed for both on 23 Sep:

- **Port the plumbing.** Every Jentera app will need it, so it belongs in
  Jentera's core.
- **Rebuild the templates** in Jentera's model, using the old product as the
  reference.
- **Keep the old product running** for its own customers.

| Product | Repo | Plumbing ported into Jentera | Templates it informs | Stays separate for |
|---|---|---|---|---|
| **Loyca** | `~/ios/supateam/supateam-ai` | WhatsApp onboarding (official Cloud API, Embedded Signup) | Bookings | its booking customers |
| **Pantas** | `~/ios/shipfast/pantas.ai` | Malaysian payments | Digital products; its events and coaching types become Bookings variants | creators: courses, tip jars, affiliates are not ported |

Jentera supplies what neither has: the agent, approvals, routines, connectors
and editing by conversation.

A survey of the whole portfolio later the same day found more than these two.
The plumbing is mostly built already, often several times over. The best
source for each capability is often a different repo, and one of them is
**Pintas**, a WhatsApp storefront that is a separate product from Pantas. See
[What we've already built](#what-weve-already-built).

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

   *TBD (raised 23 Sep):* **templates you customise by chatting.** This is
   Shopify's "start from a theme that works" with Lovable's "change it by
   asking".
   - **The agent may change** text, images, products and services, form
     fields, sections from a block library, colours and fonts, and automation
     steps.
   - **It may not change** code, payment handling or data-access rules.

   That boundary is what makes twenty templates maintainable where a thousand
   generated apps would not be.
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
| 1 | **Bookings app**: public booking page, internal bookings list, owner approval, Google Calendar event, day-before reminder routine. Customer replies go out through a `wa.me` link the owner taps. Spec: [apps shell and Bookings v1](2026-09-23-apps-shell-and-bookings-v1.md), which moves the reminder routine out of v1. | nothing | 3 pilot businesses have not taken one real customer booking within 2 weeks of going live: stop before project 2 |
| 2 | **WhatsApp channel**: port the minimum from Loyca, tested on Kitakod's own number | nothing; runs alongside 1 | set in its spec |
| 3 | **Jentera Meta App Review**: a separate Meta app under the same verified business, screencasting the booking flow | 1 and 2 working; Loyca's review done first | none |
| 4 | *Only with pilot evidence:* a second app (Orders/Shop), with the **payments port** alongside it; then extract the platform; then generated apps | pilots from 1 | set per step |

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
- **Borrow from other repos** for the parts Loyca does not do on Workers:
  - `engagerxhealth/simple-broadcast`: webhooks, delivery and read status,
    and "NO" opt-outs, on Workers + D1 (Graph v21)
  - `zeptosupport/backend/api/webhook.go`: routing each webhook to its
    business by `phone_number_id`
  - `engagerxhealth/aisa/backend/internal/whatsapp/signature.go` and
    `internal/outbox/`: signature checks and an outbox for reliable sends
  - Skip the unofficial WAHA and whatsmeow bridges in sabot, aisar.ai and
    zeptoclaw. They risk the number being banned, and Tech Provider
    onboarding needs the official API.
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

### Payments: port, with the minimum scope

Malaysian gateways exist in at least eight repos (see
[What we've already built](#what-weve-already-built)). Bookings v1 does not
need payments, so this port lands with Orders (project 4).

- **Port:** one Malaysian gateway, **Billplz**, connected with the business's
  own account. It creates a bill (the payment link), verifies the X-Signature
  callback and marks the order paid. Billplz is also tier 1 in the
  integrations plan.
  - **Take the gateway client from Pantas** (`shipfast/pantas.ai/src/libs/billplz.ts`),
    as agreed. Its callback check already fails closed when no key is set and
    compares signatures in constant time.
  - **Take how the signed string is built from picklebook**
    (`picklebook/api/services/payment/providers/billplzProvider.ts`,
    `verifyXSignature`). On 23 Sep, picklebook's was the only copy that matched
    [Billplz's documented algorithm](https://support.billplz.com/api):
    - sign each pair as key+value (`amount100`, not `100`)
    - sort the pairs without regard to case
    - join them with `|`
    - compute HMAC-SHA256
  - **The other three copies are wrong:**
    - Pantas and Pintas sign bare values.
    - Pintas also returns `true` when no key is configured.
    - zeptoclaw-sea joins the pairs with `""`.

    By Billplz's algorithm, a real callback fails Pantas's check. Pantas's
    repo root carries `manual-complete-order.sh`; whether that is related has
    not been checked.
  - **Verify against a real Billplz sandbox bill** before anything is ported.
- **One payment-provider interface,** so CHIP and BayarCash plug in later
  without touching the apps. picklebook (Hono on Workers) and seido-shop both
  have one to start from.
- **Do not port:** Stripe Connect **destination charges**. They put the
  platform in the money flow, which breaks the rule in [Not doing](#not-doing):
  create a payment link and report whether it was paid, but never hold or
  route funds. Money must go straight to the business's own gateway account.
- **Leave behind:** creator features (courses, tip jars, affiliates) and the
  gateways beyond the first, until a business asks for one.

## Modules, add-ons and where things live

### Modules

*Agreed 23 Sep:* every capability is a module a business switches on or off,
and the sidebar is built from what is on. This generalises what
`Dashboard.tsx` already does for Goals and Routines. It is also how the ~20
existing surfaces stop crowding SME owners: nothing is deleted, the features
they do not need are simply off.

| Kind | What | Default |
|---|---|---|
| **Core** | Home, Chat, Work (Activity, Approvals, Routines), Business (Knowledge, Connections, Team, Permissions) | always on |
| **Apps** | Bookings, Orders, Checklists and the rest of the catalogue | off until the owner, or Jentera, turns one on |
| **Power features** | Goals, Skills, Library, Files, Bots, Workspaces, Business Browser | *TBD:* off for new businesses; on under Business → Modules |

- **Jentera suggests, the owner switches on.** When an owner asks "can
  customers book online?", Jentera offers the add-on at that moment. The
  module list is the fallback, not the main way in.
- **Rule 1, refined.** Installed apps are listed under an **Apps** heading on
  desktop, and there is a single **Apps** entry on the phone's bottom bar.
  Apps that are not installed appear nowhere.
- **The Worker enforces entitlements per module,** as it does the trial
  allowance. A pack is a price that grants several modules.
- **Switching off a paid add-on keeps its data.** Its public page says "not
  taking bookings right now" rather than breaking.

### Home on the phone

*Decided 23 Sep (option B), after comparing mockups drawn from the current
Home.* Today's Home has a hero card and then four tiles: Chat, Activity,
Alerts and Business (`HomeView.tsx`, `.home-actions`). Every one of them is
already reachable another way, so the apps take that row.

- **The tile row becomes the business's apps.** It keeps the same style and
  place: a coloured icon square with the label under it. The row shows
  installed apps plus **Add app**, and an app waiting on the owner shows a red
  count.
- **Nothing becomes unreachable:**
  - Chat and Activity stay in the bottom bar.
  - Business stays in More.
  - Alerts moves to a bell with a count in the top bar, beside the computer
    and profile icons.
- **The bottom bar becomes** Home · Activity · Chat · **Apps** · More.
  Skills moves into More.
- **The daily brief carries what the apps need from the owner,** each with its
  action inline ("Aisyah · Sat 3:00 pm → Confirm", "Friday promo · 240 people
  → Send"). These are the same approvals as in Activity, not a second queue.
- **Tapping an app opens one more screen inside the workspace,** not a
  separate app:
  - tabs for Today, Upcoming, Page and Settings
  - the list, with Confirm and Decline inline
  - the public link, to copy or share
  - a box for asking Jentera to change the page
- **Still open:** what the row shows once there are more than three apps.
  One option is the three most used plus **All apps**. Another is a
  horizontal scroll, as Agoda does. Also still open is what a business with no
  apps sees there, probably suggested apps from its playbook.

### Pricing: low base, paid add-ons

*Agreed 23 Sep:* paid add-ons, on the AirAsia model: a low headline price, with
extras bought at the moment of need. Including everything in the plan was
rejected because cost would be hard to control.

*TBD, not yet decided:*

- **Two dials.** Add-ons price **value**. Usage (AI credits in the plan, plus
  top-ups) prices **cost**. Jentera's real cost is agent work, sprite time and
  model tokens, not an app's page. A Bookings add-on that sent every booking
  through the agent would cost 500 runs for 500 bookings, whatever the add-on
  charged.
- **Apps run the normal path without the agent.** A confirmation is a
  template, a reminder is a routine and a slot check is a query. The agent
  handles exceptions and writing. This saves more than either dial.
- **Base:**
  - Chat, Home, Work, Business
  - Telegram, Google Calendar and Bukku
  - a business page
  - a monthly allowance of AI credits
  - the business computer, which the launch offer promises
- **Add-ons,** each with a 14-day trial:
  - individual apps
  - **automatic WhatsApp** (the base keeps the `wa.me` tap-to-send fallback,
    so every app works without it)
  - team seats
  - a custom domain
  - AI credit top-ups
  - *possibly:* a small transaction fee on the Shop add-on, billed monthly
    as Pantas does
- **Packs by business type,** suggested at onboarding from the playbook:
  - Services pack: Bookings, Feedback, Service-due reminders
  - Shop pack: Orders, Stock count, Delivery status
  - F&B pack: Orders (menu, pre-orders), Checklists, Daily closing
- **Stripe billing:** one subscription item per add-on, on top of today's
  single launch product.

**Prices are not set.** They should come from measured cost per module and per
run, and they bear on the current RM99 → RM199 launch offer, whose base may
need to come down once apps become extras.

### Where each audience works

*TBD:* separate by **audience**, not by feature. Only the business's
customers need their own domain.

```
jentera.ai                  marketing, pricing, /apps/<name> for live add-ons
jentera.ai/app              the workspace: owner and staff (role-scoped), every module
<biz>.jentera.site          the business's public pages: Book, Order, Pay, Feedback
  └─ book.theirdomain.com   custom-domain add-on
api.jentera.ai              (later) Connect, for developers
```

**Customer pages get a separate registrable domain,** not a `jentera.ai`
subdomain. The session cookie is host-only on the API host today
(`worker/src/auth.ts`), so it would not leak. The reasons are others:

- **Reputation.** One abusive page could get `jentera.ai` flagged by Safe
  Browsing, taking the workspace and magic-link email down with it.
- **Cookie tossing.** A sibling subdomain can set cookies for the whole domain,
  which matters once generated code exists.
- **Businesses kept apart.** With the domain on the Public Suffix List, each
  business's pages are their own site to browsers.

GitHub uses `github.io` and Vercel uses `vercel.app` for the same reasons.
Getting onto the list takes weeks, so decide the domain early.
`jentera.site` is a placeholder; availability has not been checked.

**Capabilities are not split across subdomains.** Separate products at
`bookings.` or `team.jentera.ai` would bring back the many-platforms problem.
They would also split the agent's context: "who's booked tomorrow and have they
paid?" needs Bookings and Bukku in one place.

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

### G. Team and knowledge (the "internal ChatGPT")

*TBD.* Don't sell a separate "internal ChatGPT"; generic staff chat is a
commodity (ChatGPT Business, Gemini in Google Workspace). Position the team
plan as one that knows *this* business and can act on it: "what's Puan
Aisyah's balance?", then "send her a reminder", which becomes an approval. Most
of it exists already: roles, invitations, workspaces, private chats, and the
agent knowing who is typing.

| Module | What is missing today | Pricing |
|---|---|---|
| **Team seats** | Seat limits (deferred in `docs/todo.md`), memory per person, staff on Telegram | Per-seat add-on |
| **Company docs** | Knowledge extracts facts and discards the file. This keeps the SOP itself, searchable and quotable with its source, and controls which staff can read which documents. | Add-on (storage and indexing cost) |

Private, locally hosted AI for GLCs, government and healthcare is a different
product and market. Not now. It already exists as client work:
`pixelspace/open-webui-react` is an on-premise AI workspace for a Malaysian
government client.

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

## What we've already built

A survey on 23 Sep 2026 of every git repository under `~/ios`: 444 in all.

- **What was read:** the 146 with at least ten commits by the owner, excluding
  this repo and the command centre. For each, its README, CLAUDE.md,
  manifests and deploy config.
- **What was checked by hand:**
  - Pintas's gateways and webhook tests
  - Jentera's own WhatsApp state
  - Billplz signatures against Billplz's docs
  - the committed secrets and whether their repos are public

Every owned repo is listed in [Appendix A](#appendix-a-every-owned-repo).

**The headline.**

- **Most of the plumbing apps need is already built, often several times.**
  WhatsApp is built at least six times and a Malaysian payment gateway in at
  least eight repos. PDFs are made seven different ways.
- **So the work is to pick one source per capability and port that, not to
  build.** Everything else is left where it is.
- **Real gaps:**
  - a MyInvois/LHDN API client
  - AutoCount, StoreHub and the SQL Account API (SQL Account only has a CSV
    export)
  - SenangPay beyond a sandbox
  - DuitNow, which has no public merchant API

### Pantas and Pintas are two different products

| | Pantas | Pintas |
|---|---|---|
| Repo | `~/ios/shipfast/pantas.ai` | `~/ios/mobile-apps/pintas-ai-temp/pintas-app` |
| What | Creator store for digital products, courses, events, coaching | WhatsApp storefront in the style of TakeApp: shop, checkout, bookings, delivery, broadcasts, reviews |
| Live | pantas.ai | pintas.ai, pintas.turbospark.my |
| Gateways | Stripe Connect, Billplz, BayarCash, Chip, SenangPay | Billplz, CHIP, BayarCash, Stripe, each with a webhook test |
| Also | Transaction-fee pricing | Couriers (Delyva, Lalamove, EasyParcel), custom domains through Caddy, WhatsApp OTP |

The owner confirmed on 23 Sep that the pattern agreed for Pantas means
**Pantas**. Both products exist and both keep running.

- **Pantas** remains the agreed source for payments, and the reference for the
  storefront, checkout and digital products.
- **Pintas** contributes what Pantas lacks: couriers, the custom-domain flow,
  and a reference for selling physical goods with WhatsApp ordering.

The table below still picks one source per capability, so some rows name
neither.

### Plumbing: one source per capability

| Capability | Port from | Also exists in (do not port) | State and caveats |
|---|---|---|---|
| **WhatsApp onboarding**: Embedded Signup, Tech Provider, templates, token refresh | Loyca `supateam/supateam-ai` | none | The only Embedded Signup anywhere. Meta App Review is pending. |
| **WhatsApp webhooks, status, opt-out** | `engagerxhealth/simple-broadcast` (Workers + D1) | aisar.ai, aisya-copied-from-aisar, sabot, zeptoclaw, zeptoclaw-android | Per-business routing is in `zeptosupport`; signature checks and an outbox are in `engagerxhealth/aisa`. Jentera has none of this yet: `worker/src/connectors.ts:119` is `NOT_WIRED('WhatsApp')`. |
| **Billplz** | the client from Pantas; the signed-string construction from picklebook | Pintas, rust/billplz-rs, zeptoclaw-sea, stayflow (keys only) | See [Payments](#payments-port-with-the-minimum-scope). Three copies verify signatures wrongly, Pantas's included. |
| **CHIP** (FPX, cards, e-wallets, DuitNow QR) | `seido-shop/src/features/payments/chip.ts` | jawiAT (live), Pintas, Pantas (a thin client), sparkly.my, rust/chip-asia-rs (52 tests), shipfast/loyalty-app-supabase (stub) | seido-shop is compatible with Workers, sits behind a provider interface, checks each webhook with CHIP's public key, and releases held stock when payment fails. |
| **BayarCash** (FPX, DuitNow, direct debit) | Pantas `src/libs/bayarcash.ts` | Pintas (with a webhook test), rust/bayarcash-sdk | The Rust SDK is the most complete. Its FPX direct debit suits recurring rent and fees in Statement & pay. |
| **Payment-provider interface** | `picklebook/api/services/payment/` (Hono on Workers) | seido-shop `provider.ts` | Needed so gateways plug in without touching the apps |
| **Couriers** | Pintas `app/lib/delivery/providers/` (Delyva, Lalamove, EasyParcel; GrabExpress is a stub) | zeptoclaw-sea (14 logistics clients) | Books the courier automatically once an order is paid |
| **SEA connector clients** | `zeptoclaw-sea/mcp-servers/`: `sea-core` BaseClient plus auth strategies | zeptoclaw-sea-new-integrations (a stale worktree) | 37 servers covering Shopee, Lazada, TikTok Shop, Grab, Xero, QuickBooks, LINE and more. TypeScript on `fetch`, so portable to Workers. All 595 tests run against mocked `fetch`; none has touched a live API. The DuitNow client is a guess. |
| **PDFs** (quote, invoice, receipt, delivery order) | rendering: `mkj-quotation-generator/api/overlay.ts` (pdf-lib on Workers, with branded templates in R2); data shape: `invoice-generator/src/schema/document.rs` (SST, MYR, total in words) | invoicelah, funnel-kit (Browser Rendering), mtncars, procureflow, aisar-halalos, jawiAT, trackerflow | Seven approaches; pick one. pdf-lib needs text coordinates per template. Browser Rendering (HTML → PDF) keeps templates editable, which matters for editing by chat. Decide in the Quotes spec. |
| **Public pages** | data model: `mole-app` (live at mole.is, 2,284 commits: Site, Collection, Form, Submission, Leads, QR, vCard, tickets); page as JSON with fixed sections: `shipfast/evica` | crate-web-builder, shipfast/funnel-builder, Pintas `pages` | Port the model and routes, not the code. evica is the closest existing thing to "template customised by chat". crate-web-builder places elements by pixel, which chat cannot edit well. |
| **Custom domains** | reference flows only: Pintas (Caddy on-demand TLS, `api.verify-domain.tsx`) and crater.store (Vercel Domains API) | none | On Cloudflare this becomes custom hostnames under Cloudflare for SaaS. Neither ports directly. |
| **Lead capture and follow-up** | `funnel-kit` (Workers, D1, Turnstile, Resend, hourly nurture cron, PDF to R2 behind a signed link) | sabot `followUpScheduler.ts` | One deploy per business with no `tenant_id`, so it needs tenant keys first |
| **Email** | *already in Jentera* (`worker/src/email.ts`, Resend) | SES, Mailgun, SendGrid and EngineMailer in six repos | Nothing to port |
| **Credential vault** | *already in Jentera* (`worker/src/vault/`, aisar-vault) | r8r, sparkly.my, stayflow, invoicelah | Nothing to port. invoicelah's `insert_secret` deletes every secret (`where name = name`). |
| **Knowledge with citations** | *already in Jentera* (Knowledge); references: VRS/AIClassroom (cited answers, versioned content packs), aikita.my (Cloudflare reranker, LHDN FAQ content) | sabot and salesrobot `ragService.ts`, pixelspace | For Company docs |
| **MyInvois / LHDN** | **nothing to port** | none | invoicelah's CLAUDE.md claims an e-invoice endpoint that exists on no branch. aikita.my has FAQ answers only. |

### Templates: the best reference for each catalogue app

| App | Best reference | Also useful |
|---|---|---|
| **Bookings** | `mobile-apps/cleanflow` (live at cleanflow.superutils.app): public booking page, a track-your-job page, status messages from CONFIRMED to COMPLETED, crew scheduling, job photos | **booking-platform**: slot hold → confirm and a capacity constraint. **picklebook**: availability in a Durable Object, reminders, waitlist. **Loyca**: AI receptionist. **sabot**: appointment availability. **gymbro-crm**: classes and packages. **stayflow**: nightly rental. **acara.pro, voluca, evica**: events and RSVP. |
| **Orders / Shop** | **Pantas** (pantas.ai): storefront and checkout, as agreed. **Pintas** (pintas.ai): physical goods, WhatsApp ordering and delivery. | **seido-shop** (live): CHIP, stock reservation, shipping zones. **daily-order-system** (live): daily menu, group orders that lock at a deadline, the pre-order shape. **calligraphy-order** (live): production line, delivery-order print, SQL Account CSV. **hotzilla, webagency-lp**: menu with ordering by `wa.me`. **Pantas**: digital products. |
| **Enquiries / CRM** | sabot (api.sabot.my): WhatsApp sales agent, pipeline, follow-ups, hand-off to a person, broadcasts | **funnel-kit**: lead capture on Workers. **sales-academy-crm**: pipeline schema under RLS. **zeptosupport**: escalation, business hours. **bizcard-crm**: reads business cards. **ai-native-sales-crm**: notes on the Malaysian market. |
| **Quotes** | mkj-quotation-generator: quote versions, a client portal link, PDFs on Workers | **invoicelah** (live). **procureflow** (live): approval chain from purchase request to purchase order. **mtncars** (live): fills a document from a MyKad and a customs form, and is already a Hermes skill. |
| **Walk-in queue** | booking-platform's KV waiting room, scaled down | none |
| **Job tracker** | cleanflow | **calligraphy-order**: production board and TV view. **trackerflow**: project phases. **aisar-iso**: client portal for tasks and evidence. **VRS/sabah-civic-platform**: case-status stepper. |
| **Delivery status** | Pintas couriers | cleanflow's tracking page |
| **Statement & pay** | invoicelah | **rentflow** (live): rent. **aisar-halalos**: invoice numbering, overdue, PDF. **trackerflow**: invoice per phase. **invoisee**: public pay-page screens. BayarCash direct debit. |
| **Checklists** | aisar-iso evidence checklist | **MBJB**: rules engine for document completeness |
| **Stock count, Daily closing, Business numbers** | duopharma-pa-etime (live at pa.engagerx.co): daily sales, stock on hand, targets, a role hierarchy | **meowmeow**: sales analytics, forecasting, AI over the numbers. **duopharma-etl**: normalising 23 vendor exports. |
| **Receipts & expenses** | invoicelah's expenses table | **zeptospace**: the loop of watch, propose, approve, log, undo |
| **Feedback & reviews** | reviews in seido-shop and Pintas | **voluca**: ratings |
| **Loyalty** | `shipfast/loyca` (loyca.my): points across outlets, rewards, vouchers, encrypted QR scanning, OTP, referrals | **loyca-ebook**: Malay content on running loyalty programmes. **tasty-points-haven**: stamp-card screens. **gymbro-crm**: promos and referrals. |
| **Service-due reminders** | aisar-halalos compliance calendar and its WhatsApp reminder outbox (drafts only, never sends) | **picklebook**: reminders. **ekon-expert**: the aircond-servicing domain. |
| **Business page** | mole-app | **evica**. **hotzilla**. **webagency-lp**: 17 SME verticals. **landing-themes**: 15 styles. **okketu**: link-in-bio and short links. |
| **Custom forms** | mole-app forms and submissions | **evica**: RSVP. **erecondmy**: multi-step enquiry. |
| **Team seats** | gymbro-crm `role_permissions` | **duopharma-pa-etime**: roles. **procureflow**: approval chain. |
| **Company docs** | VRS/AIClassroom: cited answers | **pixelspace**: on-premise, for government. **aikita.my**. **sabot** RAG. |

"Loyca" is also the name of a loyalty product (`shipfast/loyca`, loyca.my).
This is separate from the Loyca booking platform in `supateam/supateam-ai`.

### Consolidate, do not port

- **Jentera's own predecessors:** aisar.ai, aisya-copied-from-aisar,
  aisar.ai/landing, autoscale, scaleup/autoscale, aisar-halal.
- **Superseded copies:**
  - salesrobot and salesrobot-ai-enhancements, replaced by sabot
  - zeptoclaw-sea-new-integrations, a stale worktree
  - pixelspace-v2, an older checkout of pixelspace
  - shipfast/loyalty-app-supabase, an early Pantas despite the name
- **Agent runtimes:** zeptoclaw, zeptort, zeptocapsule, zeptoPM, the
  zeptobeam family, pi-rs, picoclaw, r8r. Jentera runs on Hermes. Only r8r's
  approval and wait nodes are worth reading, as design.

### Found along the way, outside this repo

- **Committed secrets. Rotate them.** All three GitHub repos are private
  (checked 23 Sep), and the values are not copied here:
  - `trackerflow/api/wrangler.toml`: a Neon connection string with its
    password, and `CLOUDFLARE_TOKEN`
  - `mkj-quotation-generator/api/wrangler.toml`: a Neon connection string
    with its password
  - `render-blueprint/rakamai-worker/tasks.py`: an OpenAI key
- **Signature bugs:** Billplz in Pantas, Pintas and zeptoclaw-sea (above).
  Pantas and Pintas are both live, so if either takes real Billplz payments
  this matters beyond the port. The survey
  also reports picklebook's webhook path expecting fields Billplz does not
  send; its redirect path is correct.
- **invoicelah:** its vault function deletes every secret, and its CLAUDE.md
  describes a stack and a MyInvois endpoint that are not in the code.

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
- **Prices.** The add-on model is agreed; the numbers are not. They should come
  from measured cost per module and per run. Does the RM99 → RM199 base come
  down?
- **The public domain.** Choose the name, check it is available, and start the
  Public Suffix List submission early.
- **Subtraction.** Which of the roughly 20 existing surfaces are hidden from
  owners so that Apps is not simply added on top? Decide before Apps ships.
- **The futures of Loyca and Pantas.** Both stay separate for now. Whether
  either folds into Jentera is a later decision, made on which products win
  customers. Until then, Meta API changes are fixed in two WhatsApp copies and
  gateway changes in two Billplz copies.
- **The Jentera Meta app.** Its name and use-case wording for review. Reuse
  Loyca's wording where the flow is the same.
- **Rotate the three committed secrets** listed under
  [Found along the way](#found-along-the-way-outside-this-repo).

## Appendix A: every owned repo

These are the 146 repos under `~/ios` with at least ten commits by the owner,
excluding this repo and the command centre. They were surveyed on 23 Sep 2026
from each repo's README, CLAUDE.md, manifests and deploy config. "Live" means
the survey found a domain or a deploy target, not that anyone checked it was
up. Paths are relative to `~/ios`.

<details>
<summary>Products and plumbing Jentera can learn from (52)</summary>

| Repo | What it is | Live | For Jentera |
|---|---|---|---|
| `supateam/supateam-ai` | Loyca: AI booking receptionist with WhatsApp Cloud API and Embedded Signup | loyca.ai | Port: WhatsApp onboarding; Bookings |
| `shipfast/pantas.ai` | Pantas: creator store for digital products, 5 gateways, transaction fees | pantas.ai | Port: payments (agreed); Shop, digital products; pricing model |
| `mobile-apps/pintas-ai-temp` | Pintas: WhatsApp storefront (like TakeApp), 4 gateways, couriers, custom domains | pintas.ai | Port: couriers, custom-domain flow; Shop (physical goods), Delivery |
| `picklebook` | Court booking on Workers: slots, waitlist, tournaments, Billplz, reminders | picklebook.my | Port: Billplz signature, provider interface; Bookings |
| `seido-shop` | Seido coffee store (minshop fork) with CHIP | seido.kitakod.com | Port: CHIP; Shop |
| `engagerxhealth/simple-broadcast` | WhatsApp template and email broadcasts, delivery tracking, opt-outs | Workers + D1 in use | Port: WhatsApp webhooks |
| `zeptoclaw-sea` | 37 SEA connector servers (marketplaces, payments, logistics, messaging) | not proven | Port: connector clients |
| `mkj-quotation-generator` | TerbangCRM: travel quotes, versions, client portal, PDFs on Workers | workers.dev API | PDFs; Quotes |
| `invoice-generator` | CLI: invoice, quote, receipt and DO as HTML, DOCX or PDF | CLI | Document schema |
| `mole-app` | Mole: digital card and mini-site builder with forms, leads, tickets | mole.is | Public-page model; Business page, Forms |
| `mobile-apps/cleanflow` | Cleaning booking, crew dispatch, live job tracking | cleanflow.superutils.app | Bookings, Job tracker |
| `booking-platform` | High-concurrency restaurant booking, slot hold → confirm | workers.dev | Bookings slot model; queue |
| `sabot` | SalesBot: WhatsApp sales agent, pipeline, follow-ups, appointments | api.sabot.my | Enquiries/CRM |
| `invoicelah` | Invoices and quotes for Malaysian SMBs, PDF templates, Stripe links | invoicelah.com | Quotes, Statement & pay |
| `shipfast/loyca` | Loyalty across outlets: points, rewards, vouchers, QR, referrals | loyca.my | Loyalty |
| `mobile-apps/daily-order-system` | Office catering: daily menus, group orders that lock at a deadline | dailyorder.turbospark.my | Orders (pre-orders) |
| `mobile-apps/calligraphy-order` | Frame POS and production line, DO print, SQL Account CSV (client: Dian) | dian.superutils.app | Orders, Job tracker |
| `mobile-apps/stayflow` | Homestay management | stayflow.turbospark.my | Bookings (rental) |
| `mobile-apps/rentflow` | Rent collection for Malaysian landlords | rentflow.turbospark.my | Statement & pay |
| `aisar-halalos` | Halal certification engine: readiness, reminders, billing | halalos.aisar.ai | Service-due, Statement & pay |
| `aisar-iso` | ISO/halal consultant workspace and client portal | iso.aisar.ai | Checklists, Job tracker |
| `procureflow` | Purchase request → purchase order approvals for construction firms | procureflow.kitakodventures.com | Quotes, approvals |
| `jawiAT` | Store for Jawi software, workshops, wakaf; CHIP | jawiat.com | CHIP; digital goods |
| `funnel-kit` | Lead capture and mini CRM on Workers, one config per business | no | Enquiries, Business page |
| `zeptosupport` | Multi-tenant WhatsApp support bot with KB and escalation | no | WhatsApp routing; Enquiries |
| `rust/bayarcash-sdk` | BayarCash SDK: FPX, DuitNow, direct debit (Rust) | crates.io | BayarCash reference |
| `rust/chip-asia-rs` | CHIP SDK, full purchase lifecycle, 52 tests (Rust) | crates.io | CHIP reference |
| `rust/billplz-rs` | Billplz SDK, no webhook verification (Rust) | git | Billplz reference |
| `sparkly.my` | Course platform for Malaysian creators; CHIP, per-seller keys | sparkly.my | CHIP reference |
| `shipfast/gymbro-crm` | Gym CRM: classes, packages, promos, referrals, roles | no | Bookings (classes), Loyalty, Team |
| `shipfast/evica` | Wedding e-invitation builder: JSON page, RSVP, Waze, gifts | no | Business page, Forms |
| `shipfast/acara.pro` | Events directory | acara.pro | Bookings (events) |
| `shipfast/voluca` | Volunteer events, registrations, ratings | no | Bookings (events), Reviews |
| `trackerflow` | Client/project tracker, invoices per phase | Pages | Job tracker, Statement & pay |
| `hotzilla` | Street-food brand site, WhatsApp ordering | no | Business page, menu |
| `webagency-lp` | 17 SME landing pages and a wa.me menu | unclear | Business page, menu |
| `landing-themes` | One landing page in 15 visual styles | no | Design reference |
| `okketu.com` | Link shortener, link-in-bio, uptime check | okketu.com | Business page (link-in-bio) |
| `crater/crater.store` | Multi-tenant store builder with custom domains (Vercel) | Vercel | Custom-domain flow |
| `kelasopenclaw` | Video course sales and hosting on Workers, magic-link login | kelasopenclaw.my | Digital goods |
| `sales-academy-crm` | Sales pipeline, lead timeline, leaderboard | no | CRM schema |
| `ai-native-sales-crm` | AI sales screens and Malaysian market notes | no | CRM, WhatsApp options doc |
| `bizcard-crm` | Business-card scanner (OCR) | Android preview | Lead capture |
| `invoisee` | Invoice and recurring-billing screens, no backend | no | Pay-page screens |
| `erecondmy` | Used-car listings with multi-step enquiry | no | Catalogue, Enquiries |
| `renorumah` | Renovation marketplace prototype | no | Quotes (screens) |
| `tasty-points-haven` | Restaurant mock-up: stamps, menu, booking, no backend | Lovable | Loyalty screens |
| `digital-product/loyca-ebook` | Malay ebook on running loyalty programmes | unclear | Loyalty content |
| `vite-web-builder/crate-web-builder` | Pixel-canvas page editor | no | Poor fit for chat editing |
| `toolis-client` | AI copywriter with senangPay sandbox | no | senangPay (sandbox) |
| `dekstop-apps/license-hub` | Desktop licences, Stripe, affiliates, promos | licensehub.superutils.app | Referrals |
| `kitakod-ui` | Design tokens, unused by Jentera | no | Skip |

</details>

<details>
<summary>Client work (27)</summary>

| Repo | What it is | Live |
|---|---|---|
| `MBJB` | Planning-application pre-check for Johor Bahru city council | password-protected demo |
| `mtncars` | MyKad + Customs Form 8 → vehicle sales order; a Hermes skill | mtn.kitakod.com |
| `duopharma-pa-etime` | Field-force PWA: daily sales, stock on hand, targets | pa.engagerx.co |
| `duopharma-etl` | Merges 23 vendor sales exports | VPS |
| `duopharma-etl-demo` | Demo of the above | Pages |
| `meowmeow` | Sales analytics and forecast | Pages |
| `engagerxhealth/aisa` | WhatsApp engagement platform for pharma reps and doctors | demo |
| `engagerxhealth/engagerxhealth-landing` | EngageRx marketing site | engagerx.co |
| `pixelspace/open-webui-react` | On-premise AI workspace for a government client | on-premise |
| `pixelspace-v2` | Older checkout of the same | same |
| `vrs-ai-classroom` | Teacher lesson plans and grading | aiclassroom.superutils.app |
| `VRS/AIClassroom` | Textbook RAG and AI quizzes, with citations | aiclassroom.superutils.app |
| `VRS/citizenscience` | National citizen-science platform | citizenscience.superutils.app |
| `VRS/sabah-civic-platform` | Education case reporting and tracking | no |
| `supateam/loyca-booking` | Hospital EMR co-pilot, not a booking app | ai.loyca.my |
| `supateam/puffin-ai` | Hospital bed and patient-flow agent | Worker |
| `ekon-expert` | Aircond-servicing site | no |
| `zentrip-morocco` | Travel-agency landing page | no |
| `zentrip-landing` | Travel-agency landing page | no |
| `sk-woo-discount.1.0.4` | WooCommerce tiered-discount plugin | n/a |
| `pressly-app` | Japanese facility calendars and posters | app.pressly.co.jp |
| `fito/fito-app` | Japanese client app | unclear |
| `fito/fito-account` | Japanese client app | unclear |
| `fito/fukule-fito-2.0-app` | Japanese client app | unclear |
| `techbiz/techbiz-front` | Japanese client front end | unclear |
| `matchhat/matchhat-backend-v2` | MatchHat GraphQL back end | was matchhat.com |
| `matchhat/matchhat-frontend` | MatchHat front end | was matchhat.com |

</details>

<details>
<summary>Jentera, its predecessors and its runtime (9)</summary>

- `aisar-vault`: Jentera's credential broker, already core
- `hermes-agent`, `hermes-agent-ultra`: the agent runtime Jentera runs
- `aisar.ai`: the earlier Aisar support chatbot with WhatsApp (aisar.ai)
- `aisar.ai/landing`: the earlier Aisar landing page
- `aisya-copied-from-aisar`: a copy of the above
- `aisar-halal`: an earlier halal compliance MVP
- `autoscale`, `scaleup/autoscale`: AutoScale.my, an early Jentera concept
  (screens for a daily brief and an action inbox)

</details>

<details>
<summary>Agent runtimes (17)</summary>

- `zeptoclaw`: Rust multi-channel assistant runtime (zeptoclaw.com)
- `zeptoclaw-android`: the same runtime with more channels
- `zeptoclaw-sea-new-integrations`: a stale worktree of zeptoclaw-sea
- `zeptort`: durable agent supervisor
- `zeptocapsule`: sandbox for agent jobs
- `zeptoPM`: process manager for agents
- `zeptoclaw-rt`, `zeptobeam`, `zeptoclaw-rt-beam-parity`: ErlangRT
  experiments
- `pi-rs`, `pi-rs-gap-fixes`: terminal coding agent
- `picoclaw`: fork of sipeed/picoclaw
- `r8r`: agent-first workflow engine (approval and wait nodes are worth
  reading)
- `salesrobot`, `salesrobot-ai-enhancements`: replaced by sabot
- `aikita.my`: AI assistant for government services, with LHDN FAQ content
- `VRS/citizenscience/citizenscience-pm`: agent config only

</details>

<details>
<summary>Research, tooling and desktop apps (26)</summary>

- **Research:**
  - `sparse-attention/zeptolm`: small language models
  - `spiking-neural-network`
  - `turboquant-rs`
  - `amanda-drug-research`
  - `posture-wearable`
  - `mole-face-finder`
  - `zepto-machine-explorer`
- **Developer tools:**
  - `rsgrep` (frg)
  - `rust/pandorust`: pure-Rust PDF writer
  - `rust/gogcli-rs`
  - `safeshell`
  - `kitakod-platform`
  - `kitakod-agent`
  - `awesome-claw`
  - `test-dokku`
  - `test-chat-widget/nextjs-boilerplate`
  - `render-blueprint/rakamai-worker`
- **Desktop apps:**
  - `dekstop-apps/whisper-in`
  - `dekstop-apps/gowhisper/gowhisper-dekstop`
  - `dekstop-apps/gowhisper/gowhisper-release`
  - `dekstop-apps/goconvert`
  - `dekstop-apps/motiondeck`
  - `dekstop-apps/magic-cursor`
  - `dekstop-apps/DemonChat`
  - `zeptospace`: Mac filing of invoices and receipts
- **Other:**
  - `jawiat-keyboards`: Windows installer

</details>

<details>
<summary>Other products, not relevant to apps (15)</summary>

- `kitakodventures`: company landing page (kitakod.com)
- `qhkm.dev`: portfolio
- `zeptostack`: Zepto stack site (zeptostack.com)
- `godamclan`: builders' social platform (godamclan.com)
- `solocoach`: AI coach for solopreneurs
- `ketravelan-sidebar-flow-27`: travel community
- `rakamai/rakamai-client`: transcription SaaS
- `chatbot-prj/chatbot-prj-client`: Rakamai prompt SaaS
- `toolis-landing`: AI copywriter landing page
- `smartreplier/smartreplier-ext`: email-reply helper
- `smartreplier/smartreplier-backend`: its API
- `smartreplier/smartreplier-client`: its dashboard
- `malaypod`: Malay podcast directory
- `shipfast/funnel-builder`: empty shell
- `shipfast/loyalty-app-supabase`: an early Pantas, despite the name

</details>
