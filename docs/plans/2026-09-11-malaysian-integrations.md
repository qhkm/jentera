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

### Tier 3 — no path, and planning should say so

**Banking.** Maybank2u/M2E, CIMB BizChannel/OCTO Biz, RHB Reflex, Hong Leong
ConnectFirst. There is no self-serve API for an SME. The routes that exist are
a corporate host-to-host arrangement, which is bank onboarding rather than
something an owner clicks, or driving the owner's own login — which this
document argues against below and which per-transaction TAC is designed to
prevent regardless.

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
