# Hermes Runtime on Fly Sprites

**Status:** accepted direction; implementation pending  
**Last price verification:** 2026-08-26  
**Decision owner:** AISAR

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
- an encrypted reference to the per-runtime Hermes API key; and
- creation, update, and deletion timestamps.

Set `business.runtime = 'hermes-sprite'` only after readiness succeeds. The existing
`aisar-native` value remains a valid adapter choice and fallback.

### Runtime adapter and run spine

Implement `startRun`, `resumeRun`, `cancelRun`, and `streamEvents` against Hermes' Runs
API. AISAR run ids map to Hermes run and session ids, but Hermes events are translated
into AISAR's own append-only event vocabulary.

The `run`, `run_event`, `work_record`, and approval lifecycle must exist before general
customer provisioning. A runtime without this spine can perform work that AISAR cannot
reliably resume, explain, approve, replay, or charge.

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

## Cost model

The following comparison uses pay-as-you-go public rates verified on 2026-08-26. It is a
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

## Rollout gates

Do not enable automatic customer provisioning until all are true:

- one manual `aisar-dev-smoke` Sprite passes Hermes install, run, sleep, wake, and restore;
- the runtime table and idempotent provisioner are deployed;
- the run/event spine and `RuntimeAdapter` are deployed;
- runtime keys are encrypted and never reach the browser;
- Hermes tools cannot bypass AISAR policy and approvals;
- per-business runtime and model spend ceilings exist;
- health reconciliation, upgrade, rollback, and deletion paths are tested; and
- one read-only AISAR run succeeds before any live connector is enabled.

