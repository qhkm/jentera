# AISAR Backend Integration — Design

**Date:** 2026-08-21
**Status:** Approved design, ready for implementation planning
**Supersedes nothing.** Complements `PRODUCT_VISION.md`, `DISCUSSION_SUMMARY.md`, and
`TECHNICAL_ARCHITECTURE.md`, which remain the product-direction documents. Where this
document and those disagree, the amendments in "Document amendments" below are the
resolution.

---

## 1. Starting position

AISAR today is a complete-looking product with almost no backend.

| Layer | Reality |
|---|---|
| Product docs | Strong. Architecture, phases, and acceptance criteria already specified |
| `app/` (React) | Everything in `localStorage`, 14 keys. Ask AISAR is a regex switch over canned strings. Connectors are mocks |
| `worker/` | ~230 lines. Real risk gate, approval queue in D1, audit log. **No authentication** — `business` is caller-supplied, so any caller can read or approve another tenant's queue |
| Static site | Second full copy of the product (`index/onboard/setup/app.html` + `biz-engine.js`), kept in sync by hand |
| Identity | Does not exist |
| Connectors | All ten stubbed `NOT_WIRED` |

Making this real is not one project. It is roughly seven subsystems plus a consolidation
step, sequenced below.

---

## 2. Decisions

Recorded with rationale so they can be revisited deliberately rather than by drift.

| Decision | Choice | Why |
|---|---|---|
| Objective | Build the durable platform | No external deadline; slices 2–7 should not require rework |
| Team | Solo, full-time | Scarce resource is attention, not money. Piece count matters; cheap tiers do not |
| Budget | Not the binding constraint | Correctness and iteration speed win over unit cost |
| Runtime shape | **Workers control plane; container tier added later** | Shape "C" from the options considered, grown from an "A"-shaped start. The Worker already exists and works |
| System of record | **Postgres (Neon, ap-southeast-1)** | Every "why did the agent do that?" investigation is a SQL session. Phase 4 procedure derivation is fundamentally an analytical query over run history |
| Durable execution | **None. Runs are rows advanced by a queue** | Approval can take days, so a run must already be a persisted state machine. Once that is true, a workflow engine adds machinery without adding capability |
| Model provider | **Claude via Cloudflare AI Gateway** | A wrong customer message is a real business incident. Gateway adds caching, spend caps, logging, and a fallback path without lock-in |
| Harness portability | **Adapter from day one, one implementation shipped** | `business.runtime` is a column. Adding OpenClaw later is a new file, not a refactor |
| Escape-hatch delivery | **Design for it, ship managed first** | The full escape hatch is the destination; the managed SMB loop ships first. `PRODUCT_VISION.md` positioning is untouched |
| Container tier (later) | **Fly Sprites, not Cloudflare Containers** | Agent harnesses are stateful by design. Sprites preserves the filesystem across dormancy; Containers would require building workspace rehydration for every harness |
| Auth | Email magic link | No password, no OAuth consent screen, works for any owner |
| Demo mode | Keep anonymous demo alongside real accounts | The `localStorage` demo is the current top-of-funnel. A `Repository` seam makes both cheap |
| Static site | Delete before slice 1 | Cannot integrate a backend against two implementations |
| Tenancy | Owner + staff seats, one business each | One join table now avoids a migration when the first customer adds their manager |
| Telegram connection | Guided BotFather walkthrough for slice 6 | Business connection is better but narrower and newer; the connector layer makes it a later addition, not a rewrite. See §8.4 |

### 2.1 The reconciliation on the escape hatch

Two answers given during design conflicted: "commit now to containers and multi-harness"
versus "harness selection is a maybe-later, not a commitment." The resolution adopted:

> Design for the full escape hatch. Sequence delivery so the managed experience ships
> first. The container substrate and multi-harness adapter are architected in from day
> one; the harness picker does not appear in the beginner UI; the vision document's
> positioning is unchanged.

---

## 3. Scope decomposition

Nine slices. Each independently shippable with its own plan. Order is forced by
dependency.

| # | Slice | Delivers | Why here |
|---|---|---|---|
| 0 | **Consolidation** | Delete static implementation and `parity-audit.mjs`. Apex to React build. Extract all `localStorage` access behind a `Repository` interface with one `LocalRepository` | One implementation before any backend. The `Repository` seam makes anonymous-demo-plus-accounts free later |
| 1 | **Identity & tenancy** | Postgres. `app_user`, `business`, `membership`, `session`, `login_token`. Magic link. Session-derived tenant. `RemoteRepository` and local→remote migration on signup | Everything below writes tenant-scoped rows. Also closes the open-approval-queue hole |
| 2 | **Business memory** | `business_fact` with source, confidence, confirmation, and versioned corrections. My Business reads and corrects server-side | Correction-versioning must exist before anything reasons off facts, or Phase 4 loses the invalidation trail |
| 3 | **Run spine** | `run`, `run_event`, `work_record`, `approval`. `RuntimeAdapter` with one implementation. Queue-advanced runs | The product's spine. Home and Activity are projections of it. Phase 4 has no other source |
| 4 | **Ingestion** | URL → fetch → extraction → candidate facts with source and confidence → review screen. Artifacts to R2 | Deliberately the first run type: real LLM, real events, real records, **zero external side effects** |
| 5 | **Grounded Ask AISAR** | Second run type. Retrieval over facts plus live work-record counts. Replaces the regex switch in `useAsk.ts` | Small once slices 2 and 3 exist. Still read-only |
| 6 | **Connector gateway + Telegram** | Credential vault, `connection` table, webhook ingest with verification, real sends | Third run type — first with an approval gate and a real external effect. Completes all six acceptance criteria |
| 7 | **Advanced mode** | `detail_level`. Technical trace, per-operation permissions, draft editing recorded as `owner.edited` | Draft editing must exist before there is run history worth mining |
| 8+ | **Escape hatch / Phases 3–4** | Sprites container tier behind the adapter, second harness, schedules, autonomy tiers, procedure derivation | Designed-for from slice 3; built when real demand exists |

**Effort, solo full-time:** S0 ~2d · S1 ~1w · S2 ~1w · S3 ~2w · S4 ~1w · S5 ~3d · S6 ~1.5w
· S7 ~1w → **approximately 8–9 weeks to full vertical-slice acceptance.** Slice 8 is
separate and open-ended.

**The existing `worker/` is extended into the control plane, not replaced.** Its risk gate,
approval semantics, and single-execution guarantee are proven code. Slices 1 and 3 add
authentication and move its storage from D1 to Postgres around them.

**Deliberately excluded:** no connector beyond Telegram until the whole loop is reliable
for one. This follows the existing non-goals list.

---

## 4. Data model

`business` is the tenant. Not an `org` with a business attached — the domain language and
the existing code both say business, and tenancy is one business per org.

### 4.1 Identity and tenancy

```sql
create table app_user (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null unique,
  name         text,
  detail_level text not null default 'beginner'
               check (detail_level in ('beginner','advanced')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table business (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  playbook_key text not null,
  country      text not null default 'MY',
  lang         text not null default 'en' check (lang in ('en','bm')),
  locality     text,
  runtime      text not null default 'aisar-native',
  created_at   timestamptz not null default now()
);

create table membership (
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  role        text not null check (role in ('owner','staff')),
  primary key (user_id, business_id)
);

create table session (
  id          text primary key,   -- SHA-256 of the cookie value, never the raw token
  user_id     uuid not null references app_user(id) on delete cascade,
  business_id uuid references business(id) on delete set null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table login_token (
  token_hash  text primary key,
  email       citext not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
```

`business.runtime` costs one column and is the difference between adding a harness later
and refactoring later.

### 4.2 Business memory

```sql
create table business_fact (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  key           text not null,          -- 'hours.monday', 'service.consult.price'
  value         jsonb not null,
  source        text not null check (source in ('owner','import','agent','connector')),
  source_ref    text,                   -- URL, R2 artifact id, or run id
  confidence    real not null default 1.0 check (confidence between 0 and 1),
  confirmed_by  uuid references app_user(id),
  confirmed_at  timestamptz,
  version       int not null default 1,
  live          boolean not null default true,
  superseded_at timestamptz,
  created_at    timestamptz not null default now()
);

create unique index business_fact_live
  on business_fact (business_id, key) where live;
```

A correction retires the old row first
(`update … set live=false, superseded_at=now() where business_id=? and key=? and live`)
then inserts at `version+1`. History is every row for that key.

The `live` boolean is deliberate rather than a `superseded_by` self-reference: a
self-reference requires the new row to exist before the old one can be retired, which
momentarily places two live rows under the partial unique index, and Postgres cannot
defer a partial unique *index*.

### 4.3 Runs, events, work records

```sql
create table run (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  kind          text not null,        -- 'ingest' | 'ask' | 'reply' | 'schedule'
  status        text not null default 'queued'
                check (status in ('queued','working','needs_approval',
                                  'completed','failed','cancelled')),
  trigger_shape text not null,        -- Phase 4 grouping key
  trigger_ref   jsonb,                -- channel, customer, source message id
  requested_by  uuid references app_user(id),
  runtime       text not null,        -- snapshot at start, not a live lookup
  model         text,                 -- snapshot
  parent_run_id uuid references run(id),
  batch_key     text,
  started_at    timestamptz,
  ended_at      timestamptz,
  cost_cents    integer,
  attempt       int not null default 0,
  created_at    timestamptz not null default now()
);

create table run_event (
  id          bigserial primary key,
  run_id      uuid not null references run(id) on delete cascade,
  business_id uuid not null references business(id) on delete cascade,
  seq         int  not null,
  type        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);
-- append-only: a trigger raises on UPDATE and DELETE
```

Event vocabulary:
`work.requested` · `work.started` · `fact.retrieved` · `action.proposed` ·
`approval.requested` · `owner.edited` · `approval.granted` · `approval.rejected` ·
`action.executed` · `work.completed` · `work.failed` · `outcome.observed`

```sql
create table work_record (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references business(id) on delete cascade,
  run_id          uuid references run(id),
  batch_key       text,                          -- set ⇒ summarises many runs
  objective       text not null,
  outcome         text,
  status          text not null,
  function        text,
  channel         text,
  subject         text,
  risk            text check (risk in ('low','medium','high')),
  approval_id     uuid,
  counters        jsonb not null default '{}',
  minutes_saved   integer,
  cost_cents      integer,
  artifacts       jsonb not null default '[]',
  decision        text,                          -- comparable across runs
  inputs_used     jsonb,                         -- fact ids and connector reads relied on
  outcome_quality text check (outcome_quality in ('unknown','good','poor')),
  quality_at      timestamptz,
  occurred_at     timestamptz not null,
  updated_at      timestamptz not null default now()
);
```

`work_record` is a **materialised** projection, not a view. Grouping is time-windowed and
Home/Activity are the hottest reads. Events remain the truth, so the table is entirely
rebuildable by replay — which matters because `trigger_shape` and `decision` are
taxonomies being guessed at before any real run exists. When the taxonomy proves wrong,
recompute rather than lose history.

### 4.4 Approvals

```sql
create table approval (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  run_id        uuid not null references run(id) on delete cascade,
  connector     text not null,
  op            text not null,
  args          jsonb not null,        -- exactly what will execute
  args_original jsonb,                 -- what AISAR proposed, when the owner edited
  risk          text not null check (risk in ('low','medium','high')),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected',
                                  'executed','failed','expired')),
  expires_at    timestamptz,
  decided_by    uuid references app_user(id),
  decided_at    timestamptz,
  result        jsonb,
  created_at    timestamptz not null default now()
);
```

`args_original` beside `args` captures the owner-edit delta that
`TECHNICAL_ARCHITECTURE.md` calls "the strongest signal available, and the easiest to
lose." Two columns and an `owner.edited` event make it unlosable.

The single-execution guarantee ports directly from the current D1 implementation —
conditional `update … where id=? and status='pending'`, check rows affected. That property
is already proven; it is re-proven after migration, not redesigned.

### 4.5 Connections, credentials, policy

```sql
create table connection (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references business(id) on delete cascade,
  connector    text not null,
  method       text not null,          -- 'bot_token' | 'business_connection' | 'oauth'
  status       text not null check (status in ('connected','expired','revoked','error')),
  external_id  text, display_name text, scopes text[],
  connected_by uuid references app_user(id),
  connected_at timestamptz, last_ok_at timestamptz,
  unique (business_id, connector, external_id)
);

create table credential (
  connection_id uuid primary key references connection(id) on delete cascade,
  ciphertext    bytea not null,        -- AES-GCM
  key_version   int not null,
  expires_at    timestamptz, refreshed_at timestamptz
);

create table action_policy (
  business_id uuid not null references business(id) on delete cascade,
  op          text not null,
  policy      text not null check (policy in ('automatic','approval','blocked')),
  updated_by  uuid references app_user(id),
  updated_at  timestamptz not null default now(),
  primary key (business_id, op)
);
```

`connection.method` is what makes the Telegram decision reversible — see §8.4.

### 4.6 Isolation

Every table carries `business_id`, including the denormalised copy on `run_event`. On top
of the data-access layer, Postgres row-level security with `set local app.business_id`
inside each transaction. Defence in depth: a data-access layer is one forgotten `where`
clause away from the bug the current `worker/README.md` already documents.

**Hyperdrive caveat:** connections are pooled, so the GUC must be set per transaction,
never per connection. This is a slice 1 acceptance test, not a note.

### 4.7 What retires

D1 and `worker/schema.sql`, after slice 3 migrates the approval queue.

`localStorage` keys map cleanly: `aisar-approvals` → `approval`, `aisar-work-done:*` →
`work_record`, `aisar-conns` → `connection`, `aisar-permissions` → `action_policy`,
`aisar-learn:*` folds into Phase 4 signals. `LocalRepository` keeps the existing shapes
for the anonymous demo.

---

## 5. The five abstractions

| Abstraction | Side | Contract | Implementations |
|---|---|---|---|
| `Repository` | frontend | All persistence. No component touches `localStorage` or `fetch` directly | `Local` (anonymous) · `Remote` (authenticated) |
| `RuntimeAdapter` | backend | `startRun` · `resumeRun` · `cancelRun` · `streamEvents` | `aisar-native` now · `sprites` later |
| `ConnectorGateway` | backend | Stable ops → provider calls. Owns OAuth, refresh, rate limits, retries, idempotency | `telegram` first |
| `PolicyEngine` | backend | `(business, op, args) → automatic \| approval \| blocked` | one |
| `Projector` | backend | `run_event[] → work_record`. Pure, replayable, no side effects | one |

Only `Repository` and `RuntimeAdapter` have more than one implementation. The rest are
boundaries for testability and file size, not for pluggability that is not needed.

---

## 6. Run lifecycle

### 6.1 The shape

A run is a row. Each tick is: load state → perform one step → persist → optionally enqueue
the next tick. There is no long-lived process. This is what makes a run survivable in
Workers and resumable after a two-day approval wait.

Statuses: `queued` → `working` → (`needs_approval`) → `completed` | `failed` | `cancelled`

### 6.2 Worked example — an inbound customer enquiry

1. **Webhook.** Telegram posts an update. AISAR verifies the secret token, writes
   `work.requested`, enqueues, and returns 200 immediately. No reasoning happens in the
   webhook path.
2. **Pickup.** A queue consumer claims the run, writes `work.started`.
3. **Classify.** Haiku 4.5 determines intent. Roughly $0.0015.
4. **Retrieve.** Relevant `business_fact` rows are loaded. `fact.retrieved` records the
   exact fact ids used — this is what lets a later correction invalidate the runs that
   depended on the old value.
5. **Draft.** Claude produces the reply. `action.proposed` stores the exact args.
6. **Policy.** `send` requires approval. An `approval` row is created, run status becomes
   `needs_approval`, `approval.requested` is written, and the run **stops**. Nothing is
   enqueued. Nothing is running. Cost while waiting is zero.
7. **Decision.** The owner approves, rejects, or edits. An edit writes `owner.edited` with
   both versions. Approval writes `approval.granted` and enqueues a resume.
8. **Execute.** The gateway sends, carrying the approval id as the idempotency key.
   `action.executed` records the provider reference.
9. **Project.** The projector turns the event list into a `work_record`. `work.completed`.
10. **Outcome, later.** A scheduled sweep 24–72h afterwards checks whether the customer
    replied, whether a booking held, whether the owner intervened. Writes
    `outcome.observed` and stamps `work_record.outcome_quality`.

Step 10 is routinely omitted from systems like this. It is also the only signal that
distinguishes "AISAR did something quickly" from "AISAR did the right thing," and Phase 4
cannot be built without it.

### 6.3 The five invariants

**Replay is harmless.** Queues deliver at-least-once. Before acting, each step checks
whether its own event is already written. The append-only event log doubles as the
idempotency ledger — no separate mechanism.

**Waiting is free.** A run awaiting approval consumes nothing. This is precisely why no
durable-execution framework is needed: the condition that would justify one (long waits)
already forces the state into the database.

**Approvals expire.** `approval.expires_at` is set at creation. A daily sweep marks stale
rows `expired` and cancels the run. A customer reply approved five days late is worse than
one never sent.

**Failure is visible.** Retries use exponential backoff up to a bounded `attempt` count,
then `work.failed`, and the record surfaces in Activity as needing attention. Nothing is
silently dropped — an owner who cannot trust that would have to read every transcript,
which defeats the product.

**Nothing is mutated.** `run_event` is append-only, enforced by a database trigger rather
than convention.

---

## 7. Policy engine

Three outcomes, resolved in order:

1. Is the connector connected? If not, nothing is possible — surface a connect prompt.
2. Is there a business-specific `action_policy` row for this op? Use it.
3. Otherwise apply the default risk table.

| Risk | Ops | Default |
|---|---|---|
| low | `read` `list` `export` | automatic |
| medium | `update` `book` | approval |
| high | `send` `cancel` | approval |
| **blocked by default** | `pay` `refund` | **blocked until explicitly enabled** |

### 7.1 Three deliberate properties

**Risk comes from the operation, not the caller.** AISAR proposing a send and an owner
instructing a send carry the same risk. The existing Worker already gets this right.

**The server governs; the client predicts.** The app keeps a copy of the table so it can
warn "this will need your approval" before the click. That copy is a convenience. If the
two disagree, the server's decision stands.

**Arguments can escalate risk.** A `send` to one customer who just messaged is routine; a
`send` to 500 recipients is a different act. Even where an owner has marked an op
automatic, hard guards force approval:

- more than a small number of recipients in one action
- any monetary amount above a per-business threshold
- a recipient the business has never contacted before

Without these, enabling automatic replies is one defect away from a mass-messaging
incident.

### 7.2 Correction to existing code

`worker/src/index.ts` currently classifies `pay` and `refund` as high risk, which routes
them to approval. `TECHNICAL_ARCHITECTURE.md` specifies that payments and destructive
operations are **blocked until explicitly enabled**. The documents are right — approval
fatigue is real, and enabling payments should be a deliberate act, not a tired tap. The
code changes to match.

---

## 8. Connectors and credentials

### 8.1 Division of responsibility

The run says "send this message to this person." It knows nothing about tokens, rate
limits, retries, or any provider's API shape. The `ConnectorGateway` owns all of that.
This is what makes WhatsApp later a new file rather than changes scattered through the
run engine.

### 8.2 Credential rules

- Never returned to the browser. Not for display, not for debugging, not once.
- Encrypted at rest (AES-GCM) with a key held as a Worker secret and **versioned**, so
  rotation is possible without downtime.
- Refresh is the gateway's job, not the run's.
- A broken connection is marked `error` and surfaced plainly: "Telegram needs
  reconnecting."

### 8.3 Execution idempotency

If a send succeeds and the subsequent write fails, the retry must not send twice. Every
execute call carries the approval id as an idempotency key, and the connector either uses
the provider's idempotency support or checks before sending. A customer receiving the same
reply twice is the kind of defect that gets AISAR switched off.

### 8.4 Telegram — decision and reversibility

Two viable paths were researched:

| Path | Owner experience | Trade-offs |
|---|---|---|
| **BotFather bot per business** (chosen for slice 6) | Guided walkthrough; owner pastes a token once | Violates "no API keys" as written. Full bot control, well-documented, easy to develop and test. Customers message a bot the business can advertise |
| **Business connection** (later) | Owner types `@AisarBot` into Telegram Settings → Telegram Business → Chatbots. No token | **Does not require Telegram Premium** — confirmed in Telegram's docs. Replies come from the owner's own account, so identity is correct. But only one business bot may connect per account, it only covers chats the owner already has, and the API surface is narrower (`invokeWithBusinessConnection`, restricted method list) |

**Chosen: BotFather for slice 6.** For the first pilot customers, onboarding is hands-on
anyway; pasting a token once is not the friction that matters. The "no API keys" promise
matters at customer fifty, not customer one.

**This is reversible by construction.** `connection.method` records which path a business
used. Because all provider specifics sit behind the gateway, adding the business-connection
path later is a second method inside one file — no change to the run engine, the approval
flow, or the records.

### 8.5 Webhook rules

- Verify the provider's secret token on every inbound request.
- Respond fast: record, enqueue, return 200. No reasoning in the webhook path.
- Treat duplicate deliveries as normal; deduplicate on the provider's message id.

---

## 9. Cost model

Verified against live pricing on 2026-08-20.

### 9.1 Unit costs

| Run type | Model | In | Out (incl. thinking) | Cost |
|---|---|---|---|---|
| Customer reply draft | Opus 5 | 4.7K | 1.2K | $0.054 |
| Intent classification | Haiku 4.5 | 1K | 0.1K | $0.0015 |
| Owner ask | Opus 5 | 4.6K | 1.1K | $0.050 |
| Daily digest | Haiku 4.5, Batch | 8K | 0.8K | $0.006 |
| Website import | Opus 5 | 17K | 6K | $0.235 (one-off) |

Rates: Opus 5 $5/$25 per MTok · Sonnet 5 $3/$15 · Haiku 4.5 $1/$5 · Batch API −50%.

### 9.2 Per business per month

| Profile | Enquiries | Owner asks | All-Opus | Tiered |
|---|---|---|---|---|
| Light | 100 | 30 | $7 | $5 |
| Typical | 300 | 60 | $20 | $15 |
| Heavy | 1,000 | 100 | $60 | $40 |

Tiered = Sonnet 5 for routine replies, Opus 5 for escalations and imports, Haiku for
classification and digests.

### 9.3 Totals

| | Build | Pilot (5) | Early (50) | Scale (500) |
|---|---|---|---|---|
| Workers Paid | $5 | $5 | $5 | $15 |
| Neon Postgres | $0 | $19 | $44 | $207 |
| R2 · Pages · Hyperdrive · AI Gateway · Queues | $0 | $0 | $0 | $3 |
| Resend | $0 | $0 | $20 | $20 |
| Sentry | $0 | $0 | $26 | $26 |
| **Infrastructure** | **$5** | **$24** | **$95** | **$271** |
| Claude — production | $0 | $75 | $750 | $7,500 |
| Claude — dev and eval | $50–300 | $100 | $100 | $200 |
| **Total** | **$55–305** | **~$200** | **~$945** | **~$7,970** |

**LLM spend is 85–95% of the bill at any real scale.** Optimising Cloudflare here would be
optimising the wrong number by two orders of magnitude. Optimise tokens per enquiry.

### 9.4 Levers, largest first

1. **Model tiering** — 25–30%. Opus 5 only where a wrong word costs a customer.
2. **Batch API** — 50% off, and digests, weekly summaries, and all Phase 4 mining are
   non-latency-sensitive by definition.
3. **Effort tuning** — thinking dominates output tokens, and output is 5× input. Use
   `output_config: {effort: "low"}` for classification and routing.
4. **Prompt caching** — real but situational. The stable prefix caches cleanly, but only
   pays when a business's traffic clusters inside the cache window. Treat as upside, not
   budget.
5. **Per-business spend ceiling** — `run.cost_cents` exists for this. Without a monthly cap
   per business, one runaway loop is an unbounded liability.

### 9.5 Three cost facts worth remembering

- **Hyperdrive defeats Neon's scale-to-zero.** Pooling keeps compute warm. Budget a floor
  of ~0.25 CU always-on (~$19/mo) from slice 1 onward.
- **Opus 5 is excluded from Priority Tier.** No self-serve committed-throughput discount on
  the primary model.
- **Neon Scale tier buys features, not capacity.** Staying on Launch halves the
  500-business line from $376 to $207.

### 9.6 Pricing consequence

At roughly **$16/business/month all-in** — approximately $15 of Claude for a typical
business (§9.2, tiered) plus its share of infrastructure:

| Price | COGS | Verdict |
|---|---|---|
| RM 99 (~$22) | 73% | unviable |
| RM 199 (~$45) | 36% | workable |
| RM 299 (~$67) | 24% | healthy |
| RM 499 (~$112) | 14% | strong |

**Below approximately RM 199/month the LLM eats the business.** This is a pricing
constraint falling out of the architecture, and it is better known before the first sales
conversation than after.

### 9.7 Escape-hatch tier (slice 8)

The accepted first hosted-Hermes shape is one Fly Sprite per business, provisioned lazily
behind the AISAR control plane. It is a business runtime, not one runtime per login or per
agent name displayed in the UI.

At current pay-as-you-go rates, a representative business active for 30 hours/month at
0.2 average vCPU and 1 GB RAM costs approximately **$1.89/month** in Sprite compute and
storage. Cloudflare Containers are materially cheaper per active hour, but their disk is
currently ephemeral across sleep. A stopped-on-idle Singapore EC2 instance can approach
the Sprite cost after roughly 20–25 active hours/month, at the price of substantially more
lifecycle and recovery machinery.

**Cost is therefore not an argument against the first Sprite implementation.** Durable
filesystem semantics and engineering time are the deciding factors. Dormancy still
protects against idle, not busy-wait: polling, open connections, or active tasks can turn a
roughly $2 runtime into a roughly $44/month runtime under the representative model.
Per-tenant runtime caps are required, and `run.cost_cents` must count Sprite usage.

The deployment contract, security boundary, price model, and re-evaluation triggers are
recorded in
[`2026-08-26-hermes-sprites-runtime.md`](2026-08-26-hermes-sprites-runtime.md).

---

## 10. Testing approach

Three properties must be proven because they are the three that cause real harm.

**Tenant isolation.** Every endpoint, called with a session for business A while requesting
business B's resources, must refuse. Separately, a database-level test that sets the wrong
`app.business_id` GUC and confirms zero rows — proving RLS holds independently of
application code.

**Single execution.** Concurrent decide calls on one approval: exactly one success, one
409, and exactly one connector invocation. Proven today against D1; re-proven after the
Postgres migration.

**Step idempotency.** Redeliver a queue message and assert no duplicate events and no
duplicate sends.

Supporting coverage:

- **Projector purity** — a fixed event list produces a deterministic work record.
  Golden-file test. This is what makes replay safe.
- **Policy engine** — table-driven over (op, policy, args) → decision, including the
  escalation guards in §7.1.
- **Connector contract** — every connector tested against a fake provider; the real
  provider only in a manual smoke test.
- **Migration safety** — existing `localStorage` approvals and work-done indices survive
  the move to the server. The engine writes work-done indices as strings and the app reads
  either format; that tolerance must hold through the migration.

Layers: unit tests for the pure pieces (policy, projector, fact versioning); integration
tests for the Worker against a local Postgres; an end-to-end script covering the six
acceptance criteria against a preview deployment.

**Explicitly not unit-tested: the model's output quality.** That is an evaluation problem,
not a testing problem. A separate set of roughly 30 real enquiries with expected decision
categories is run manually before any model or prompt change.

---

## 11. Document amendments required

1. **`TECHNICAL_ARCHITECTURE.md`** — add a tiered-disclosure section defining beginner and
   advanced modes as levels of the existing Summary → Business details → Technical trace
   progression, not as a second UI. Narrow the "no agent builder" non-goal to state what
   advanced mode may expose.
2. **Acceptance criterion 2** — "connect Telegram without manually managing API keys"
   becomes a slice 8 goal rather than a slice 6 one, with the reasoning in §8.4 recorded.
3. **`worker/README.md`** — the risk table changes when `pay` and `refund` move to blocked
   by default.
4. **`CLAUDE.md`** — the "two implementations, mid-consolidation" section is deleted after
   slice 0, along with references to `scripts/parity-audit.mjs`.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| `trigger_shape` and `decision` taxonomies are guesses made before any real run exists | Events are the truth and `work_record` is rebuildable; recompute rather than lose history |
| Outcome-quality detection is genuinely hard — "did it work?" has no clean signal | Start with weak proxies (customer replied, owner did not intervene) and record them honestly as proxies. Do not let Phase 4 wait on a perfect signal |
| The 8–9 week estimate assumes uninterrupted focus | Pilot-customer support during slices 6–7 will consume time. Treat the estimate as sequencing, not a delivery date |
| Fly Sprites and Cloudflare Containers are both young products | Slice 8 is deferred; re-evaluate both when it arrives rather than committing now |
| Telegram's Business API surface is narrow and newer than the bot API | Slice 6 uses BotFather; `connection.method` keeps the other path open |
| Solo operator, no bus factor | This document exists partly for that reason |

---

## 13. Definition of done

The first production slice is complete when a non-technical owner can:

1. submit a business URL and confirm the extracted profile;
2. connect Telegram (via the guided walkthrough, per §8.4);
3. ask AISAR to respond to a realistic enquiry;
4. review, edit if wanted, and approve the exact outgoing message;
5. see successful delivery and a complete activity record; and
6. correct a business fact and have the next response use the correction.

The owner must understand what happened from Home and Activity without reading the Ask
AISAR or Telegram transcript. Expanding a record must still reveal the source message, the
approved action, the delivery result, and the technical trace.

Primary metric: **time to first useful work completed.**
