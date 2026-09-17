# Jentera Computer: Sprites vs dedicated VMs

Recorded: 10 September 2026. E2B added as a third option 17 September 2026.
Status: retain Sprites as the current default; a dedicated-VM pilot is proposed,
not provisioned or approved for fleet migration; E2B is not recommended at
current scale and carries a dated revisit trigger.

## Recommendation

Keep one Fly Sprite per business for the current intermittent chat and task
workload. Evaluate an Alibaba 4 GB VM for sustained browser work, frequent human
takeover, or another measured requirement that justifies an always-on computer.
Do not switch the fleet based on the entry-level VM price alone.

**E2B is the third option and the answer is the same: not now.** It solves the
two things Fly cannot — a custom base image, and a resume that restores process
memory rather than restarting Hermes — but its $150/month floor costs roughly
4x what the fleet spends today, and it would replace the whole runtime layer.
See *E2B* below for the numbers and the revisit trigger.

The product principle remains **one company, one computer, many logical workers**.
It does not require a particular compute provider, a VM per worker, or a shared
multi-tenant browser pool. Specialist roles are a product capability to develop,
not something this comparison claims is already shipped.

This records the infrastructure comparison, not a change to customer pricing or
the agent runtime. Model-loop optimisation is a separate workstream in
[Runtime cost — measure the loop, then bound it](plans/2026-09-10-runtime-cost-optimization.md).

## What we already have

- The database permits one `agent_runtime` row per business through a unique
  `business_id`: [migration 012](../worker/migrations/012_agent_runtime.sql).
- Compute lifecycle is already separate from agent execution. `RuntimeProvider`
  exposes create, wake, stop, status, checkpoint, restore and destroy:
  [provider contract](../worker/src/runtime/provider.ts). A new provider still
  needs implementation, schema/type changes and contract verification; the
  interface does not make it a drop-in configuration change.
- The current hosted path uses Hermes behind the Jentera runner. Changing
  compute providers must not silently become a Hermes-to-ZeptoClaw migration.
- The configured keepalive grace is zero hours in
  [worker configuration](../worker/wrangler.toml). That setting alone does not
  prove how many hours the provider bills.

Sprites preserves the filesystem through idle periods. Warm suspension retains
process memory; a cold wake starts processes again, and network connections need
reconnection. Persistent browser profiles therefore do not inherently require
moving to Alibaba, but application login validity and recovery must be tested.
[Provider lifecycle documentation](https://docs.sprites.dev/concepts/lifecycle/).

### Dated observations, not a billing report

During the read-only comparison on 10 September 2026:

- The `aisar` organisation listed 13 Sprites: 12 business-named environments
  and one proof of concept. All 13 were cold at that instant.
- The API reported a running limit of 10 and a warm limit of 10. These are
  state/concurrency limits, not evidence of a ten-customer ceiling.
- A trailing-seven-day `runtime_usage` aggregate reported 69 tracked tasks
  across six businesses, 8.60 recorded task hours and $1.99 tracked model cost.

The cold snapshot does not establish historical duty cycle. Recorded task
duration is not provider-billed active time or cumulative CPU time. The model
cost field is not the Sprites bill. The organisation's subscription, remaining
allowances and actual invoice were not obtained, so **actual infrastructure
savings have not been established**. These figures are a dated observation,
not a recurring dashboard or a substitute for invoice reconciliation.

## Alibaba pricing supplied by the owner

Source: the Alibaba Cloud purchase-screen screenshot shared on 10 September
2026, labelled 9:22 AM. The visible specifications are transcribed below; the
temporary screenshot file is not a repository dependency.

| Monthly price shown | vCPU | RAM | Included disk | Assessment for Jentera |
|---|---:|---:|---:|---|
| $4 | 2 | 0.5 GiB | 20 GiB | Do not choose for the proposed full stack |
| $5 | 2 | 1 GiB | 30 GiB | Too little expected headroom for agent, Chromium and desktop |
| $8 | 2 | 2 GiB | 40 GiB | Candidate for a light-workload test after profiling |
| $16 | 2 | 4 GiB | 50 GiB | Recommended starting size for a full-stack pilot |

Every fully visible row also shows free transfer, bandwidth **up to** 200 Mbps
and one IPv4 address. These are displayed offer terms, not independently
verified sustained throughput or fleet entitlements. A partially visible $32
row is omitted because its specifications were not shown.

The RAM assessments are engineering judgements, not benchmark results. Average
memory alone is insufficient: measure peak usage and leave room for the OS,
browser subprocesses, downloads and recovery.

All calculations below **assume the dollar prices are USD**. Before purchase,
confirm currency, selected region, tax, renewal price, promotional eligibility,
purchase limits, account quota and capacity. The screenshot does not establish
these. Do not translate this into a guaranteed RM25–40 monthly 4 GB VM or claim
Malaysia hosting from this screenshot.

The earlier $8.50 4 GB comparison referred to a Tencent offer, **not Alibaba**.
It is not used in the calculations here. Re-quote either provider before a
purchase decision; offers and quotas are not interchangeable.

## Sprites cost model

Published usage rates checked on 10 September 2026:

| Resource | USD rate |
|---|---:|
| Actual CPU time | $0.07 / CPU-hour |
| Actual memory usage | $0.04375 / GB-hour |
| Hot storage | $0.000683 / GB-hour |
| Cold storage | $0.000027 / GB-hour |

Warm/cold states do not incur compute charges. Plans include resource allowances;
overages use the standard rates. An invoice, not the dashboard estimate, is the
billing authority. [Sprites pricing](https://fly.io/sprites/).

### Explicit illustrative assumptions

- A 30-day, 720-hour month.
- Average consumption while active: **0.2 CPU cores and 2 GB RAM**. These are
  scenario inputs, not measured Jentera fleet averages or allocated VM sizes.
- 5 GB hot storage during active hours, plus 10 GB durable cold storage for
  the full month. Hot and cold are separate billed components in this model.
- Alibaba stays subscribed at $16/month, including its displayed 50 GiB disk.
  Stopping that VM is not assumed to reduce the subscription charge.
- No Sprites plan fee, included allowance, trial credit or negotiated discount
  is applied. Both columns exclude tax, backup extras, model/API costs, shared
  control-plane costs and operational labour. This is not total customer COGS.

The Sprite scenario uses 10 GB of persistent data, not all 50 GiB included in
the Alibaba plan. Recalculate for the actual storage footprint. Likewise, a
4 GB fixed VM and a Sprite averaging 2 GB are not identical capacity guarantees:
the pilot must prove that the same workload fits the VM and completes reliably.

Let `H` be provider-billed active hours in a month:

```text
Sprite monthly USD
  = H × (0.2 × 0.07 + 2 × 0.04375 + 5 × 0.000683)
    + 10 × 720 × 0.000027
  = H × 0.104915 + 0.1944

Alibaba monthly USD = 16
```

| Average active time per day | Active hours/month | Sprite usage estimate | Alibaba 4 GB |
|---|---:|---:|---:|
| 30 minutes | 15 | $1.77 | $16.00 |
| 1 hour | 30 | $3.34 | $16.00 |
| 3 hours | 90 | $9.64 | $16.00 |
| 8 hours | 240 | $25.37 | $16.00 |
| 24 hours | 720 | $75.73 | $16.00 |

### Break-even and sensitivity

At the 2 GB average-memory assumption:

```text
H = (16 - 0.1944) / 0.104915
  = 150.7 active hours/month
  = about 5.0 active hours/day
```

At **4 GB average active memory**, holding the other assumptions constant, the
Sprite rate becomes $0.192415 per active hour. Break-even is 82.1 hours/month,
or about 2.7 hours/day. That is cost sensitivity only: a workload actually
averaging 4 GB may need an Alibaba machine larger than the 4 GiB plan once
peaks and headroom are considered.

More CPU, memory or storage makes Sprites more expensive in this model. Unused
plan allowances can make incremental Sprite usage cheaper and move break-even
later. Compare both marginal cost and the allocated subscription fee across
the fleet; do not count included usage as permanently free. A fixed VM becomes
attractive at sustained use, but neither threshold proves migration saves money
after operating costs or differences in throughput.

## E2B

Checked 17 September 2026 against E2B's own docs and pricing page.

### What it has that Sprites does not

**Custom templates from a Dockerfile.** `e2b template build`; first build 5-15
minutes, incremental rebuilds 1-3. Hermes and Chromium would be *in the image*,
so the 257 s of clone-and-download that dominates a cold provision
([`provisioning-time.md`](provisioning-time.md)) stops existing rather than
getting faster. Fly has said custom base images are not supported and are not
planned — "build up your base, then fork off of it" — and forking is still not
in the public API.

**Pause and resume that preserve memory, not just disk.** Both the filesystem
and the memory state are saved: running processes, loaded variables. Resume is
about a second; pausing costs roughly 4 s per GiB of RAM. A paused sandbox is
kept indefinitely — no TTL, no automatic deletion — and must be killed
explicitly.

That second property would remove a latency cost this repo has already
measured. Today a cold sprite wakes in 1-2 s and *then Hermes restarts*, which
is the 15-30 s an owner feels on the first message after a gap
([`reply-latency.md`](reply-latency.md)). A resume from a memory snapshot has
no restart to pay for.

### Rates

| | Sprites | E2B |
|---|---:|---:|
| CPU | $0.07 / CPU-hour | $0.0504 / vCPU-hour |
| Memory | $0.04375 / GB-hour | $0.0162 / GiB-hour |
| Storage | $0.000683 / GB-hour hot | included (20 GiB on Pro) |
| Subscription floor | none | **$150 / month (Pro)** |
| Concurrency | 100 since the Hero upgrade | 100 on Pro; 600 and 1,100 as add-ons |
| Maximum session | none | **24 hours on Pro** (1 hour on Hobby) |

On the same illustrative shape this document uses elsewhere — 0.2 CPU, 2 GB
RAM, 5 GB hot storage — a Sprite is **$0.104915** per active hour and E2B is
**$0.0425**. E2B's compute is about 2.5x cheaper per hour. The floor is what
decides it below scale.

### Against measured load

Production on 17 September 2026: **34 businesses, 30 users, 22 runtimes**, of
which **13 ran anything in the last 7 days** and 17 in the last 30. Those 13
produced 220 runs landing in 83 distinct business-hours — about **357 active
hours a month** fleet-wide.

| | Monthly |
|---|---:|
| Sprites, 357 active hours | **~$37.60** |
| E2B, 357 active hours | $15.17 usage + $150 floor = **~$165** |

Break-even against Sprites:

```text
0.104915 H = 150 + 0.0425 H
     H = 150 / 0.062415
       = about 2,400 active hours/month
```

At the current rate of roughly 27 active hours per active business per month,
that is **about 88 businesses actually using the product weekly** — not 88
signed up. Today's 13 active is a factor of 6.8 away, and the 21 dormant
businesses cost close to nothing on Sprites while they would sit behind E2B's
floor regardless.

Note the direction past that point: E2B's compute being 2.5x cheaper means it
gets *cheaper than Sprites* once the floor amortises, so this is a scale
threshold rather than a rejection.

### What migration would cost

The `RuntimeProvider` contract maps onto E2B reasonably — create, wake, stop,
status, checkpoint, restore and destroy have counterparts, with pause/resume
standing in for checkpoint/restore. Everything around it does not.
`bootstrap-runtime.sh`, the closed transfer-field allowlist it parses,
`ship-runtime.sh`, the pinned-bundle release model, checkpoint handling and
`fleet-verify.sh` are all shaped by Sprites. A template image replaces the
bootstrap rather than porting it — which is the point of moving, and also why
this is a rewrite of the runtime layer rather than a provider swap.

**Unverified, and it matters:** E2B's region control and data residency were
not confirmed. Fly gives ap-southeast-1. Under PDPA that is a question to
answer before a pilot, not after.

### Revisit trigger

Two conditions, either one:

1. Signups are visibly waiting on the 285-325 s cold provision.
2. Weekly-active businesses approach ~80.

Until then the useful thing E2B proves is that the template model works, which
is the argument for
[serving the bootstrap's bytes ourselves](plans/2026-09-17-prebuilt-bootstrap-bytes.md)
— the same idea without the migration.

Sources: [E2B persistence](https://docs.e2b.dev/sandbox/persistence),
[E2B pricing](https://e2b.dev/pricing), [E2B templates](https://docs.e2b.dev/sandbox-template).

## Proposed pilot and decision gate

No purchase or deployment is authorised by this document. If approved, start
with one Alibaba 2 vCPU / 4 GiB VM and an equivalent Sprite test environment.
Use test accounts and representative workflows before customer migration.

1. **Confirm the offer.** Record the region, currency, recurring price, quota,
   snapshot/backup limits, network terms and image/API support. Distinguish
   promotional purchase caps from account limits and available regional stock.
2. **Hold the workload constant.** Pin the same Hermes/runner release, model,
   tools and test cases. Exercise chat, browser work and idle/wake recovery.
   Do not mix a model/runtime replacement into a provider comparison.
3. **Measure at least seven representative days.** Record provider-billed CPU,
   memory, active time, storage, daily totals and peak RSS; task success rate,
   retries, response time and human interventions; and operator time. Reconcile
   with the billing export/invoice and project a full month. Extend the sample
   if it misses busy periods or month-end work.
4. **Prove recovery and access control.** Test browser-profile persistence,
   reboot, backup/restore, credential revocation and authenticated human
   takeover. Allow only one browser controller at a time. Stop automation before
   takeover and revalidate state before resuming. Cookies are credentials;
   revoking machine access does not revoke third-party sessions. A restored disk
   does not undo external actions, so retries need outcome reconciliation.
5. **Compare cost per successfully completed task.** Include compute, backups,
   model/API usage, failed attempts and maintenance. Compare within similar task
   types, not a mix where cheap chat hides costly browser jobs. Migrate only if
   equivalent reliability and security are demonstrated and savings or another
   explicit requirement justify the ongoing operational work.

Keep tenant identity, task history, approvals, schedules and model budgets in
the existing control plane. Do not replace the existing provider seam or move
always-available webhooks/scheduling into a sleeping computer. Do not expose
public CDP or unauthenticated remote desktop access to make the pilot easier.

The next evidence needed is **our actual Sprites billing and a matched workload
benchmark**, not a fleet purchase. Until then, retain Sprites; Alibaba remains
a candidate for sustained-use businesses. A Malaysia-hosted VM alone would not
establish Malaysia-only processing across models, databases, logs and backups.
