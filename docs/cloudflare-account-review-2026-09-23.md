# Cloudflare account review — 23 September 2026

Brief for the account-manager meeting. Everything here is read off
`worker/wrangler.toml`, `deploy.sh`, `app/public/_headers` and the incident
notes in `CLAUDE.md`; nothing is estimated. Dates are when we hit the thing,
not when it was fixed upstream.

## What Jentera is, in one paragraph

A managed AI-agent service for small businesses in Malaysia. An owner
describes an outcome in chat or Telegram; Jentera runs the work on an
isolated per-business computer, asks for approval before anything sensitive,
and hands back files. The control plane — identity, tenancy, policy,
approvals, audit, billing, connectors — is entirely Cloudflare. The agent's
computer is not, and that is the interesting part of this conversation.

## What we run on Cloudflare today

| Product | What it does for us |
|---|---|
| **Workers** | Three: `aisar-api` (the whole control plane, ~29 route modules), `aisar-vault` (credential custody, no public route), `aisar-vault-deposit` (a token lands here directly from the browser, cookies and referrer disabled, so the main Worker never sees it) |
| **Placement (regional)** | `[placement] region = "aws:ap-southeast-1"` on `aisar-api` — the region hint, not `mode = "smart"`. Our database is Neon in AWS Singapore; a tenant transaction costs ~60 ms placed and 1.1–2.3 s unplaced. This single line is worth more to us than any other config in the file |
| **Pages** | `aisar-jentera`, serving `jentera.ai` and `jentera.aisar.ai` from one deployment. React SPA, prerendered public pages, PWA |
| **Hyperdrive** | Connection pooling to Neon from Workers. Query caching deliberately **off** — see incidents |
| **R2** | `jentera-artifacts` — files the agent produces for the owner. Keyed `<business>/<run>/<artifact>/<name>`; every read resolves the row under RLS before touching the bucket |
| **Durable Objects** | `RunStream` (SQLite-backed). Live run progress to the browser over WebSocket — status lines, reasoning, streamed answer text |
| **Queues** | `aisar-runtime` + `aisar-runtime-dlq`. Durable wake-up signals for agent work. `max_batch_size = 1` deliberately, so one long streamed response cannot head-of-line block four other tenants. 8 retries then DLQ, which retries 20 more times over hours |
| **Workers AI** | `toMarkdown` on the `AI` binding — turns an uploaded PDF, Office doc or image into text for knowledge extraction. Chosen specifically because it needed no third-party key |
| **Rate Limiting bindings** | Six namespaces with different postures: auth burst 5/60s, general API 120/60s, agent run 10/60s, runtime mutation 3/60s (it can buy paid infrastructure), run stream 12/60s, runtime config 30/60s |
| **Analytics Engine** | `jentera_product` dataset — product events |
| **Workers Logs** | Invocation telemetry. Turned on after a 2026-09-03 stall we could not diagnose without it |
| **Cron Triggers** | Two: one-minute owner-routine dispatcher, quarter-hour fleet drift sweep |
| **Service bindings** | `SELF` (the queue consumer calls back into a *placed* invocation of the same Worker — see incidents) and `VAULT` (credential operations never leave Cloudflare's service boundary) |
| **Turnstile** | In front of the magic-link request, password signup and password login. Google sign-in is deliberately not behind it — Google already stands in front of that door |
| **WAF** | A rule at `api.jentera.ai` capping non-verified bot traffic before Worker invocation |

## What we deliberately run elsewhere

Worth being straight about this, because it is where Cloudflare could win
more of the stack — and where it currently cannot.

| Not on Cloudflare | Why |
|---|---|
| **Neon Postgres** (AWS Singapore) | We need real Postgres: forced row-level security, `SECURITY DEFINER` functions, transaction-local `set_config` for tenant scoping, advisory locks. D1 was the original design and was abandoned for exactly this. Hyperdrive is what makes the AWS-hosted choice workable |
| **Fly Sprites** — the agent computers | One persistent, isolated VM per business. Runs Hermes, a Node runner, Chromium, a desktop. Survives restarts through checkpoints, wakes on request, pauses when idle. **This is the largest workload we pay someone else for** |
| **Resend** | Transactional email with our own aligned DKIM/SPF/DMARC |
| **Stripe** | Billing |
| **DeepSeek direct** | Model inference, through a proxy we wrote ourselves |
| **Self-hosted Firecrawl** (a VPS) | Page extraction for the agent |

## What Cloudflare has genuinely bought us

Not marketing — things that would be materially harder elsewhere.

- **Regional placement solved a problem we could not solve ourselves.** Our
  data lives in Singapore for latency and residency reasons; our users are
  there too. The region hint turned a 1–2 s per-transaction penalty into 60 ms
  without moving anything.
- **Service bindings let us build a credential vault properly.** The vault
  has no public route at all. There is no URL to attack, no auth to get
  wrong, no egress. A token deposited by a browser reaches a separate Worker
  and the main control plane only ever holds an opaque id.
- **Queues plus Postgres leases gave us durable agent work cheaply.** We
  treat delivery as at-least-once and keep status and leases in Postgres, so
  a lost or duplicated message costs nothing. No broker to run.
- **Pages and Workers on one account meant one deploy story.** `deploy.sh`
  and `ship-runtime.sh` are the whole release surface for a product with
  five deployables.
- **Rate limiting before invocation.** The auth burst limiter refuses a
  flood before any database or email work, so an attack costs us nothing.

## Where it has cost us — raise these

These are real incidents with dates. They are the credibility of the whole
conversation, and several are things an account team can actually fix.

1. **Hyperdrive query caching is on by default and it broke our auth.**
   `verifySession`, `resolveTenant` and the password lookup all run outside
   a transaction, which makes them plain SELECTs, which made them cacheable
   for ~60 s. A logout did not take effect. A revoked session kept
   authenticating. It surfaced as a freshly verified account still being
   told it was unverified. **Ask: why is this the default, and can it be
   scoped per query rather than per config?**

2. **Queue consumers and cron do not get placement at all.** `[placement]`
   covers `fetch` only. Our consumer measured in LAX and SJC while the
   database is in Singapore — 1.1–2.3 s per tenant transaction. Our
   workaround is a `SELF` service binding: the consumer calls back into a
   *placed* invocation of the same Worker to do the actual work, 16–28 ms
   from Neon. That is a hack around a missing feature. **Ask: placement for
   queue consumers and scheduled handlers. This is our single biggest ask.**

3. **A request to our own public hostname from a Worker is not reliably
   routed** — error 522 from IAD. So the service binding was not an
   optimisation, it was the only thing that worked.

4. **`postgres.js` needed an undocumented-feeling compatibility flag.**
   Without `no_handle_cross_request_promise_resolution`, a socket created in
   one request and reused in another is cancelled — "Cannot perform I/O on
   behalf of a different request" — and webhook database lookups failed
   intermittently. **Ask: is this the sanctioned pattern for pooled TCP
   clients on Workers?**

5. **`wrangler deploy --domain` on the Worker silently disabled `workers_dev`
   and took our API offline** for the frontend still pointing at it.
   Wrangler defaults `workers_dev` to false as soon as any other route
   exists.

6. **`wrangler r2 object put` without `--remote` writes to a local
   simulator, prints "Upload complete." and exits 0.** Twelve uploads
   "succeeded" and the bucket never changed. Also: 315 MB cap per object,
   `r2 object info` does not exist in v4, and `r2 bucket info` lags several
   minutes behind verified writes so it cannot be used as a check.

7. **`wrangler tail` returns nothing on `aisar-api`.** We verify through
   Postgres or the response body instead. An empty tail is not evidence.

8. **Rate limiting binding ergonomics:** `period` accepts only `10` or `60`,
   and the field is `name`, not `binding` — both cost us a deploy cycle.

9. **Pages can serve SPA-fallback HTML in place of a real asset.** Our
   deploy script now fetches the served CSS and JS and fails loudly if they
   are HTML, because a deploy that looks successful and serves the wrong
   bytes is worse than one that fails.

## What to ask for

Roughly in order of what it is worth to us.

1. **Placement for queue consumers and cron triggers.** Ask for the
   roadmap, or a beta. Explain the `SELF`-binding workaround — it shows the
   need is real and already costing us an extra invocation per message.

2. **Cloudflare Containers / Sandboxes for the agent computers.** This is
   the strategic one. We pay Fly for one persistent isolated VM per
   business. Our actual requirements, so they can answer honestly:
   - persistent filesystem that survives restart, with **checkpoint and
     restore** (we roll back to a named checkpoint)
   - **wake on request** from paused, and pause when idle, because an idle
     business must not bill
   - **long-running** — a task can run for many minutes
   - **Chromium plus a desktop** inside the box
   - **per-tenant isolation** as a hard boundary, not a convention
   - regional placement in or near Singapore
   If Containers cannot do checkpoint/restore and wake-from-paused, say so
   early and it is not a fit yet — but ask when it will be.

3. **AI Gateway.** We wrote our own model proxy because we needed per-tenant
   budget enforcement and credential verification before forwarding to
   DeepSeek. Ask whether AI Gateway can enforce a **per-tenant spend cap**,
   whether it supports an arbitrary OpenAI-compatible upstream, and what its
   observability gives us that our own `model_call` table does not.

4. **Hyperdrive.** Read replicas or regional routing? Per-query cache
   control? And what the roadmap is for Postgres closer to Workers.

5. **Plan and pricing.** Ask what we are on, what the next tier changes, and
   specifically: Workers CPU time limits, subrequest limits, Durable Object
   pricing as run streaming grows, R2 egress as artifact volume grows,
   Queues concurrency above our current 20.

6. **Support tier.** For items 4, 6 and 7 above we had no one to ask. Worth
   knowing what a support relationship would actually get us.

7. **Workers AI in ap-southeast-1.** Which models are served from where, and
   what the latency looks like from a placed Worker in Singapore.

## Numbers to have ready

They will ask about scale. Pull these before you go — `./worker/scripts/stats.sh`
gives the first four:

- accounts, businesses, runs in the last 30 days, live connections
- how many agent computers are running — `./worker/scripts/fleet-verify.sh`
- Worker requests/day and Queue messages/day — Cloudflare dashboard
- R2 stored bytes and monthly egress
- current monthly Cloudflare spend, and current monthly Fly spend for
  comparison when Containers comes up

## One framing worth using

Cloudflare has the entire control plane of an AI-agent product that is
running in production today — auth, tenancy, policy, approvals, billing,
streaming, queueing, storage, the lot. What it does not have is the compute
the agent actually runs on, and that is the expensive half. The honest
reason is that the agent computer needs persistence, checkpoints and
wake-from-paused, and we found those at Fly first. That is a concrete,
winnable gap and they should hear it that way.
