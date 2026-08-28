# Hermes Runtime on Fly Sprites

**Status:** ordinary Ask is inline; explicit durable Work is enabled for one production canary
**Last verification:** 2026-08-28
**Decision owner:** AISAR

## Implementation status — 2026-08-28

Implemented in the repository:

- an RLS-protected `agent_runtime` record with explicit lifecycle states, release,
  provider identity, readiness, failure, checkpoint, and separate encrypted runner and
  Hermes credentials;
- a provider-neutral `RuntimeProvider`, a deterministic `LocalRuntimeProvider`, and a
  Workers-compatible `FlySpriteProvider` using the official authenticated REST API;
- idempotent provider-resource creation that records failures but does not prematurely
  select Hermes for the business;
- a durable `runtime_task` table with deduplication, expiring leases, and a database
  guarantee of one leased task per business;
- a Cloudflare Queue producer/consumer contract that treats messages as wake-up signals
  and Postgres as task truth;
- an idempotent, version-pinned bootstrap protocol that writes the runner bundle and
  mode-0600 credential transfer through the official Sprites filesystem API, proves
  authenticated runner/Hermes/browser readiness, and creates a baseline checkpoint;
- an owner-only provisioning route guarded by provisioning, secure-transport,
  production-bootstrap, and business allow-list gates that all fail closed;
- durable Hermes run dispatch, polling, bounded result persistence, and delayed queue
  wake-ups without consuming the queue retry budget; successful polls do not increment
  attempts, remote identity is stored before the first poll, and terminal failure stops
  and meters an addressable Hermes run only after lease-owned exhaustion succeeds;
- an allow-list-gated durable Work producer and tenant-scoped status projection with
  atomic HTTP idempotency, hibernating-WebSocket lifecycle progress, polling recovery,
  shared grounding rules, safe failure responses, and separate fail-closed paid-run and
  stream-admission rate limits;
- contract, RLS, retry, duplicate-delivery, checkpoint, bootstrap, runner protocol,
  canary gate, and provider tests;
- an AISAR-owned Node runner with authenticated readiness, one-task concurrency,
  idempotent Hermes run creation, polling, cancellation, and persistent task identity;
  and
- a private `jentera` development Sprite with Hermes v0.20.5 pinned to release tag
  `v2026.8.19`, loopback-only Hermes, the runner on port 8080, verified headless
  Chromium, and known-good checkpoint `v6`; and
- native Hermes OpenRouter configuration pinned to HTTPS endpoint
  `https://openrouter.ai/api/v1` and exact model
  `deepseek/deepseek-v4-flash-0731`, with a successful real task and duplicate-delivery
  check through the production canary runner;
- Worker-compatible Sprite HTTP POST exec, exact-name reconciliation for both historical
  400 and current 409 conflict responses, and repair of partial Playwright installs on
  the Sprite Ubuntu 26.04 image using the reviewed Ubuntu 24.04 platform build; and
- pre-route API, authentication, and runtime-mutation burst limits that refuse before
  Neon or provider work, plus bounded request shape and body-size guards;
- signed five-minute business/task-scoped grants whose current capability set is
  deliberately empty, plus authenticated `toolMode: no-tools` and Fly edge-credential
  isolation attestations;
- an RLS-protected per-business budget and measured usage ledger, pre-compute reservations,
  a 15-minute per-run ceiling, and terminal exhaustion after five attempts;
- durable control-plane cancellation and implemented reconcile, upgrade, restore-recovery,
  rollback checkpoint, deletion, primary Queue, and DLQ recovery paths; and
- an idempotent Free-plan Cloudflare WAF deployment script that refuses to overwrite an
  unrelated existing rule; and
- per-runtime OpenRouter inference-key issuance through a control-plane-only management
  credential, with a $5 monthly hard limit, 90-day expiry, encrypted storage, seven-day
  rotation, durable old-key revocation retry, and deletion-time revocation.

The I Run Cafe canary Sprite `aisar-b-3602f62e8aec2e6174b3` is ready at release
`2026.08.28-4`, pinned for future reconciliation to bundle commit
`c1af6c7f68719b18ff7f45dadbf19327ecd64b2f`. Its authenticated readiness reports runner,
Hermes, `toolMode: no-tools`, and `edgeAuthorizationForwarded: false` healthy. The latter
settles the external security question: Fly stripped the organization bearer header
before the request reached tenant code. A signed-grant OpenRouter run completed with
`AISAR VRS OK.` and duplicate delivery returned the same Hermes run. Checkpoint `v2` was
created, a marker was written afterward, `v2` was restored, the marker disappeared, and
authenticated readiness still passed. This proves the canary's wake/restore path rather
than merely proving checkpoint creation.

After the shared key was revoked, a production Queue smoke used the same signed no-tools
path intended for the UI and completed with `AISAR PER-RUNTIME KEY OK.`. Healthy polls
left the task at attempt `0`; the ledger finalized 844 input tokens, 58 output tokens,
356,413 runtime milliseconds, and 58 micro-USD. This proves the dedicated model key,
Sprite wake, runner, Hermes, result projection, and metering together rather than merely
proving bootstrap.

After the Ask AISAR producer and polling UI were deployed, a second production proof used
the public authenticated `/api/runs/ask` route rather than a temporary queue producer or
direct runner call. Run `7b3eef5e-95cf-49f5-ad85-532d9641a334` completed through
`hermes-sprite` and returned a 144-character answer. The ledger finalized 1,426 input
tokens, 109 output tokens, and 99 micro-USD. One real transient dispatch failure was
recovered (`attempt = 1`), demonstrating that the failure-count invariant permits recovery
while healthy polling itself does not consume attempts.

The pinned Hermes audit now reports two linked high-severity findings rather than four:
`nanoid 3.3.17` beneath `postcss` in `sanitize-html` and `vite`. Release bootstrap applies
only the registry-verified `3.3.18` override and lock records, refuses upstream version
drift, and requires `npm audit --omit=dev --audit-level=high` to pass. The canary upgrade
reported zero production vulnerabilities.

Production migrations `014_runtime_task_execution.sql` and `015_runtime_safety.sql` were
applied transactionally and verified through both `neondb_owner` and the restricted
`aisar_app` role. A rollback-only probe confirmed forced RLS returns zero unscoped rows and
the exact tenant row when scoped. Worker version
`1fd1d9fe-3054-441a-8856-c2430b4ddb8b` carried provisioning plus durable Ask execution for
one business canary; version `74ae271a` superseded it the same morning with the execution
allow-list emptied, so Ask returned inline while provisioning stayed live. Worker version
`b2edd791-00d8-44e6-a890-b1f943b12ace` introduced the split and the `RunStream` Durable
Object migration; current version `8a20dca9-0069-46af-a578-f46230d33fe5` also collapses
duplicate progress states before broadcast. Pages deployment `958d6182` serves bundle
`index-De-GFrgZ.js` at `jentera.ai`.
Its Sprites credential is organization-scoped and dedicated. The canary now has a
separate OpenRouter inference key with a $5 monthly hard limit and 90-day expiry. Its old
$10 weekly shared bridge key was revoked and the shared Worker secret and allow-list were
removed. The key, customer prompts, and model results cross only HTTPS.

The API applies authentication, dual-key general burst, dual-key runtime-mutation, and
dual-key agent-run brakes before database/provider work. General limiter failure fails
open for health and ordinary reads, while both paid-operation limiters fail closed. Cloudflare
stable rule `aisar_dynamic_abuse_v1` is live and caps non-verified `/api` traffic at 100
requests per 10 seconds per IP/colo before Worker invocation. Cloudflare Free exposes Path
and Verified Bot in rate-limit expressions but not Host or Method, so `/api` path scoping
is the available zone-safe boundary and `OPTIONS` shares that outer ceiling.

The separate execution allow-list contains only the I Run Cafe production canary. It is
authority for the explicit Work action, not a global runtime switch: `runtimeFor()` remains
the inline adapter for ordinary Ask and ingestion. A ready compute resource is still not
authority to use connectors or tools: every grant has an empty operation set and the
runner attests `toolMode: no-tools`.

The allow-list first held the I Run Cafe canary for part of 28 August, was emptied after
four durable Ask runs measured 106s, 100s, 93s and 91s against roughly 1.5s inline, then
was restored only after the product split Ask from explicit Work. That history proved the
execution gate can change independently of provisioning; the current mode field means
restoring the canary no longer routes ordinary owner questions into Hermes.

Production Work run `423ee728-c692-427e-99f3-8d75bc4c2a49` then proved the new path. One
WebSocket observed `queued → waking → working → completed`; every frame had exactly
`version`, `seq`, `type`, and `at`. The final authenticated read returned a 242-character
answer and usage finalized 1,313 input tokens, 122 output tokens, 118,277 runtime
milliseconds, and 94 micro-USD. Consecutive duplicate states are now collapsed before
broadcast. The temporary verification session was deleted.

The product now makes this latency boundary explicit. Ask stays fast; Work opts into the
durable runtime and shows `queued`, `waking`, `working`, and `retrying` progress before a
terminal state. This is lifecycle streaming, not incremental model-token output. Keep
Telegram last, since a customer is waiting there and the inline path already serves it.

The pinned canary's authenticated `/v1/capabilities` response confirms
`run_events_sse`, `tool_progress_events`, `approval_events`, and real message streaming.
Its source emits `message.delta`, tool lifecycle, approval, reasoning, and terminal events.
AISAR must never persist or expose `reasoning.available`, token deltas, raw tool previews,
or the terminal transcript bundle. Deltas are ephemeral transport only; allow-listed
task/tool/todo/artifact lifecycle events may be translated into bounded structured AISAR
events. The durable context is the objective, status, approvals, checkpoints, artifacts,
usage and outcome—not the Hermes chat transcript.

Still gated and therefore intentionally unavailable to customers:

- incremental Hermes event translation and Hermes-native approval resume before any
  non-empty grant vocabulary is introduced;
- non-empty tool grants or wider business rollout.

Creating provider compute is not readiness, and readiness is not use. The canary's
`business.runtime` changed from `aisar-native` to `hermes-sprite` only after runner
installation, authenticated readiness, browser smoke, and a baseline checkpoint passed —
and its ordinary Ask traffic still runs inline. Execution is a separate code gate:
emptying `RUNTIME_EXECUTION_BUSINESS_IDS` disables only explicit Work without changing or
deleting the Sprite. That separation was exercised on 28 August, not merely designed.

## Decision

AISAR's first hosted Hermes runtime will use **one Fly Sprite per business**, behind the
AISAR `RuntimeAdapter` and control plane.

The isolation unit is a business, not an `app_user` and not every agent name displayed in
the product. Owners and staff share one business tenant, business memory, permissions,
connections, and audit history. Giving each staff member a separate runtime would split
that state and allow competing agents to act for the same business.

The first release uses one Hermes profile in each Sprite. Specialist Hermes profiles may
be added inside that same business Sprite later, with separate profile homes and API keys.
They remain an internal implementation detail behind the single AISAR identity.

## Why Sprites first

Hermes is stateful: its configuration, memory, skills, sessions, schedules, and local
state database live on its filesystem. Sprites preserve that filesystem while compute
pauses, resume quickly on demand, and bill compute only while active. This matches a
mostly-idle per-business agent without requiring AISAR to build workspace export,
rehydration, and crash-consistency machinery first.

Fly Sprites are not the cheapest raw compute. Cloudflare Containers are cheaper per active
hour, and EC2 can be cheaper for sustained or densely packed workloads. Sprites are the
current choice because they minimise **total delivery cost** while retaining a strong,
simple tenant boundary.

This is not permission for Hermes to act directly on external business systems. Hermes
proposes tool actions through AISAR. The AISAR policy engine, approval flow, connector
gateway, and append-only audit log remain authoritative.

## Deployment shape

```text
Owner or staff
      │
      ▼
AISAR Cloudflare Worker
  authentication and tenant resolution
      │
      ├── Neon: runtime mapping, runs, events, approvals
      ├── Cloudflare Queue: provision, run, resume, reconcile
      │
      ▼
RuntimeAdapter
      │
      ▼
One Fly Sprite per business
  └── Hermes gateway and persistent profile
      │
      ▼
AISAR tool gateway
  policy → approval → connector execution
```

The browser never calls Hermes directly. It calls the AISAR Worker, which derives the
business from the authenticated session and resolves the corresponding runtime.

## Control plane and runtime plane

The control plane is the product. Hermes is an execution engine and Fly supplies compute.
Neither owns the customer relationship or the durable business record.

The always-running, multi-tenant control plane owns:

- users, businesses, membership, authentication, and billing;
- business facts, agent configuration, permissions, and schedules;
- connector credentials and webhook routing;
- durable tasks, approvals, usage, and audit events;
- runtime placement, desired version, and lifecycle state; and
- the owner-facing projection of what happened.

The runtime plane owns only isolated execution-time concerns:

- the AISAR agent runner and Hermes process;
- terminal, browser, and local tool execution;
- a business-specific working directory and hot cache; and
- temporary files needed while a task is active.

Hermes is replaceable. Fly is replaceable. The database event history, business memory,
policies, connector records, and customer experience are not.

### Central connector ingress

Telegram, WhatsApp, Slack, email, calendars, webhooks, and schedules terminate centrally
at AISAR's connector gateway. A sleeping runtime must not hold a provider websocket or
poll an inbox.

```text
Provider webhook or schedule
          │
          ▼
AISAR connector gateway
  verify → identify business → deduplicate
          │
          ▼
Create durable run and enqueue
          │
          ▼
Wake the business runtime only when work exists
```

This is what makes “always available” compatible with “not always running.” The connector
gateway remains available while the business Sprite is cold.

## AISAR agent runner

The control plane should not depend directly on Hermes' process model. A small AISAR-owned
`agent-runner` daemon sits in front of it and is the only process the runtime adapter
targets.

The runner is responsible for:

- authenticating as exactly one business runtime with workload credentials;
- accepting one leased task at a time;
- starting, stopping, and health-checking the pinned Hermes process;
- translating AISAR tasks into Hermes runs and Hermes output into AISAR events;
- streaming bounded, secret-redacted logs while work is active;
- reporting runtime, browser, and token usage;
- managing workspace sync, checkpoints, and graceful shutdown; and
- reporting its runner, Hermes, browser, and skills versions.

Hermes listens only on loopback behind the runner. The runner exposes the narrow AISAR
protocol and rejects calls whose business, task lease, or capability grant does not match
its workload identity.

The first implementation may be a small TypeScript service to minimise initial piece
count. Move it to Go or Rust only if startup time, resident memory, or distribution
becomes material. The protocol is the durable abstraction; its implementation language
is not.

Today the runner invokes Hermes. The same contract may later invoke another harness
without changing queues, approvals, connectors, billing, or the frontend.

## Provider boundary

Keep infrastructure lifecycle separate from the task-level `RuntimeAdapter`:

```ts
interface RuntimeProvider {
  create(runtime: DesiredRuntime): Promise<ObservedRuntime>;
  wake(runtime: ObservedRuntime): Promise<void>;
  stop(runtime: ObservedRuntime): Promise<void>;
  status(runtime: ObservedRuntime): Promise<RuntimeStatus>;
  checkpoint(runtime: ObservedRuntime): Promise<string>;
  restore(runtime: ObservedRuntime, checkpoint: string): Promise<void>;
  destroy(runtime: ObservedRuntime): Promise<void>;
}
```

`FlySpriteProvider` is first. `LocalProvider` supports development and contract tests.
Hetzner, EC2, or another provider is added only when measurement justifies it. Provider
ids, regions, and machine ids live in `agent_runtime`; Fly-specific values do not spread
through product tables or routes.

`RuntimeProvider` manages compute. `RuntimeAdapter` manages agent work. Keeping them
separate prevents infrastructure migration from changing task semantics.

## Runtime lifecycle

Do not model lifecycle with an `is_running` boolean. Use explicit desired and observed
states:

```text
PROVISIONING → READY → COLD
                       │ task
                       ▼
                     WAKING → IDLE ⇄ BUSY
                                │
                                └── idle timeout → COLD

Side states: ERROR · UPGRADING · MIGRATING · DELETING
```

The provider may internally distinguish warm from cold. AISAR only promises whether the
runtime is ready to accept work, waking, active, or unavailable. Every transition is
idempotent and recorded; reconciliation compares desired state in Postgres with observed
provider and runner state.

## Provisioning contract

Provision lazily when the owner first puts AISAR to work or completes the runtime-requiring
part of onboarding. Do not create a Sprite merely because an account exists.

Provisioning is an idempotent queued operation:

1. Insert or claim one `agent_runtime` row for the business.
2. Create an opaque Sprite name such as `aisar-b-<hash>`; never use an email or business
   name.
3. Apply resource, privilege, and outbound-network policies.
4. Install a **pinned** Hermes release with a versioned bootstrap script.
5. Configure one business-specific Hermes profile, model access, AISAR instructions, and
   a unique API key.
6. Register the Hermes gateway as a Sprite service on port 8642.
7. Verify liveness and authenticated detailed readiness.
8. Create a baseline checkpoint.
9. Mark the runtime ready, or record a recoverable failure for reconciliation.

The provisioner must tolerate every partial state: database row without Sprite, Sprite
without Hermes, Hermes without a service, service without readiness, and a ready Sprite
whose database update failed.

## Required control-plane work

### Runtime record

Add an RLS-protected `agent_runtime` table with at least:

- `business_id` as its unique tenant owner;
- provider, Sprite id/name/URL, and lifecycle status;
- desired and observed Hermes versions;
- last readiness time and bounded failure detail;
- latest known-good checkpoint id;
- encrypted per-runtime runner and Hermes API credentials; and
- creation, update, and deletion timestamps.

Set `business.runtime = 'hermes-sprite'` only after readiness succeeds. The existing
`aisar-native` value remains a valid adapter choice and fallback.

### Runtime adapter and run spine

**Amended 2026-08-26, after the seam was built.** The four methods below describe a runtime
that outlives its request. The inline runtime — which is what everything runs on today, and
the fallback for everything after — can implement `startRun` and would have to stub the
other three. An interface whose contract nothing satisfies, shaped by a runtime that does
not exist yet, is worse than a smaller one that is honest.

`src/runtime/types.ts` therefore names what actually varies between runtimes today:
`readPage` and `answerQuestion`, plus `id`, `model`, and `mode: 'inline' | 'durable'`.
`mode` is how a caller distinguishes the two once a durable runtime exists. The lifecycle
methods arrive with the first implementation that needs them, and the contract test in
`test/runtime.test.ts` is where a new adapter proves it satisfies both halves.

One rule the seam adds that this document did not state: an adapter reads and reasons, and
never writes AISAR data or sends anything. The control plane decides what to persist and
what needs approval. A runtime able to act directly would be a runtime able to bypass the
approval gate, which would make every guarantee in section 9 unenforceable.

When Hermes lands, implement `startRun`, `resumeRun`, `cancelRun`, and `streamEvents`
against its Runs API alongside the existing methods. AISAR run ids map to Hermes run and
session ids, but Hermes events are translated into AISAR's own append-only event
vocabulary.

The `run`, `run_event`, `work_record`, and approval lifecycle must exist before general
customer provisioning. A runtime without this spine can perform work that AISAR cannot
reliably resume, explain, approve, replay, or charge.

### Durable task invariants

Every external event creates a durable run before compute is requested. The request path
never waits for Hermes to finish.

```text
event → persist run → enqueue → acquire runtime → lease task → execute → persist result
```

V1 permits **one active task per business runtime**. Additional work stays ordered in the
business queue. This avoids workspace conflicts, competing browser sessions, memory
writes from two Hermes processes, and duplicate side effects. Parallel workers are a
future runtime capability, not a launch requirement.

Task delivery and queue messages are at-least-once. A task lease, event uniqueness, and
connector idempotency keys make replay harmless. Long approval waits consume no runtime:
the run becomes `needs_approval`, the lease ends, and approval enqueues a new resume step.

### Credentials and ingress

- Store the Sprites organisation token only as a Worker secret.
- Use one randomly generated Hermes API key per business runtime.
- Encrypt per-runtime keys with a Worker-held master key or managed secret vault.
- Disable browser CORS and never put runtime credentials in the frontend.
- Prefer a private Sprites proxy/tunnel. If a public Sprite URL is used temporarily, it
  must still require the Hermes key and must not be treated as the final trust boundary.
- Give Hermes short-lived, run-scoped AISAR tool credentials rather than provider master
  secrets.

Hermes' API can invoke terminal and other powerful tools. Compromise of its API key is a
runtime compromise, not merely access to a chat transcript.

### Tool and connector boundary

Hermes may retrieve business facts and propose stable AISAR operations. It may not call a
write-capable provider API around the policy engine. Every material side effect therefore
flows through:

```text
Hermes proposal → AISAR tool gateway → policy → approval if required → connector
```

Provider credentials stay in AISAR's vault or in a connector system with a policy that
cannot bypass AISAR approval. Connector calls carry AISAR approval ids as idempotency
keys.

### Storage and recovery

The Sprite filesystem is persistent working state, but it is not the sole source of
truth. Data ownership is split deliberately:

| Store | Owns |
|---|---|
| Neon Postgres | identities, businesses, facts, tasks, events, approvals, settings, usage ledger |
| R2 | documents, attachments, exports, large artifacts, workspace recovery bundles |
| Sprite filesystem | Hermes profile, browser profile, working files, caches, checked-out repositories |
| Sprite checkpoints | fast operational rollback of a known runtime version |

At bounded task-completion or upgrade points, while the Sprite is already active, the
runner emits a versioned recovery bundle to R2 and records its hash and source checkpoint
in Postgres. A backup schedule must not wake an otherwise cold fleet. Checkpoints make
same-provider rollback fast; R2 recovery keeps the business portable if a Sprite is lost
or AISAR moves providers. No irreplaceable customer state may exist only inside a runtime
disk.

### Versioning and rollout

Record one immutable runtime release such as `2026.08.26-1`, containing compatible
versions of the runner, Hermes, Python, browser, Playwright, common skills, and bootstrap
logic. Customer data and secrets are never baked into the release.

Roll out through a development runtime, an internal canary group, a small production
percentage, then the fleet. Create a checkpoint before upgrade, run readiness and harmless
task probes afterwards, and automatically restore or replace a runtime that fails.

### Telemetry and usage ledger

The runner emits structured events only while awake: task and tool lifecycle, active
heartbeat, runtime resource samples, versions, and bounded logs. Use OpenTelemetry
semantics where practical, while keeping the append-only AISAR run event log as the
business source of truth.

Do **not** heartbeat every cold runtime. A permanent heartbeat would wake the fleet and
destroy the scale-to-zero economics. Silence is the expected state for a cold Sprite;
provider status plus the last successful readiness check represents it centrally.

Meter usage independently of provider invoices:

- runtime active milliseconds and CPU time;
- peak and sampled memory;
- browser active milliseconds;
- model input, output, and cached tokens;
- hot and durable storage byte-hours; and
- connector operations and external references.

Every usage entry carries `business_id`, `run_id`, type, quantity, unit, timestamp, and a
deduplication key. Provider invoices reconcile the ledger; they do not replace it.

## Cost model

The following comparison uses pay-as-you-go public rates rechecked on 2026-08-28. It is a
planning model, not an invoice forecast. It excludes model tokens, taxes, observability,
request charges, and platform-specific network extras.

### Assumptions

- 100 businesses;
- 30 active runtime hours per business per month;
- 0.2 vCPU average and 1 GB RAM while active;
- 3 GB active working data and about 5 GB durable state for Sprites;
- a Cloudflare `basic` container with 1 GiB RAM and 4 GB disk; and
- one Singapore `t4g.small` plus a 10 GB gp3 root volume per EC2 business.

| Platform shape | Approximate monthly total | What the number omits |
|---|---:|---|
| Fly Sprites, sleeping when idle | **$189** | Plan discounts; model usage |
| Cloudflare Containers | **$78** | Durable state store and rehydration engineering; Durable Objects, requests, and logs |
| EC2, stopped outside the 30 active hours | **$160** | Start/stop orchestration, boot latency, networking, monitoring, and backups |
| EC2, always running | **$1,644** | Networking, monitoring, and backups |

### Fly Sprites

Current public rates:

- $0.07 per CPU-hour, measured from actual CPU usage;
- $0.04375 per GB-hour of actual memory;
- $0.000683 per active hot-storage GB-hour;
- $0.000027 per durable cold-storage GB-hour; and
- no metered bandwidth at the time of verification.

Under the assumptions above, one business is approximately **$1.89/month**. A five-hour
light user is approximately **$0.40/month**. The same runtime accidentally kept awake all
month is approximately **$44/month**.

An open TCP connection, output-producing session, active task, or polling loop can prevent
dormancy. Runtime services are acceptable because a quiet service does not itself hold a
Sprite awake. AISAR must use queue-triggered work and bounded health checks, not permanent
polling connections.

Source: <https://fly.io/sprites/>

### Cloudflare Containers

Current rates are $0.072 per actual vCPU-hour, $0.009 per provisioned GiB-hour, and
$0.000252 per provisioned disk GB-hour, with small allowances in the $5 Workers Paid plan.
This makes raw active compute roughly two to two-and-a-half times cheaper than the Sprite
model above.

The blocker is persistence, not compute price. As of the verification date, a Cloudflare
Container receives a fresh disk after sleep or platform restart. Hermes state would have
to be continuously externalised to R2 or another store and restored on wake. Snapshots are
documented as forthcoming, not available. Re-evaluate Containers when durable filesystem
snapshots are generally available and their recovery semantics have been tested.

Sources: <https://developers.cloudflare.com/containers/pricing/> and
<https://developers.cloudflare.com/containers/faq/#is-disk-persistent-what-happens-to-my-disk-when-my-container-sleeps>

### AWS EC2

The AWS Pricing API returned $0.0212/hour for an on-demand Linux `t4g.small` in Singapore
and $0.096/GB-month for gp3 storage, effective 2026-08-01. A 10 GB root disk therefore adds
$0.96/month.

- always on: about **$16.44/business/month**;
- running for only 30 hours: about **$1.60/business/month**; and
- approximate Sprites-versus-stopped-EC2 break-even: **20–25 active hours/month**, before
  operational overhead.

The stopped-EC2 figure assumes AISAR builds and operates reliable wake routing, AMIs,
readiness checks, patching, EBS recovery, and failure handling. A shared EC2 fleet becomes
the likely raw-cost winner at sustained scale, but loses the simple one-VM-per-business
boundary and adds scheduling and noisy-neighbour controls.

Sources: <https://aws.amazon.com/ec2/pricing/on-demand/> and
<https://aws.amazon.com/ebs/pricing/>

### Model cost

OpenRouter's live model catalog on 2026-08-28 reports the pinned
`deepseek/deepseek-v4-flash-0731` endpoint at **$0.06/M input tokens** and **$0.12/M
output tokens**, with a 1,310,720-token context window, tool calling, and no announced
expiration. OpenRouter's marketing comparison page showed a lower rate at the same time,
so operational estimates use the API catalog returned to clients rather than the
comparison page.

The production canary's 18,045-input/11-output verification consumed $0.000968077 as
reported by the key metadata endpoint, including any provider-side cache pricing. Model
cost is currently tiny relative to bootstrap compute, but unbounded agent loops remain a
larger financial risk than a single inference. The existing canary key is capped at $10
per week and expires on 2026-09-03; fleet rollout needs separate capped keys and a durable
per-business usage ledger.

Sources: <https://openrouter.ai/docs/api/api-reference/models/get-models>,
<https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key>, and
<https://openrouter.ai/docs/api/api-reference/api-keys/create-keys>

## Re-evaluation rules

Keep Sprites for the initial isolated-runtime rollout, then measure actual active CPU,
memory, storage, wake time, and model tokens for 30–60 days.

Reconsider the substrate when one of these becomes true:

- Cloudflare ships durable snapshots with tested restore and concurrency semantics;
- most active businesses exceed roughly 20–25 runtime hours every month;
- a sufficiently large fleet has predictable utilisation that justifies shared EC2/ECS
  scheduling;
- Sprites concurrency limits or regional availability become a product constraint; or
- runtime compute becomes material beside model spend.

LLM usage is expected to dominate COGS for normal businesses. Optimise model routing,
context size, caching, and runaway-run limits before optimising away approximately one
dollar of runtime cost per active business.

## Ten-thousand-runtime operating model

Ten thousand registered business runtimes must not imply ten thousand running servers.
Capacity follows active work:

```text
10,000 business runtime records and persistent workspaces
   600 active runtimes at a representative peak
 9,400 cold runtimes consuming storage but no compute
```

The control plane scales with incoming events, queued tasks, active runtimes, and event
writes. It does not fan out health polling, permanent connections, or scheduled processes
to every registered runtime.

At that scale, maintain quotas for concurrently active and warm Sprites, provisioning
rate, queue depth, wake latency, and work per business. Admission control must leave
capacity for interactive owner work instead of allowing a bulk schedule to wake the
entire fleet simultaneously.

Runtime-aware product tiers are a possible pricing lever, not yet a product decision:

- a cold, on-demand runtime with an included usage allowance;
- a faster or temporarily warm runtime with higher limits; and
- a dedicated high-duty runtime with concurrency and support commitments.

Plan names and prices require measured usage and customer research. The architecture
records the usage needed to price them without committing to `$29`, `$79`, or `$199`
before those measurements exist.

## Rollout gates

Do not expand provisioning or durable execution beyond the explicit canary until every
open item is complete.

Completed:

- development and production-canary Sprites pass pinned Hermes installation and a real
  no-tools model run;
- runtime table, idempotent provisioner, run/event spine, `RuntimeAdapter`, encrypted
  runtime keys, authenticated runner readiness, browser smoke, and baseline checkpoint
  are deployed; and
- one read-only OpenRouter run and duplicate-delivery proof succeeded without enabling a
  live connector path; and
- separate capped OpenRouter key issuance, encrypted storage, response attestation,
  rotation, durable revocation retry, and deletion cleanup pass integration tests; and
- the Ask AISAR UI keeps Ask inline and creates an idempotent, tenant-scoped durable run
  only for explicit Work; a secured hibernating WebSocket carries content-free lifecycle
  progress while every tool grant remains empty.

Open:

- add incremental event translation and Hermes-native approval resume before allowing
  non-empty tool grants; and
- run the canary long enough to measure cold-start latency, active runtime time, token use,
  and failure rate before widening `RUNTIME_EXECUTION_BUSINESS_IDS`.
