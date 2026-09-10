# The on-premise bridge — reaching AutoCount and SQL Account

Status: **not pursued**, decided 11 September 2026. Kept for the reasoning,
not as a roadmap item. Nothing is built and nothing is planned.

**Why it was dropped.** Jentera is a cloud product and stays one. Anything
installed on a customer's machine scales the wrong way: every installation is
a computer nobody here controls, an update that cannot be rolled back
centrally, and a fault that cannot be reproduced. Thirteen sprites are already
a fleet to manage; hundreds of office servers on unknown Windows versions,
behind unknown networks, upgraded on their owners' schedules, is a different
company.

The defensibility argued below is real — and it is exactly the tedium that
makes it unscalable. It was also written assuming accounting firms as the
channel, which would have amortised the installations. Serving SMEs directly
removes even that, but the cloud-only decision would rule it out regardless.

The reasoning is kept because the architecture section holds independently:
the agent asks the control plane and never reaches into a customer's network.
That rule applies to anything touching a customer's own systems, however it is
reached.

Companion to `2026-09-11-malaysian-integrations.md`.

## Why this and not a connector

AutoCount and SQL Account are SQL Server applications installed on a machine
in the office. There is no cloud endpoint to call and no token an owner can
paste, so no amount of connector work reaches them. Reaching them means
software running inside the office, which is a different product with its own
deployment, update and support story.

It is worth that because of what it is not. No regulator. No counterparty. No
statutory act. Under the rule in the companion document — prepare, do not file
— this is entirely on the near side of the line, while being the thing a
Malaysian SME's numbers actually live in.

And it is defensible precisely because it is tedious. Schema differences
across versions, upgrades that move columns, machines that sleep at 6pm,
offices behind NAT with no fixed address. Nobody wants to own that. Owning it
is therefore worth something, in a way that wiring a documented REST API never
will be.

## The buyer is the accounting firm

This is the part that changes the product, and it should be decided before the
architecture rather than discovered after.

An SME with AutoCount has this problem once. A firm with fifty clients on
AutoCount has it fifty times, already visits or remotes into those machines,
already holds the credentials, and already suffers the month-end that this
would shorten. They are also a single sale that brings fifty installations.

If that is right, three things follow, and none of them is a small detail:

- **Multi-tenancy is a first-class concern in the agent**, not just in the
  control plane. One installation may serve one client, but one *firm* manages
  many installations, and they need a view across them.
- **The installer is used by a technician**, not a shop owner. That permits a
  more capable and less hand-held setup than a consumer install, and it means
  documentation is for someone who will read it.
- **Support is a relationship with the firm**, not fifty relationships with
  their clients. That is a considerably better shape, and it should inform who
  the software reports errors to.

This needs confirming with an actual firm before it is built on. It is the
assumption most likely to be wrong and most expensive to be wrong about.

## What it does, in the first version

Reads. Nothing else.

| Read | Answers |
|---|---|
| Customers, suppliers | "Who is this on the invoice?" |
| Invoices, credit notes, payments | "What is outstanding, and since when?" |
| Chart of accounts, balances | "What did we spend on rent this quarter?" |
| Stock items and levels | "Are we out of anything?" |

Out of scope for the first version, and stated so it does not creep in:

- **No writes.** Not invoices, not payments, not journal entries. A bridge
  that reports is recoverable when it is wrong; a bad write into somebody's
  ledger is a support event with an accountant on the other end, and it can
  reach a statutory return by the time anybody notices.
- **No payroll.** SQL Payroll and AutoCount Payroll touch EPF, SOCSO and EIS,
  which is the far side of the line even to read carelessly.
- **No live-at-the-keystroke.** Periodic snapshots are enough for every
  question above, and polling a customer's production database aggressively is
  a good way to be blamed for their slow month-end.

## Shape

```
office                          |  Jentera
                                |
AutoCount / SQL Account         |
   (SQL Server, LAN)            |
        ↑ read-only             |
   Jentera Bridge  ──────────────→  control plane
   (local service)   outbound     (normalised, per business,
                     HTTPS only    sealed at rest)
                                |          ↑
                                |     the agent asks here
                                |     and never reaches the office
```

Four properties, and the last is the one that keeps this out of trouble.

1. **Outbound only.** The bridge dials out and holds the connection. Nothing
   inbound, no port forwarding, no static IP, no VPN. Anything else does not
   survive contact with a real SME network, and asking a firm to open a port
   into a client's accounting server is asking them to say no.
2. **Read-only at the database.** The credential the bridge uses is a SQL
   Server login with select rights and nothing more. If the product later
   writes, that is a different grant, made deliberately.
3. **Normalised on the way out.** The control plane stores invoices and
   balances, not AutoCount's tables. Version differences are absorbed at the
   edge, once, by the component that knows which version it is talking to.
4. **The agent never touches the office.** It asks the control plane, which
   already holds the data. No sprite reaches into a customer's LAN, no
   credential for their database ever leaves the office, and the blast radius
   of a prompt-injected agent stays what it already is.

That last point is the same rule as the credential broker in the companion
document, arrived at from the other end: the thing holding the secret and the
thing doing the reasoning should not be the same thing.

## The parts that are actually hard

Worth naming, because they are the work — reading a table is not.

**Schema drift.** AutoCount and SQL Account have many versions in the field
and SMEs upgrade unpredictably. The bridge must detect which version it is
attached to, refuse a version it does not know rather than guess at a column,
and say so in a way that reaches somebody. Silently reading the wrong column
is worse than not reading.

**Updating the fleet of bridges.** Hundreds of offices, no remote hands, and a
bad update is a site visit. This needs a staged rollout, a version the control
plane can see, and the ability to hold a version back for one firm. It is the
same problem as the sprite fleet and should borrow from it rather than
reinvent it — including the lesson that a release must prove itself on the
machine before it is called ready.

**Machines that are not on.** Offices switch things off. The bridge must
tolerate long absences, resume without a full resync, and the control plane
must be able to say "this data is from Tuesday" rather than implying it is
current. Stale-but-labelled is fine; stale-and-silent is not.

**First sync size.** A firm with years of history will not enjoy a first sync
that saturates their line during business hours. Incremental by default,
backfill scheduled and interruptible.

**Being blamed for the database.** Any slowdown at month-end will be blamed on
the new thing reading the database. Query cost has to be defensible: bounded,
scheduled, off-peak by default, and measurable so the claim can be answered
with numbers.

## Decisions needed before code

1. **Read path: SDK or direct SQL?** AutoCount publishes an SDK; direct table
   reads are simpler and far more brittle across versions. The SDK likely
   costs less over time and more upfront. *This needs verifying against
   current AutoCount and SQL Account offerings — this document does not know
   the present state of either.*
2. **Deployment target.** Windows service is where these machines are. A
   container is cleaner and often unavailable in an SME office.
3. **Who installs it**, following from the buyer question — technician or
   owner. Decides how much the installer must do by itself.
4. **What the firm sees.** If the buyer is a firm, they need a view of which
   client bridges are healthy, stale, or on an old version. That is a product
   surface, not an internal dashboard.
5. **Where the data lives**, and for how long. Somebody else's complete ledger
   is a serious thing to hold, and the retention answer should exist before
   the first byte, not after the first question about it.

## Acceptance gate

Before a bridge points at a real customer's database:

- It reads with a select-only login, and is demonstrated to fail closed
  against a login with write rights removed mid-session.
- An unknown application version is refused with a message naming the version,
  not silently mapped onto the nearest known schema.
- All traffic is outbound; the bridge works from a network with no inbound
  reachability at all, asserted by testing behind NAT rather than by design
  intent.
- One firm's data is unreachable from another firm's session, asserted at the
  control plane the way tenant isolation already is — as the restricted role,
  not as owner.
- A machine offline for a week resumes without a full resync, and the data it
  produced is labelled with when it was true.
- Query cost against a representative database is measured and recorded here,
  so the month-end conversation can be had with numbers.

## Sequencing

This blocks nothing and is blocked by nothing. It shares no code with the
connector work and has a different buyer, so it can be built beside it.

The order that avoids the worst mistake — building the wrong thing well:

1. Confirm the buyer with one real accounting firm. If it is the SME rather
   than the firm, most of this document changes.
2. One version of one product, read-only, one customer, one question worth
   answering. "What is outstanding?" is enough.
3. The update mechanism, before the second installation rather than after the
   twentieth.
4. Breadth — more versions, the second product, more entities.

Exposing it to third parties is deliberately not in this plan. Build it as
Jentera's own infrastructure, let it carry our load, and revisit selling it
once it has stopped surprising us. That order forecloses nothing; the reverse
does.
