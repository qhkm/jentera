# Malaysian integrations, and a credential broker to reach them

Status: **proposed**. Prepared 11 September 2026. Nothing here is built beyond
what the last section marks as already shipped.

Two things belong in one document because they answer each other. The
integration map says what Malaysian SMEs actually run. The broker says how an
agent is allowed to touch it. Deciding the second one late would mean
retrofitting credential handling across every connector that got there first.

## What this is not

It is not a claim that any of these integrations work. Today the catalogue in
`worker/src/connectors.ts` is ten generic names, every one of them
`NOT_WIRED`. The only live connector is Telegram.

It is also not a roadmap in the sense of dates. It is a feasibility triage, and
its whole value is telling apart three things that a wish list makes look
identical: what an owner can connect this week, what needs a registration
somebody has to start now, and what has no path at all and should stop being
planned for.

## Triage by how the owner authenticates

Grouping by business area hides the only thing that decides what can be built.
Grouped by authentication instead:

### Tier 1 — an owner can connect it today

Self-serve API key or token, issued by the provider to the owner, no approval
queue and nobody to wait for. These work with the token connector shipped on
2026-09-10 (`worker/src/token-connectors.ts`, the Connections tab).

| Area | Providers |
|---|---|
| Payments | Billplz, ToyyibPay, senangPay, Stripe |
| Logistics | EasyParcel |
| E-commerce | Shopify |
| Accounting (cloud) | Bukku, Financio |
| CRM | HubSpot, Zoho |

### Tier 2 — real API, but a registration must be started first

The provider requires *Jentera* to register an application and be approved
before any owner can connect. The owner then authorises through OAuth. The lead
time is the reason to start now rather than when the connector is scheduled.

| Area | Providers | What must be registered |
|---|---|---|
| Messaging | WhatsApp Business | Meta app, permanent token |
| Marketplaces | Shopee MY, Lazada MY, TikTok Shop | Open Platform app, per-marketplace approval |
| Documents / email | Google (Drive, Sheets, Gmail, Calendar), Microsoft (OneDrive, Outlook, Teams) | OAuth client, scope review |
| Internal comms | Slack | OAuth app |
| E-Invoice | MyInvois / LHDN | Taxpayer client credentials, or intermediary registration |
| Logistics | Ninja Van, J&T Express | Merchant account API access |

### Tier 3 — no connector path

No amount of connector work reaches these, which is a different statement from
"impossible". Each is reachable as its own product, at its own stake, and
"Tier 3 as products" below is where that is argued. What matters here is that
none of them is a connector, so none should sit on a connector roadmap.


**Banking.** Maybank2u/M2E, CIMB BizChannel/OCTO Biz, RHB Reflex, Hong Leong
ConnectFirst. There is no self-serve API for an SME. The routes that exist are
a corporate host-to-host arrangement, which is bank onboarding rather than
something an owner clicks, or driving the owner's own login — which this
document argues against under "Tier 3 as products", and which per-transaction
TAC is designed to prevent regardless.

*The achievable version is statement-based.* An owner exports MT940 or CSV and
Jentera reconciles against it. "Match transactions, prepare reconciliation" is
real work and is genuinely deliverable that way. "Check incoming payments" as a
live balance is not, and should be dropped from the pitch rather than carried
as a maybe.

**Government portals.** MyTax, KWSP/EPF, PERKESO/SOCSO, EIS are employer
portals with no third-party API. Payroll software integrates by generating a
submission file, not by submitting. So *prepare the submission, check what is
outstanding, remind before the deadline* is achievable and useful; *file it on
the owner's behalf* is not, and is a poor thing to promise about a statutory
obligation.

**On-premise accounting.** AutoCount, SQL Account, SQL Payroll, AutoCount
Payroll are on-premise SQL Server products with no cloud API. Reaching them
means either file import/export or an agent installed on the owner's own
machine — a different product with its own support burden, not a connector.
StoreHub, EasyStore and Slurp! are cloud and belong in Tier 1 or 2 once their
auth is confirmed.

### A caveat on all three tiers

This triage reflects knowledge to May 2026. Malaysian API availability moves,
MyInvois most of all given the phased mandate. Confirm the specific provider
before committing roadmap to it; the tiers are a way of thinking, not a
citation.

## The second axis: what the action costs if it is wrong

The integration map's third column mixes things that need very different
treatment. Three classes, and a connector should declare which it is:

- **Read.** "Check outstanding invoices", "retrieve tracking", "sales
  reporting". Wrong output is a wrong answer, and the owner can see it.
- **Reaches a person.** "Send payment reminders", "customer follow-up",
  "chase updates". Wrong output reaches the owner's customer in the owner's
  name, and cannot be recalled.
- **Moves money or files a statutory return.** "Create payment links",
  "submit e-invoices", "payroll preparation". Wrong output has a counterparty
  and a regulator.

The approval card shipped on 2026-09-10 is the mechanism for the second and
third. Which specific operations sit behind it is a product decision this
document does not settle — but the classification should be per operation and
declared in the connector, not decided by whoever writes the executor.

## The credential broker

### The problem, stated precisely

Storage is solved. `worker/src/vault.ts` seals credentials under
`CREDENTIAL_KEY` with AES-GCM, versioned for rotation, and `credential` rows
are reachable only through their connection's RLS. Nothing about how a secret
sits at rest needs inventing.

The exposure is *use*. A sprite runs a general-purpose agent holding a
terminal, so a credential delivered to that machine is one the agent can read
and therefore one it can be talked into repeating. Since `web_extract` began
pulling arbitrary web pages into that agent's context, "the agent can read it"
and "a stranger's web page can ask for it" describe the same exposure.

Today's split — control-plane credentials stay in the Worker, runtime ones
reach the sprite — reduces the blast radius but does not remove it. Connecting
Cloudflare puts `CLOUDFLARE_API_TOKEN` into a sprite's environment, where the
agent can read it.

### The pattern already exists

The model already works this way and has since the runtime shipped. A sprite
holds a Jentera-derived credential (`deriveJenteraRuntimeCredential`) and calls
`https://api.jentera.ai/v1/model`. `worker/src/routes/model.ts` verifies that
credential and forwards upstream with `FMCV_UPSTREAM_KEY`. **The sprite has
never held the real model key.**

The broker is that pattern, generalised from one upstream to many.

### Shape

```
agent → https://api.jentera.ai/v1/connector/<connector>/<operation>
        Authorization: Bearer sk-jentera-v1.<business>.<mac>
                ↓
        Worker: resolve business, open sealed credential,
                check operation against the connector's allowlist,
                attach the real secret, forward, record
                ↓
        provider
```

Four properties, and the fourth is the point:

1. **The agent never holds a third-party secret.** It holds a Jentera identity
   and nothing else. This replaces the current rule with a stronger and simpler
   one: *sprites hold no third-party credentials at all.*
2. **Operations are allowlisted per connector.** Create a payment link, yes;
   delete an account, not reachable. The allowlist is the connector's declared
   surface, not whatever the provider's API happens to expose.
3. **Every use is recorded** against a business and a run, so "what did it do
   with my Stripe key" has an answer.
4. **Revocation is one row in the control plane.** Immediately effective, with
   nothing to clean up on thirteen sprites — which is what today's design would
   require.

### What it does not do

A compromised or prompt-injected agent can still perform an **allowed**
operation. That is containment, not immunity, and the distinction should not be
blurred when describing this to anyone: the difference is between "someone
tricked your agent into sending an invoice" and "someone has your Stripe key".
The first is recoverable and auditable. The second is not.

Nor does it change Tier 3. A broker fixes custody; it does not make using
somebody's banking password legitimate. TAC exists to stop exactly this, the
terms prohibit sharing, and liability lands on the owner. Banking stays
statement-based.

### Why not just keep secrets in the Worker

That is the current control-plane design and it is right for connectors the
Worker executes. The broker matters where the *agent* must drive the call —
because the operation is open-ended, or composed with reasoning, or part of a
longer task. Without a broker, those connectors either put the secret on the
sprite or cannot exist. With one, they can exist without the secret ever
leaving the control plane.

## Tier 3 as products, not integrations

Tier 1 is not defensible. Any competitor wires Billplz and Shopify in a
fortnight, because the provider did the hard part and published it. Tier 3 is
a moat for the same reason it is hard: it is not an API problem, it is
infrastructure somebody has to build and then keep running.

That makes it worth doing eventually. It also makes it three different
businesses, and building them as one "unified Tier 3 interface" would join
together things whose only shared property is that no API exists — with very
different stakes attached. Ordered here by stake, lowest first, because that
is the order to build them in.

### A. Statement reconciliation — the low-stake half of banking, available now

The banking row's value is "match transactions, prepare reconciliation, check
what is unpaid". Almost all of that is deliverable from a file the owner
already has: every Malaysian bank exports statements as CSV, and many as
MT940.

An owner uploads a statement. Jentera matches it against invoices and tells
them what cleared, what did not, and what is overdue. No credential is held,
no bank is called, no regulator is involved, and nothing about it forecloses a
licensed version later. It is the cheapest genuinely useful thing on this
page and it needs permission from nobody.

What it does not give is a live balance or same-day movement. That limitation
should be stated to owners rather than engineered around, because engineering
around it is section C.

### B. The on-premise bridge — AutoCount, SQL Account, SQL Payroll

More work than statements, still no regulator, and the most defensible thing
here.

These are SQL Server products installed on a machine in the office, with tens
of thousands of Malaysian SMEs and accounting firms on them and no cloud path.
A local agent that reads the database and exposes a normalised API is ordinary
software: no counterparty, and no credential custody beyond the owner's own
database.

The moat is that it is tedious. Schema differences across versions, upgrades
that move columns, machines that sleep, offices behind NAT. Nobody wants to
own that, which is exactly why owning it is worth something.

The buyer is likelier the accounting firm than the SME. A firm with fifty
clients on AutoCount has the same problem fifty times, which is a better
conversation than selling one shop a connector.

What must be decided before code:

- **Deployment.** A Windows service the owner installs, or a container on
  their server. Updating it across hundreds of offices is the real engineering
  problem, not reading the database.
- **Direction.** Read-only first. A bridge that reports is recoverable when it
  is wrong; one that writes into the owner's ledger is not, and a bad write
  into somebody's accounts is a severe support event.
- **Reach.** Outbound-only from the office. Anything needing an inbound port
  or a static IP will not survive contact with real SME networks.
- **Version pinning.** Which AutoCount and SQL Account versions are supported,
  and what happens when the owner upgrades underneath it.

### C. Live bank access — later, and a different business

Deferred deliberately. Bank data aggregation means *becoming an aggregator* —
the category Brankas, Finantier and Plaid occupy. That is a licensing and
partnership posture with code attached, not an engineering project, and the
stake is not comparable to anything else on this page.

The questions to answer before any design, none of them technical:

- What is BNM's current position on third-party access to bank data, and does
  the intended service require authorisation? *This document's knowledge runs
  to May 2026 and open banking was moving; confirm before planning around it.*
- Would access come by agreement with each bank, or by driving the customer's
  own credentials? The second is what this plan argues against elsewhere and
  should not re-enter through a product wrapper.
- Who is liable when a balance or transaction is reported wrongly, and what
  does the customer agreement say?
- Does per-transaction TAC make anything beyond reading impossible anyway, and
  if so, is a read-only product worth the licensing?

Section A delivers most of the value while these stay unanswered, which is the
argument for answering them slowly.

### D. MyInvois is the timing exception

The one place where waiting costs something. It has a real API, and the
mandate arrives for each business on a known date whether they want it or not,
so the buying decision is made for them and the only question is who they buy
from. A business that has already solved e-invoicing will not revisit it.

That makes it the strongest candidate to be a product in its own right rather
than a Jentera feature — and the one item here where "later" has a price.

What must be decided:

- **Intermediary or per-taxpayer credentials.** Registering as an intermediary
  is more work and more responsibility, and it is what lets a firm file for
  many clients — the same accounting-firm buyer as the bridge.
- **Where validation failures land.** A rejected submission is the product's
  real surface; anyone can send a well-formed invoice.
- **Retention and evidence.** What is kept, for how long, and what an owner
  can show an auditor.

### On selling any of these to others

Exposing a bridge to third parties changes the obligations more than it looks.
Today, when Jentera is wrong it is our agent and our customer. When somebody
else's product misreports a client's payables because a connector drifted
after an AutoCount upgrade, that is a platform failure with their customer,
and platform businesses carry versioned APIs, deprecation policy, a status
page and a support commitment.

That is a real and probably better business. It should be entered
deliberately rather than discovered, and the sequencing that avoids
discovering it is: **build as Jentera's own infrastructure, let it carry our
load for a while, and expose it once it has stopped surprising us.** Building
it privately forecloses nothing; the reverse is not true.

## Delivery order

1. **Broker skeleton**, with Cloudflare as the first connector behind it, and
   `CLOUDFLARE_API_TOKEN` removed from `CONFIG_ALLOWED_ENV`. This turns an
   existing weakness into a closed one and proves the path with a connector
   that has no customers on it.
2. **Billplz or ToyyibPay** as the first business connector. Self-serve key so
   nothing waits on a registration; genuinely useful operations; mostly reads
   with one clearly approvable write.
3. **EasyParcel.** Same shape, tracking is read-only, and it exercises a second
   provider's error behaviour.
4. **Start Tier 2 registrations in parallel** — WhatsApp and the marketplaces
   have the longest lead times and block nothing until they are needed.
5. **Statement reconciliation.** Independent of the broker and of every
   connector: it holds no credential and calls nobody, so it can be built
   beside any of the above. It delivers most of what the banking row promises
   at the lowest stake on this page.
6. **The on-premise bridge, as Jentera's own infrastructure.** Different
   codebase, different deployment, different buyer. Last here only because it
   blocks nothing, not because it matters least — see Tier 3 above for why it
   is likely the most defensible thing on this page.

## Acceptance gate

Before the broker carries a real credential:

- A sprite holds no third-party secret. Asserted the way the existing test
  does it: render the configuration document and assert the credential's bytes
  appear nowhere in it.
- An operation outside a connector's allowlist is refused by the Worker, and
  the refusal is recorded.
- A revoked connection stops working immediately, without a fleet action.
- One business cannot reach another's credential, asserted as `aisar_app`
  rather than as owner.
- The broker's own credential verification is exercised for failure, not only
  success — a forged or expired Jentera credential is refused.

## Already shipped, for reference

- `worker/src/vault.ts` — sealed credential storage, versioned keys
- `connection` / `credential` tables with RLS reaching through (migration 009)
- `worker/src/token-connectors.ts` — a catalogue that verifies before storing
- `POST /api/connections/token` and the Connections tab — an owner can paste a
  scoped token today
- `worker/src/runtime/runtime-credentials.ts` — the control-plane/runtime split
  the broker is intended to make unnecessary
- `worker/src/routes/model.ts` — the broker pattern, already in production for
  one upstream
