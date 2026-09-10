# Fleet configuration delivery — split what a sprite *is* from what it is *told*

Status: **proposed**. Prepared 10 September 2026 against `main` at 9489fbb
(the two incident fixes, c6ed3c1 and the extract-guard change, are in; the
fleet is mid-convergence on `2026.09.10-2`). Nothing here changes production
by being written down.

This is a sequencing document in the shape of
`2026-09-10-runtime-cost-optimization.md`: what to change, in what order, why
that order, what proves each step, and what each step does not do. Every
file, function and column named below was read in the code, not taken from
the incident summary; where the summary and the code disagree, the
"checked against the code" section says so.

## The problem, in one sentence

A sprite can only be *told* something by being *rebuilt*, so a one-key Hermes
config change is a fleet release, and a fleet release is twelve
re-bootstraps that each wake a paused machine, each fail independently, and —
because the bootstrap that parses the message may not be the one that
understands it — can refuse the very message meant to replace them.

## What the incident actually was, checked against the code

The summary is right about the shape and wrong in a few details that matter
for the fix.

- **The deadlock is real and is structural, but the mechanism is narrower
  than "a sprite runs the bootstrap from the release it is currently on".**
  Read the order in `bootstrapRuntime` (`worker/src/runtime/provision.ts`):
  the runner assets — including `bootstrap-runtime.sh` — are `curl`ed from
  the **new** `RUNTIME_BUNDLE_COMMIT` before the bootstrap is executed, so a
  control-plane upgrade runs the *new* bootstrap against the *new*
  transfer. What deadlocked 2026-09-10 is what c6ed3c1's message says:
  b151bb8 added `EXTRACT_BASE_B64` to `provision.ts` **without** adding it
  to the bootstrap's `case` allowlist, so the new bootstrap rejected the
  new field. (The "current release" model is exactly right for
  `runner/bin/upgrade-existing-sprite.sh`, which re-runs the on-disk
  bootstrap; the control-plane path is the one that matters.) The
  conclusion survives — a closed allowlist plus a control plane that sends
  fields unconditionally can reject the payload that carries the fix — but
  the true invariant is **the bootstrap and the transfer must agree at one
  bundle commit**, which is what `extract-endpoint.test.ts`'s last case now
  checks. The two-release rule is a safe over-approximation. Step 1 below
  makes it unnecessary rather than enforcing it harder.

  Two things follow, and the worktree commit 2e0c6f7 (`release-preflight`,
  not on `main` as of this writing) gets one of them right. Its **forward**
  check — every field `provision.ts` sends must be allowlisted by the
  bootstrap at the shipped bundle commit — is the check that would have
  caught b151bb8 and should land. Its **backward** check — the bootstrap at
  the *previous* pin must also accept the fields — encodes the on-disk
  bootstrap model and, taken literally, makes every new field cost two
  releases while guarding nothing on the control-plane path. The hazard it
  is reaching for is real but different: a **worker deploy without a
  release** — routine once this plan lands — ships a `provision.ts` newer
  than the `RUNTIME_BUNDLE_COMMIT` it is pinned to, and *that* bundle's
  bootstrap is the one every sprite will download. `extract-endpoint.test.ts`
  compares local files, which is only the same thing when the pin equals
  `main`, as it does at ship time and does not on a plain `wrangler deploy`.
  The accurate gate is forward-only and runs at deploy time as well as ship
  time, against the bootstrap at the pin in the `wrangler.toml` being
  deployed. Step 1 says how.
- **The scale was larger than 24 tasks.** `runtime_task` for the last three
  days (read-only, `stats.sh sql`, 2026-09-10): 102 `upgrade` tasks
  completed, **152 exhausted** at `attempt = 8`
  (`MAX_LIFECYCLE_TASK_ATTEMPTS`, `worker/src/runtime/consumer.ts`) with
  `last_error` "Sprite bootstrap exited 1: runtime bootstrap transfer
  contains an unknown field", one `failed` (`dead_owner_recovered`), four
  still `leased` at attempt 7. `agent_runtime` at the same moment: 9 of 12
  live runtimes on `2026.09.10-2`, three still on `2026.09.09-2` (statuses
  `cold`, `error`, `ready`). "0/12 after 11 minutes" was the deadlock
  window; the fleet is now converging, slowly, on the fix.
- **A successful upgrade costs 3.5–5.5 minutes of sprite time.** Completed
  upgrade tasks over the last two days aged 206–319 s from creation to
  completion (queue wait included, so the bootstrap itself is a little
  less). That is the unit the cost arithmetic uses.
- **An upgrade does not clone Hermes.** `bootstrap-runtime.sh` skips the
  installer when `git rev-parse HEAD` in `/home/sprite/.hermes/hermes-agent`
  already equals the pinned commit. What runs unconditionally on every
  upgrade: `patch-hermes-dependencies.mjs`, `npm install`, the patch
  `--verify`, `npm audit`, Playwright `install --with-deps chromium`,
  `uv pip install ddgs==9.16.0`, `pip check`, one model smoke per routed
  model, a web-search smoke, service recreation, the readiness wait, a
  browser smoke and a checkpoint. "N× network, N× failure probability" is
  right; "clone" is not.
- **`desired_release` is not a per-runtime target today.** `claimRuntime`
  (`worker/src/agent-runtime.ts`) does `on conflict (business_id) do update
  set desired_release = excluded.desired_release` with `env.RUNTIME_RELEASE`
  on every `ensureProviderRuntime`, and `runtime_drift_targets`
  (migrations 018/019) takes `p_current_release` from the same env. The
  column mirrors the environment. It is the right place for a per-ring
  target; it does not hold one yet.
- **`AISAR_RUNNER_KEY` is the wrong credential for the new direction, and
  the sprite already holds the right one.** The runner key is what the
  control plane presents *to* the sprite (`X-Aisar-Runner-Key`, checked by
  `sameSecret` in `runner/src/server.mjs`). It is a per-tenant random
  secret stored sealed in `agent_runtime.runner_key_ciphertext`, so
  verifying it *inbound* to the worker would need either a business id on
  the request — which `worker/src/tenancy.ts` forbids from body, query
  string **and header** — or a cross-tenant index keyed by a secret. But
  every sprite already carries `OPENROUTER_API_KEY = sk-jentera-v1.<payload>.<sig>`,
  minted by `deriveJenteraRuntimeCredential` (`openrouter-keys.ts`) from
  `AISAR_MODEL_KEY` and checked statelessly by `verifyJenteraKey`
  (`worker/src/fmcv-verifier.ts`) on every model call. Its payload carries
  `rid = runtimeName(businessId)`. That is a control-plane identity, already
  delivered, already rotated by the control secret. Section 1 uses it.
- **Bootstrap secrets are four, and one listed is not a secret.**
  `bootstrap-runtime.sh` writes `AISAR_RUNNER_KEY`, `HERMES_API_KEY` (also
  as `API_SERVER_KEY`), `OPENROUTER_API_KEY` and, when present,
  `FIRECRAWL_API_KEY`; `OPENROUTER_BASE_URL` and `FIRECRAWL_API_URL` are
  endpoints. `AISAR_EDGE_TOKEN` is written only when `EDGE_TOKEN_B64`
  arrives, and `provision.ts` never sends it — only the operator scripts
  do — so production runtimes are single-factor on the runner key plus
  Fly's edge auth. Not this plan's problem; noted so nobody designs around
  a factor that is not there.
- **Hermes re-reads its config per run; it does not re-read its
  environment.** Verified at the pinned commit
  `ff5b9fcfb029e230a2d3f90d1a3c06260ea1d413` (tag `v2026.9.8`):
  `_create_agent` (`gateway/platforms/api_server.py:1822`) calls
  `user_config = _load_gateway_config()` (`gateway/run.py:2568`) on every
  run, and that goes through `read_raw_config`, cached on the file's
  `(mtime_ns, size)` (`hermes_cli/config.py:236–250`). An atomically
  rewritten `~/.hermes/config.yaml` is seen by the **next run with no
  gateway restart**. But `${VAR}` references in that file —
  `api_key: ${OPENROUTER_API_KEY}` — resolve through `os.environ` only
  (`_env_expand_match`, `config.py:6710`), and `hermes-service.sh` exports
  `hermes.env` into the process with `set -a; source`. So **a credential
  Hermes references by `${VAR}` needs a gateway restart to change; a config
  key does not.** Firecrawl is a third case: `tools/web_tools.py` reads
  `FIRECRAWL_API_URL`/`FIRECRAWL_API_KEY` at call time through
  `get_env_value` (`config.py:8290`: `os.environ` first, then
  `~/.hermes/.env`, itself mtime-cached by `load_env`). Written to
  `~/.hermes/.env` and **not** exported into the process, those apply on the
  next tool call. Today's bootstrap exports them, which shadows the file;
  step 2 stops that.
- **The runner reads everything at start.** `configFromEnv` in
  `runner/src/server.mjs` snapshots `AISAR_MODEL_NAME`,
  `AISAR_DEEP_MODEL_NAME`, `AISAR_CANDIDATE_MODEL_NAMES` and the rest once;
  `taskProblem` checks a dispatched `model` against that snapshot. A
  routing change reaches the runner only by restart. The runner is our
  code, so it can reload in memory; Hermes cannot.
- **Sprites has no image primitive.** `POST /v1/sprites` takes `name`,
  `wait_for_capacity` and `url_settings` and nothing else
  (docs.sprites.dev, read 2026-09-10). A checkpoint is a per-sprite
  filesystem snapshot; restore "replaces the writable overlay with the
  saved state and restarts the environment" and is destructive; the docs
  do not describe restoring one sprite's checkpoint into another. Section 6
  rests on this.
- **Warm in about 30 s, not 15.** docs.sprites.dev says a sprite goes warm
  "after about 30 seconds" of inactivity; `docs/reply-latency.md` measured
  "within 15 s" against the API. Both are short; neither changes the
  arithmetic. Compute is billed only while active; files persist across
  every state; processes survive warm and not cold.

## Invariants

Held through every step. A step that needs to break one is a different plan.

- **The control plane never accepts a business id from a sprite.** The
  config route authenticates a *credential* and maps it to a business
  through one `SECURITY DEFINER` function that returns an id and nothing
  else — the shape migration 018 already uses for the drift sweep.
  Everything after that runs under `withTenant`. `resolveTenant` stays the
  only source of identity for session routes; this is the runtime-facing
  counterpart, in one file, and the only new cross-tenant read in the plan.
- **Configuration selects among reviewed options; it never widens what the
  agent may do.** Toolsets (`platform_toolsets`), computer-use permissions,
  the approval timeout, the base-URL allowlists in
  `configure-model-provider.py` and `bootstrap-runtime.sh`, the Hermes pin
  and the dependency pins stay in the bundle. A document can name a model,
  an endpoint from the allowlist, a limit, a credential for a reviewed
  endpoint. It cannot add a tool. This is the adapter rule from CLAUDE.md
  applied to configuration: a channel that could grant capability could
  bypass the approval gate.
- **The sprite never blocks on the control plane to boot, and never applies
  a document it cannot validate.** Last known good on disk is the fallback
  for every failure — unreachable, slow, 5xx, malformed, unknown schema. A
  sprite that cannot fetch keeps serving on what it has and says so in
  `/readyz`.
- **`run.runtime` and `run.model` stay snapshots.** A config change applies
  to runs that start after it; history is not rewritten.
- **Nothing is applied to a sprite by hand.** The config channel is the
  second sanctioned path beside the bundle; `fleet-exec.sh` stays
  read-only.
- **Every step is reversible with a worker deploy or a release rollback**,
  and says which. Steps that need a release ship one at a time.
- **Secrets in transit go to exactly one place.** The config response is
  the only new path a secret travels; it is `Cache-Control: no-store`, it is
  never logged (the route logs `rid` and `version`), and on the sprite it
  lands in a mode-0600 file next to the ones that already hold secrets. The
  database stores no new secret: fleet-wide credentials stay worker secrets
  and are resolved at serve time.

## 1. The config endpoint

### Route and mounting

`GET /v1/runtime/config`, handled by a new `worker/src/routes/runtime-config.ts`
and mounted in `worker/src/index.ts` beside `handleModelProxy` — before
`guardApiRequest`, for the same reason the model proxy is: the caller
presents a runtime credential, not a session cookie, and the `/api` guard's
CORS and cookie assumptions do not apply. A `RUNTIME_CONFIG_BURST`
rate-limit binding in `wrangler.toml` (30 per 60 s is generous; a sprite
fetches at start and on a nudge) fails closed the way `AUTH_BURST` does.

### Authentication: the derived runtime credential, not the runner key

The sprite sends `Authorization: Bearer sk-jentera-v1.…` — the value already
in `hermes.env` as `OPENROUTER_API_KEY`. The route calls `verifyJenteraKey`
exactly as `handleModelProxy` does and gets `claims.rid`
(`aisar-b-<20 hex>`). A new `resolveRuntimeIdentity(env, request)` in
`worker/src/runtime/identity.ts` does that verification and then one query:

```sql
select public.runtime_business_for_rider(${rid})
```

`runtime_business_for_rider(p_provider_name text) returns uuid` is migration
`027_runtime_identity.sql`: `SECURITY DEFINER`, `set search_path = pg_catalog,
public, pg_temp`, `stable`, granted to `aisar_app`, body
`select business_id from public.agent_runtime where provider = 'fly-sprite'
and provider_name = p_provider_name and deleted_at is null`. Ids in, id out.
The route then does everything else under `withTenant(env, businessId, …)`.

Why not `AISAR_RUNNER_KEY`: it is the inbound secret, it cannot be verified
without knowing the tenant first, and its rotation is precisely the thing
that needs a re-bootstrap today — building the channel on it would tie the
channel to the problem. Why not a brand-new credential: that is a new
transfer field, which is the two-release trap this plan closes. The derived
credential is already on every sprite, so **step 2 needs no bootstrap change
to authenticate**. The scope-widening this implies (a leaked model
credential now also reads that rider's config, including the Firecrawl
bearer) is real and is addressed in section 8 and step 5; it is accepted for
steps 2–4 because the credential already lives in the same 0600 file as
every other secret the sprite holds (`runner/README.md`, "Key co-residency").

### Response shape

```json
{
  "schema": 1,
  "version": "c3a1f0…",                       // sha256 of the canonical secret-free document, 16 hex
  "issuedAt": "2026-09-11T02:00:00Z",
  "release": "2026.09.10-2",                    // agent_runtime.desired_release for this runtime
  "hermes": {                                   // keys written into ~/.hermes/config.yaml
    "web": { "backend": "ddgs", "search_backend": "ddgs", "extract_backend": "firecrawl" },
    "agent": { "max_turns": 20, "run_budget_seconds": 900, "gateway_timeout": 900,
               "reasoning_overrides": { "MiniMax-M2.7-highspeed": "high" } },
    "auxiliary": { … },                         // as configure-model-provider.py writes today
    "provider_routing": { … },
    "gateway": { "api_server": { "extra": { "model_routes": { … } } } }
  },
  "hermesEnv": {                                // written to ~/.hermes/.env, read by get_env_value
    "FIRECRAWL_API_URL": "https://extract.kitakod.com",
    "FIRECRAWL_API_KEY": "…"
  },
  "runner": {                                   // reloaded in memory by server.mjs
    "modelName": "MiniMax-M2.7-highspeed",
    "deepModelName": "deepseek-v4-flash",
    "candidateModelNames": ["MiniMax-M3"]
  }
}
```

Rendered by a pure `renderRuntimeConfig(env, runtime, schema)` in
`worker/src/runtime/config-document.ts` from the same `Env` fields
`bootstrapRuntime` reads today (`AISAR_MODEL_NAME`, `AISAR_DEEP_MODEL_NAME`,
`candidateModelNames`, `extractEndpoint`, `runtimeFacingModelBase`), plus
the Hermes keys currently hard-coded in `configure-model-provider.py` that
are configuration rather than safety pins. `version` is the hash of the
document with `hermesEnv` *values* replaced by the *names* of the secrets
they came from — so a rotated `AISAR_EXTRACT_KEY` changes the version (its
name enters or leaves the document; its bytes never enter the hash). The
route costs one round trip for the rider lookup and one under `withTenant`
for the runtime row; verification is stateless. Step 2 caps the document to
the extract keys; step 3 fills it.

### Versioning, and the config-side two-release rule made safe

`schema` is negotiated, not assumed. The runner sends
`X-Aisar-Config-Schema: 1`; the worker renders for that schema or answers
`409 { "err": "schema unsupported" }`, and the runner keeps last known good.
A runtime that has not yet upgraded to a bundle that understands schema 2
keeps running on schema 1 or on LKG — it is never handed something it will
reject at boot. This is the analogue of the transfer-field allowlist with
the failure mode changed from *deadlock* to *stale*, which `/readyz`
reports and `stats.sh fleet` shows.

`version` is compared for equality, not order. The server is authoritative
for what the current document *is*; the on-disk copy is only for when the
server cannot be reached. So a rollback is a deploy that renders the old
document: a different hash, applied like any other.

### How the runner applies a document without dropping a run

New in `runner/src/server.mjs` (kept in that one file so
`RUNNER_SOURCE_SHA256` continues to attest the whole runner):

1. **Fetch** — on process start (after `validated`, before `listen`), with a
   10 s timeout, in the background so `/readyz` is never blocked on the
   control plane; and on a **nudge**. The nudge is free: `dispatchRuntimeRun`
   (`worker/src/runtime/run-task.ts`) already calls `client.ready()` before
   every run, so `RunnerClient.ready()` adds a request header
   `X-Aisar-Config-Version: <desired hash>` (the worker renders and hashes
   per request — pure CPU — or reads `agent_runtime.desired_config_version`
   once step 4 stores it). The runner compares it with the applied hash
   and fetches when they differ.
2. **Validate** — `schema` known; every `hermes` key in a closed list the
   runner ships (the keys `configure-model-provider.py` writes today,
   nothing else); base URLs against the allowlist the Python already
   enforces; model ids against the `modelId` regex `taskProblem` uses;
   `hermesEnv` names against a closed list (`FIRECRAWL_API_URL`,
   `FIRECRAWL_API_KEY`; step 5 adds the model credential). Anything else
   rejects the whole document and keeps LKG; `/readyz` carries
   `config.rejected: "<reason>"`.
3. **Stage** — write `~/.hermes/.env.next` and a rendered
   `config.yaml.next` (the Python helper grows a
   `configure-model-provider.py --render-json -` mode that takes the JSON on
   stdin, applies the same validation and merge logic it runs today against
   a *copy* of the current config, and prints the result), all mode 0600 in
   the same directory.
4. **Apply at a safe point** — only when the runner's single slot is empty
   (`activeTask(...)` is null; the runner already reconciles this on every
   `/readyz`). Then `rename` each staged file into place, replace the
   in-memory routing tuple `taskProblem` reads, and write the LKG file
   `/home/sprite/aisar/config.lkg.json` (0600) with the applied document and
   `appliedAt`. Because Hermes reads `config.yaml` at agent creation and
   Firecrawl values at tool-call time, **nothing restarts** for anything in
   the step-2/3 document. If a run is active when the fetch completes, the
   staged files wait and are applied when the task goes terminal — the
   runner already observes that transition to release the slot.
5. **Restart only for env-bound keys** (step 5): a change to
   `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` or `HERMES_API_KEY` rewrites
   `hermes.env` and restarts the `hermes` service, again only with the slot
   empty. The restart is `sprite-env services restart hermes`;
   `hermes-service.sh` already handles the stale-gateway race with
   `--replace`. Whether `sprite-env` is on the runner service's PATH is an
   open question below; today it is invoked from the bootstrap's exec
   context, not from a service.
6. **Attest** — `/readyz` gains
   `config: { schema, version, appliedAt, source: 'control-plane' | 'lkg' | 'bootstrap', pendingVersion?, rejected?, staleSince? }`.
   `RunnerClient.ready()` returns it; `run-task.ts` records
   `agent_runtime.observed_config_version` under the `withTenant` it
   already opens. That column is how convergence is reported without
   waking anyone.

### When the endpoint is unreachable

Last known good, always. Order on start: `config.lkg.json` if present →
else the files the bootstrap wrote (the bootstrap writes an LKG too, from
the document it fetched — section 2 — so "no LKG" means only a sprite
provisioned before step 2). Fetch failures back off 1, 5, 15 minutes, then
hourly while the process lives; a paused sprite retries on its next wake.
The worker **does not** fail a dispatch because config is stale; it logs
`[runtime-config] stale rid=… applied=… desired=…` and proceeds. The one
exception is a document the operator marks `required` (a model-base change,
say): then the pre-dispatch gate in `consumer.ts` treats the mismatch like
release drift and publishes an `upgrade` task with `reason:
'config_required'` — the existing push path, used only when the pull path
cannot be trusted to have run. A restore from checkpoint (`reconcileRuntime`
on provider `error`) rolls files back to the checkpoint's config; the runner
re-fetches on start and heals — the database is the source of truth and
on-disk config is derived state.

### Where secrets live in the response, and what rotation becomes

Fleet-wide secrets (`AISAR_EXTRACT_KEY`) stay worker secrets and are placed
into `hermesEnv` at serve time. Per-runtime secrets are derived, not stored:
the model credential is `deriveJenteraRuntimeCredential(AISAR_MODEL_KEY, rid)`
— no database read. So rotation becomes:

- **Firecrawl bearer**: `wrangler secret put AISAR_EXTRACT_KEY` and, on the
  reverse proxy, accept both for a day. Every sprite picks the new one up
  on its next wake; `stats.sh fleet` shows who has not woken. No release,
  no wake. Today this is a fleet release.
- **Model credential** (step 5): rotate `AISAR_MODEL_KEY` with
  `AISAR_MODEL_KEY_PREVIOUS` set; `verifyJenteraKey` accepts either during
  the window (the model proxy and the config route share it). A sprite
  authenticates with the old credential, receives the new one in
  `hermesEnv`, restarts Hermes when idle, and every later call carries the
  new one. When `observed_config_version` shows the fleet moved, unset the
  previous secret. `runtimeModelKeyNeedsRotation` stops publishing
  `upgrade` tasks for the proxy-mode case, and the "wait for a run, defer
  it 30 s, re-bootstrap" path in `consumer.ts` goes away for credentials.
  Today, per `runner/README.md`, "key rotation requires re-provisioning the
  Sprite".
- **Runner key and Hermes key**: stay bootstrap-delivered in this plan.
  They are not what breaks; rotating them is a re-provision and can remain
  one.

## 2. What must remain at bootstrap

The line: **if a wrong value could hand the agent a capability it should not
have, or point it at something nobody reviewed, it is code or a
code-enforced allowlist; if it selects among reviewed options or carries a
credential for one, it is configuration; if the sprite needs it to reach the
control plane at all, it is bootstrap.**

| Stays in the bundle (code, at `RUNTIME_BUNDLE_COMMIT`) | Stays in the bootstrap transfer | Moves to the config document |
|---|---|---|
| runner assets; `HERMES_TAG`/`HERMES_COMMIT` and the installer sha256; `patch-hermes-dependencies.mjs` pins; Playwright; `ddgs==9.16.0`; `platform_toolsets`; `computer_use.permissions`; `approvals.timeout`; `gateway.api_server.max_concurrent_runs`; both base-URL allowlists; the `hermesEnv` name allowlist; the `hermes` key allowlist | `BUSINESS_ID`, `RUNTIME_RELEASE`, `RUNNER_KEY`, `HERMES_KEY`, `EDGE_TOKEN` (when used), `MODEL_BASE` (doubles as the control-plane origin: `https://api.jentera.ai/v1/model` → `/v1/runtime/config` is the same origin), `MODEL_KEY` (the control-plane identity), `CUA_ENABLED` (a capability grant), `HERMES_TAG`/`HERMES_COMMIT` (already sent; keep) | `MODEL_NAME`, `DEEP_MODEL_NAME`, `CANDIDATE_MODEL_NAMES`, `EXTRACT_BASE`/`EXTRACT_KEY`; `web.*`; `agent.max_turns` / `run_budget_seconds` / `gateway_timeout`; `agent.reasoning_overrides`; `auxiliary.*` endpoints and model; `provider_routing`; `compression.*`; `tool_output.*`; `web.extract_char_limit`; `model_routes` |

Two things about the middle column. `MODEL_BASE` and `MODEL_KEY` are
*reachability*: the bootstrap needs them to fetch the document, and the
model smoke needs them to prove inference. And nothing in that column
changes between releases except by rotation, which is why it can stay a
closed list without the trap recurring: the trap was configuration
travelling in a channel built for identity.

The right-hand column is the payoff beyond today's incident: every
"sprite-side knob" in the cost plan's step 3 (3e tool-output limits, 3f
compaction, 3g reasoning overrides, and the extract backend that started
this) becomes a worker deploy that lands on next wake, with the same
one-line rollback that plan already requires of its worker-side steps.

Under the split, `bootstrap-runtime.sh` becomes: parse the identity
transfer → install code as today → **fetch the document** with `curl`,
`MODEL_KEY` as bearer, against `MODEL_BASE`'s origin → apply it with the
same Python helper the runner uses → run the smokes against the document's
models → recreate services → readiness → checkpoint. The bootstrap writes
the LKG, so a freshly provisioned sprite and an upgraded one start from the
same state. If the fetch fails during bootstrap the bootstrap fails, as any
other network step does: a lifecycle task retry, not a bricked sprite.

## 3. Staged rollout

The per-business override pattern (`AISAR_QUICK_MODEL_OVERRIDES`,
`AISAR_ROUTINES_BUSINESS_IDS`) is a canary list in env. Generalised, a
rollout is a **target** (a release id, or a config version), **rings** of
runtimes, a **ring pointer** that advances when the previous ring is
healthy, and a **gate** that can stop it without a human.

### State

- `agent_runtime.rollout_ring smallint not null default 2 check (rollout_ring in (0, 1, 2))`
  (migration `028_fleet_rollout.sql`). Ring 0 is seeded from
  `AISAR_ROLLOUT_CANARY_BUSINESS_IDS` in `wrangler.toml` — Kitakod Ventures,
  the business that already canaries routines and the deepseek trial; the
  sweep writes the column for any business named there, so the env list
  stays the operator's handle. Ring 1 is a few active businesses of the
  founder's choosing; ring 2 is everyone else. A column rather than a hash
  of the id, because "move NEOREKA to ring 1" should be one
  `stats.sh sql`-visible fact, not a formula.
- `fleet_rollout (target text primary key, kind text check (kind in ('release','config')), ring_active smallint not null default 0, status text check (status in ('rolling','halted','done')), reason text, started_at, promoted_at, updated_at)`.
  Tenant-free, RLS enabled and forced with identity-agnostic policies for
  `aisar_app`, carrying the same comment migration 020 carries about what
  changes if tenant data is ever added.
- `agent_runtime.desired_release` becomes what its name says: **the target
  for this runtime**, written by the rollout, not mirrored from env.
  `claimRuntime`'s `on conflict … set desired_release = excluded.desired_release`
  goes; `ensureProviderRuntime` reads the release from the row it claimed.
  `RUNTIME_RELEASE` in `wrangler.toml` becomes the *fleet* target the
  rollout converges toward. Likewise `desired_config_version` /
  `observed_config_version text` on `agent_runtime`, and
  `fleet_config (version text primary key, document jsonb, created_at)` —
  the secret-free rendered document — so the previous version can still be
  served to rings the pointer has not reached. `renderRuntimeConfig`
  inserts a row when the rendered hash is new.

### The sweep becomes the rollout driver

`sweepRuntimeDrift` in `consumer.ts` is where upgrades are published today;
it becomes `advanceFleetRollout(env)` in `worker/src/runtime/rollout.ts`,
called from the same `*/15` cron in `index.ts` and the same
`POST /api/support/drift-sweep`. Per sweep, for each active rollout:

1. **Health of rings ≤ `ring_active` on the target**, through one new
   `SECURITY DEFINER` function
   `runtime_rollout_health(p_target text, p_kind text, p_since timestamptz)`
   that returns counts only: runtimes in ring, converged, in `error`,
   lifecycle tasks `exhausted` whose `last_error` does **not** match
   `TRANSIENT_TASK_ERROR_RE` (the predicate `enqueueRuntimeTask` already uses
   to decide what is infra noise), and `run` rows `completed` / `failed` for
   those businesses since `p_since` — restricted to runs whose `run.runtime`
   / `run.model` snapshot is the target's, so a run that started on the old
   release does not count against the new one. Baseline: the same
   businesses' failure rate on the previous target over the prior seven
   days, from the same function.
2. **Halt** when any of: failed/(completed+failed) on the target exceeds
   baseline + 10 points with at least `AISAR_ROLLOUT_MIN_RUNS` (default 5)
   runs; any runtime in a promoted ring is `error` after a lifecycle task;
   any exhausted lifecycle task with a deterministic error. Halting sets
   `status = 'halted'` and `reason`, publishes nothing further, and is what
   `health-alert.sh` alerts on. It does not roll back on its own: the
   canary is one business the founder can see, and an automatic rollback
   that re-bootstraps twelve sprites is the failure mode we are leaving.
3. **Promote** when rings ≤ `ring_active` are converged (or past the
   straggler deadline in section 4), at least `AISAR_ROLLOUT_SOAK_MINUTES`
   (default 60) have passed since `promoted_at`, at least `MIN_RUNS` runs
   landed on the target, and the health bound holds. Promotion writes
   `desired_release` (or `desired_config_version`) for the next ring's
   runtimes — each under `withTenant`, the ids coming from a definer
   enumeration as today — and bumps `ring_active`. Ring 2 promoted and
   converged → `done`.
4. **Operator controls**, all `ship-runtime.sh` flags through the support
   endpoint: `--resume-rollout` clears a halt; `--rollback` sets the
   previous target as `desired_*` for every ring already moved and marks
   the rollout `done` with the reason. For config, rollback is also just a
   deploy that renders the previous document.

### What changes downstream

`runtime_drift_targets` loses `p_current_release`: drift is
`observed_release is distinct from desired_release`, which the row already
expresses. The pre-run gate in `consumer.ts` (`releaseDrift`) and
`satisfiedReleaseRepair` compare observed to desired instead of both to env;
`runtimeReady` in `execution.ts` already does. `POST /api/runtime/upgrade`
keeps using the fleet target — an owner asking for an upgrade is asking for
the newest. `watch-release-converge.sh`'s `still_drifted` query is already
`desired_release <> observed_release` and keeps working unchanged.

The health gate uses `run.status` and `runtime_task` fields that exist
today; nothing new is measured. Its weakness is honest: with one active
business per ring the failure rate is noisy, `MIN_RUNS` is the guard, and a
halt is cheap because nothing was pushed to the rings behind it.

## 4. Lazy convergence

Today a release wakes every paused sprite to rebuild it. The sweep publishes
an `upgrade` per drifted runtime every fifteen minutes; each upgrade is
`writeFile` + `exec` through the Sprites API, which wakes the sprite and
holds it active for the 3.5–5.5 minutes the bootstrap takes.

### The change

Upgrade on the **tail** of real work, not ahead of it, and never wake a
sprite only to rebuild it:

- **After a run completes** (`consumer.ts`, where `completeRuntimeTask` is
  called for a `run`), if `observed_release !== desired_release`, publish an
  `upgrade` with `reason: 'post_run'`. The sprite is awake and about to go
  idle; the upgrade rides the wake that already happened. The lease index
  (`idx_runtime_task_one_lease`) already prevents it from running under a
  live reply; a second message arriving during the upgrade is deferred 30 s
  by the existing pre-run gate, exactly as today.
- **Before a run**, the existing gate (`releaseDrift` → defer the run,
  publish `upgrade`, reason `release_drift`) stays, but fires only when the
  observed release is **below `RUNTIME_MIN_RELEASE`** — a new
  `wrangler.toml` var naming the oldest release the worker still speaks to.
  At or above it the run proceeds on the release the sprite has
  (`RunnerClient` is constructed with `expectedRelease:
  runtime.observedRelease`, attesting what is on the row rather than what
  is wished for) and the upgrade follows the reply. Release ids compare as
  `(date, serial)` tuples, not strings — `2026.09.10-10` sorts after `-9`.
  `ship-runtime.sh` sets `RUNTIME_MIN_RELEASE`: to the new release by
  default (today's semantics), or to the previous one with `--compatible`,
  which the operator may pass only when the bundle diff touches neither
  `HERMES_PATCH_ID` nor the `/readyz` and `/v1/tasks` contract
  `runner-client.ts` checks. `validate-release.mjs` refuses `--compatible`
  when `HERMES_PATCH_ID` differs between the two bundle commits.
- **The sweep handles stragglers only.** A runtime whose
  `desired_release` changed more than `AISAR_ROLLOUT_STRAGGLER_HOURS` ago
  (default 72) and is still drifted is pushed the old way — at most
  `AISAR_ROLLOUT_PUSH_PER_SWEEP` (default 2) per sweep, ordered by
  `last_ready_at` ascending, and only while the org's running count (one
  `GET /v1/sprites` per sweep, the call `health.sh` already makes; add
  `FlySpriteProvider.list()`) is at or below `10 − AISAR_ROLLOUT_SLOT_RESERVE`
  (default 3). A business silent for three days is not waiting on the
  upgrade; two per quarter hour converges a hundred stragglers in about
  half a day without ever taking more than two of the ten slots.
- **Config needs none of this.** A config change is a worker deploy; the
  runner fetches on its next wake or nudge. Zero wakes, zero slots, zero
  bootstraps.

### What it saves, and what it does not

Sprites bill compute only while active, at $0.07 per CPU-hour and $0.04375
per GB-hour (`docs/sprites-vs-dedicated-vms.md`, checked 2026-09-10). A
bootstrap is a busy process — `npm install`, Chromium, model calls — so take
1 CPU and 2 GB for 4.5 minutes: about **$0.012 per sprite per push**, plus
the smoke's tokens (the cost plan's "uniform ~$0.07 a month against zero
runs on seven businesses" points at those smokes). Twelve sprites: about
fifteen cents a release. A hundred: about $1.25 plus tokens. **The dollars
are not the argument.** What matters:

- **Slots.** The org allows ten running sprites. A fleet push at a hundred
  businesses is ≥ 45 minutes of *every slot* occupied by bootstraps if the
  packing were perfect and nothing else ran; in practice one to two hours,
  during which a customer's reply competes for a slot with a rebuild. With
  `AISAR_KEEPALIVE_GRACE_HOURS = 0` the fleet is normally almost all cold,
  so the cap is invisible today and binding the moment a push starts. Lazy
  convergence never takes more than two slots for stragglers and otherwise
  uses wakes a reply already paid for.
- **Failure surface.** 254 upgrade tasks in three days for twelve sprites,
  152 exhausted at eight attempts each. Each push is an independent draw
  against GitHub raw lag, the npm registry, Playwright's CDN and the model
  smoke. Tail-of-run upgrades happen one at a time, spread over days, and a
  failure affects a business that has just been served, not twelve at once.
- **Wall-clock and operator attention.** No convergence to babysit; the
  next section makes that explicit.

What it costs: a business's first message after a *breaking* release still
pays the upgrade before the reply (the pre-run gate); that is today's
behaviour, now confined to releases that genuinely need it. And a
`--compatible` release means the worker supports two runner contracts for a
while; `runner-client.ts` already tolerates absent fields, and the gate
above keeps the patch id fixed across such a pair.

## 5. Non-blocking ship and convergence reporting

`ship-runtime.sh` stops at "deployed, rollout started". After the deploy it
calls `POST /api/support/drift-sweep` as now, prints the rollout row
(`target`, `ring_active`, `status`) and exits 0. `--watch` keeps today's
blocking `watch-release-converge.sh` + `fleet-verify.sh` tail for the
operator who wants it; `--dry-run` is unchanged. The `-m` message goes into
`fleet_rollout.reason` at start so the row explains itself.

Reporting reads the database and wakes nothing:

- `GET /api/support/fleet` (support key, `routes/support.ts`) returns the
  rollout rows, per-ring counts of `observed_release` and
  `observed_config_version` against their desired values, the straggler
  list (`provider_name`, `last_ready_at`, observed/desired), and the last
  five exhausted lifecycle errors. Every number comes from the definer
  functions the sweep already uses; no tenant row leaves scoped reads.
- `stats.sh fleet` renders the same from the owner connection, read-only,
  the way `stats.sh runtimes` does today.
- `health.sh` step 5 (release conformance, warn-only today) gains "rollout
  halted" as a **fail** and "straggler past deadline" as a warn;
  `health-alert.sh` therefore pages on a halt. `pulse.sh` adds one line:
  releases and config versions in service this week.
- `fleet-verify.sh` stays as the deep check for when someone wants proof
  from inside the sprites; it wakes them and is not part of the default
  ship.

## 6. Pre-baked images — evaluated, and not now

The idea: build the Hermes tree, `node_modules`, the venv and Chromium once
per release and have each sprite start from that instead of installing.

Not worth doing yet, for four reasons in order of weight:

1. **Sprites offers no image primitive.** `POST /v1/sprites` accepts a
   name, `wait_for_capacity` and `url_settings`. Checkpoints are per-sprite
   filesystem save points; restore is destructive and restarts the
   environment; nothing in the docs restores one sprite's checkpoint into
   another. So an "image" would have to be a tarball we host (R2 fits — the
   global `ARTIFACT-STORAGE.md` has the buckets and the `--remote` lesson),
   sha256-pinned in the bundle, downloaded and unpacked by the bootstrap in
   place of `npm install` + Playwright + `uv pip install`.
2. **Its payoff shrinks with this plan.** Once configuration no longer
   re-bootstraps anyone and code releases converge lazily, re-bootstraps
   become rare and off the reply path. A faster rare thing is a small win.
3. **We do not know what the bootstrap spends its minutes on.** It prints
   no stage timings. Step 1 adds them to its JSON result so
   `runtime_task.result` records where the 200–300 s go. If `npm install` +
   Chromium dominate *and* code releases stay weekly after step 4, revisit
   with numbers; a venv/`node_modules` tarball across a homogeneous
   Ubuntu 24.04 x64 fleet is plausible but is its own project (paths,
   native modules, the `patch-hermes-dependencies.mjs --verify` contract).
4. **The failures that hurt were not install time.** Today's was an
   allowlist; 2026-09-05's was an installer flag; NEOREKA's was a budget 429
   read as broken inference. An image fixes none of those.

The one cheap thing in this direction, worth folding into step 1: make the
unconditional stages conditional where they can be — `npm install` when the
lockfile hash matches the last successful install, Playwright when the
browser binary the bootstrap already searches for is present. Both are
idempotency guards the script half-has already.

## 7. Migration — small steps, each reversible, no deadlock

The order is chosen so that **no step sends a sprite anything the bundle it
is on cannot parse**, and so that each step is useful if the next never
ships.

### Step 1 — unknown transfer fields cannot deadlock (one release)

`bootstrap-runtime.sh`: the `*)` arm of the transfer `case` becomes
`echo "runtime bootstrap transfer: ignoring unknown field $name" >&2;
ignored+=("$name")` — the base64 validation of every value and the
`: "${X:?missing …}"` guards on required fields are untouched, so the
transfer is still data, not code, and a missing *required* field still
fails loudly. The bootstrap's final JSON line gains
`"ignoredFields": [...]` and `"stages": {"install": 41, "npm": 63, …}`
(seconds); `provision.ts` keeps that in the lifecycle task's `result` so it
lands in `runtime_task.result` beside `region`. `extract-endpoint.test.ts`'s
allowlist assertion stays and is renamed to say what it now means: a field
`provision.ts` sends that the bootstrap does not name is *not applied*, and
the test is the lint that catches it before a release, not a guard against
a deadlock that can no longer happen. `runner/test/bootstrap.test.mjs` gets
a case: an unknown field is reported, ignored, and the bootstrap proceeds.

`validate-release.mjs`: keep 2e0c6f7's forward check (fields sent versus
the bootstrap at the shipped bundle) and drop its backward check, whose
premise the code does not support. In its place, a `predeploy` script in
`worker/package.json` — `worker/scripts/check-transfer-fields.mjs`, the
same regexes — compares `provision.ts` in the tree being deployed with
`bootstrap-runtime.sh` at the `RUNTIME_BUNDLE_COMMIT` pinned in that tree's
`wrangler.toml`, so a worker deploy that never touches a release is gated
against the bundle the sprites will actually download. Until step 1's
release is on every runtime this check is a hard fail; after it, a missing
field is a warning, because the bootstrap now ignores it and `/readyz`
attests what was applied.

Ship with `ship-runtime.sh -m "bootstrap tolerates unknown transfer fields; stage timings"`.
**Do not** re-enable `AISAR_EXTRACT_BASE` in the same release: three
runtimes are still on `2026.09.09-2`, whose bootstrap rejects the extract
fields, and sending them now recreates 2026-09-10 for those three.

Independently valuable: the deadlock class is closed for every future field
the moment a runtime is on this release, and the stage timings answer
section 6's question. Reversible: revert the `case` arm, one release.

**Step 1b (optional, one release, old path):** once every runtime observes
the step-1 release, set `AISAR_EXTRACT_BASE` and cut a release so
`hermes.env` is rewritten with the Firecrawl credentials — the second half
of the procedure CLAUDE.md already prescribes. Worth doing if step 2 is more
than a week away, because `web_extract` is dead until then and the cost
plan rates that as a groundedness problem, not only a cost one. If step 2
is imminent, skip it and let Firecrawl be step 2's proof.

### Step 1 results, measured 2026-09-10 (releases 2026.09.10-4 and -5)

Shipped. Unknown transfer fields are ignored rather than fatal, the JSON
result carries `ignoredFields` and `stages`, and `provision.ts` keeps it on
the lifecycle task. Twelve upgrades with stage data:

| stage | mean seconds |
|---|---|
| install (hermes clone/patch) | 1.3 |
| npm | 6.6 |
| playwright | 6.7 |
| configure | 0.6 |
| smokes | **18.6** |
| **bootstrap total** | **~33.8** |

Against a mean **upgrade task** of **129.4 s** (42.1 – 176.6 s over the same
twelve). So the bootstrap script is about a quarter of an upgrade, and the
remaining ~95 s is everything around it: waking a paused sprite, curling the
runner assets, readiness polling, the checkpoint, and the control-plane
round trips.

Two things follow, and both cut against section 6's alternatives.

**Pre-baked images are worth even less than section 6 estimated.** The stages
an image could remove — install, npm, playwright — total ~14.6 s, about 11% of
an upgrade. Baking would leave the smokes, the wake, the asset fetch and the
checkpoint exactly where they are. Section 6's conclusion stands, now with a
number behind it rather than an argument.

**The largest single stage is the smokes at 18.6 s** — more than install, npm
and playwright combined. If upgrade wall-clock ever needs to come down, that
is the first place to look, not the install path. Whether the model smoke can
be skipped when neither the model nor the pin changed is worth its own
question; it is a correctness gate, so the answer is not obviously yes.

**Corollary for lazy convergence (section 4):** at ~129 s per upgrade and ten
concurrent slots, a hundred-sprite push occupies the fleet for ~22 minutes of
pure upgrade time even if nothing fails — before counting the wake cost of
sprites that had no work to do. That is the argument for upgrading on the
tail of a real run, and it is now arithmetic rather than an estimate.

### Step 2 — the config channel, minimum viable (a deploy, then one release)

Worker (deploy first; nothing calls it yet): `027_runtime_identity.sql` and
`apply-runtime-identity.mjs` with a `db:migrate:runtime-identity` entry in
`worker/package.json`; `worker/src/runtime/identity.ts`
(`resolveRuntimeIdentity`); `worker/src/runtime/config-document.ts`
(`renderRuntimeConfig`, schema 1, **document limited to
`hermes.web.extract_backend` and `hermesEnv.FIRECRAWL_*`**);
`routes/runtime-config.ts`; `RUNTIME_CONFIG_BURST`;
`X-Aisar-Config-Version` on `RunnerClient.ready()` and the readiness
`config` field in `RunnerReadiness`; `observed_config_version` recorded in
`run-task.ts` — the column comes in the same migration.

Runner and bootstrap (one release): fetch / validate / stage / apply / LKG /
attest as in section 1; `bootstrap-runtime.sh` **stops writing
`FIRECRAWL_*` into `hermes.env`** (they would shadow `~/.hermes/.env`) and
instead fetches the document and writes `~/.hermes/.env` plus the LKG;
`configure-model-provider.py --render-json -`. The transfer still carries
`EXTRACT_BASE_B64`/`EXTRACT_KEY_B64` for one more release so a sprite that
lands on this bundle without reaching the endpoint still gets them from the
bootstrap; the worker keeps sending them until step 3.

Proof: set `AISAR_EXTRACT_BASE` (a worker deploy, no release). Watch
`stats.sh fleet`: `observed_config_version` moves as sprites wake. Probe
`web_extract` on the canary sprite as the cost plan did on 2026-09-10 and
record that it reads a page. Rollback: unset the var and deploy — sprites
render the previous document on their next wake; or, at worst, release
rollback per `docs/release-playbook.md`, which puts back a bootstrap that
ignores the config channel entirely.

### Step 3 — configuration leaves the transfer (one release, then a deploy)

The document grows to the full right-hand column of section 2; the runner
reloads its routing tuple from `runner`; the bootstrap fetches the document
before the model smoke and smokes the document's models;
`configure-model-provider.py` keeps only the safety pins in code and takes
everything else from the document. The bootstrap **ignores**
`MODEL_NAME_B64`, `DEEP_MODEL_NAME_B64`, `CANDIDATE_MODEL_NAMES_B64` and
`EXTRACT_*_B64` (with step 1's tolerance they are harmless). After the fleet
observes this release, `provision.ts` stops sending them — a deploy, and the
reverse of the two-release rule: *stop reading before you stop sending*.
The allowlist test in `extract-endpoint.test.ts` becomes a test over the
whole transfer list against the whole bootstrap allowlist, in
`worker/test/bootstrap-transfer.test.ts`.

Proof: change `AISAR_CANDIDATE_MODEL_NAMES` by deploy alone and watch the
canary's `/readyz` (`fleet-verify.sh --only <canary>`) attest the new route
without a release. Then the cost plan's 3e/3f knobs can be tried as deploys.

### Step 4 — rings, lazy convergence, non-blocking ship (deploys and a migration; no sprite change)

`028_fleet_rollout.sql` (+ apply script): `rollout_ring`,
`desired_config_version`, `fleet_rollout`, `fleet_config`, the health
function, the narrowed drift function. `rollout.ts` replaces
`sweepRuntimeDrift`; the `post_run` upgrade and `RUNTIME_MIN_RELEASE` gate in
`consumer.ts`; `claimRuntime` stops mirroring env;
`FlySpriteProvider.list()`; `/api/support/fleet`; `stats.sh fleet`;
`health.sh`/`health-alert.sh`; `ship-runtime.sh --watch` / `--compatible` /
`--resume-rollout` / `--rollback`. Land it in three deploys, each reversible
by redeploying the previous worker: (a) migration + rings + rollout driver
with the pointer pinned at ring 0 (only the canary gets new targets
automatically; everyone else exactly as today via manual promotion); (b)
lazy convergence with `RUNTIME_MIN_RELEASE` = current release (identical
behaviour until an operator passes `--compatible`); (c) automatic promotion
with the health gate.

Proof: the next real release goes canary → soak → ring 1 → ring 2 with no
operator between, and `fleet_rollout` records each promotion; a deliberate
halt (set `MIN_RUNS` to 1 and fail a canary run with `/stop`) stops it.

### Step 5 — credentials through the channel (one release, then deploys)

`hermesEnv` gains `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`; the runner
restarts Hermes when idle on a change to either; `verifyJenteraKey` accepts
`AISAR_MODEL_KEY_PREVIOUS`; `runtimeModelKeyNeedsRotation` in proxy mode
becomes a config-version comparison and no longer publishes `upgrade`
tasks; the response also hands over a **config-scoped** credential
(`jentera-config-key:v1` context, same derivation, no spend claims) that the
runner uses for every later fetch, closing the scope-widening accepted in
section 1. Proof: rotate `AISAR_MODEL_KEY` on a quiet afternoon and watch
the fleet move without a release.

### Step 6 — decide on install-time work with numbers (no code by default)

Read `stages` from a fortnight of `runtime_task.result`. If install stages
are more than half of a bootstrap *and* more than one breaking release a
week is expected, open a separate plan for the tarball; otherwise record the
numbers here and close the question.

## 8. What this does not fix, and what it makes worse

Not fixed:

- **A Hermes pin bump or a runner change is still a re-bootstrap**, with
  every fragile stage in it. Lazy convergence spreads the risk; it does not
  remove it. The release gate and the playbook stay load-bearing.
- **The ten-sprite cap.** Reserving slots for real traffic is a policy, not
  more slots. At a hundred businesses with real concurrency the cap is a
  Sprites conversation or the dedicated-VM pilot in
  `docs/sprites-vs-dedicated-vms.md`.
- **Breaking releases still put an upgrade in front of a reply** for the
  first message after them. That is the correct behaviour and it costs an
  owner three to five minutes; `--compatible` avoids it when the bundle
  allows.
- **Hand-applied changes** are still invisible to releases and now also to
  config; `fleet-exec.sh` stays read-only by rule, not by mechanism.
- **The runner and Hermes keys** still rotate by re-provision.

New risks, each with what bounds it:

- **The control plane is in the boot path.** A sprite that has never
  fetched (provisioned before step 2, or bootstrap fetch failed) runs on
  bootstrap-written files; one that has fetched runs on LKG. A worker outage
  therefore degrades to *stale*, never to *down*, and `/readyz` says which.
  What LKG cannot cover is a sprite whose LKG is *wrong* — a document that
  validated but misconfigures Hermes. That is what rings are for; the
  canary meets it first, and rollback is a deploy.
- **A new place secrets flow.** The response carries the Firecrawl bearer
  and, from step 5, the model credential, to any holder of a valid runtime
  credential. Bounds: TLS to `api.jentera.ai` only (the origin comes from
  the allowlisted `MODEL_BASE`, never from the document — a document cannot
  redirect the next fetch); `no-store`; never logged; rate-limited; the
  credential is pseudonymous and already sits in the same file as the
  secrets it now fetches; step 5 narrows it to a config-scoped key. What is
  genuinely wider until step 5: a leaked `sk-jentera-v1` yields the
  Firecrawl bearer, where today it yields at most $5 of model spend.
  Firecrawl's reverse proxy should rate-limit per bearer, and the bearer is
  rotatable by the procedure in section 1 — which is now cheap.
- **A second tenant resolver.** `runtime_business_for_rider` is one more
  function that reads across tenants. It returns an id, is granted to
  `aisar_app` only, is tested in `worker/test/tenancy.test.ts` the way
  `runtime_drift_targets` is (`pg_temp` shadowing, identifiers only), and
  is the only way the config route learns a business.
- **A validated-but-harmful document.** The runner's key allowlist and URL
  allowlists are the last line; they are the same lists the bootstrap
  enforces today, in the same Python. A key not in the list is a bundle
  change, which is a release, which is reviewed.
- **Applying under a run.** The single-slot check plus staged files plus
  atomic renames make a mid-run apply impossible by construction, and
  Hermes reading config at agent creation makes an accidental one harmless
  for these keys. The restart path (step 5) is the one that could interrupt
  a run and is gated on the empty slot twice: before staging and before
  `rename`.
- **Two runner contracts at once** under `--compatible`. Bounded by the
  gate refusing a patch-id change, and by `expectedRelease` attesting the
  row's observed release rather than accepting anything.
- **Schema drift between worker and bundle.** Negotiated per request;
  unknown schema is `409` + LKG, never a boot failure. The failure mode is a
  stale sprite visible in `stats.sh fleet`, which is the failure mode we
  wanted instead of a deadlock.
- **Rollout automation promoting on noise.** `MIN_RUNS`, the soak, and the
  ring-0 canary being the founder's own business bound this; the gate can
  only halt, never roll back, so its worst case is a stopped rollout and a
  page.

## Acceptance gate

Step 1

- [x] `bootstrap-runtime.sh` ignores unknown `*_B64` names with a stderr
      line; base64 validation and required-field guards unchanged
      (`runner/test/bootstrap.test.mjs`: unknown field reported and ignored;
      invalid base64 still refused; missing runner key still refused).
- [x] Bootstrap JSON result carries `ignoredFields` and per-stage seconds;
      `provision.ts` stores it in the lifecycle task's `result`
      (asserted by `worker/test/bootstrap-report.test.ts` over the parser
      rather than in runtime-consumer.test.ts: the shape is decided by
      `bootstrapReport`, and a unit test covers the malformed-line cases an
      integration assert would not reach).
- [x] `extract-endpoint.test.ts` allowlist case retained and reworded as a
      "field is applied" lint ("sends no transfer field the bootstrap would
      leave unapplied").
- [x] Shipped via `ship-runtime.sh`; `fleet-verify.sh` green (12/12 on
      2026.09.10-4 and -5). The three lagging runtimes had already converged
      on 2026.09.10-3, so step 1b was done before step 1 rather than after.
- [x] Stage timings from at least ten upgrades recorded here (twelve).
- [x] `validate-release.mjs` keeps the forward transfer-field check and
      loses the backward one; `check-transfer-fields.mjs` runs as
      `predeploy` against the pinned bundle's bootstrap and is tested
      against the b151bb8 / c6ed3c1 pair (fails on the first, passes on the
      second).

Step 2

- [ ] Migration 027 applied; the apply script verifies the function exists,
      is `SECURITY DEFINER`, is granted to `aisar_app`, and returns null for
      a deleted or unknown rider.
- [ ] `runtime-config.test.ts`: refuses no credential, a wrong signature, a
      rider with no runtime; serves the canary's document under RLS as
      `aisar_app`; `version` changes when `AISAR_EXTRACT_KEY`'s *name*
      enters the document and not when only its value does; response is
      `no-store`; unknown `X-Aisar-Config-Schema` answers 409.
- [ ] `tenancy.test.ts`: `runtime_business_for_rider` cannot be shadowed by
      `pg_temp` and exposes only an id.
- [ ] `runner/test/server.test.mjs`: fetch on start does not delay
      `/readyz`; a document is applied only with the slot empty and is
      applied after the active task goes terminal; a 5xx, a timeout, a
      malformed body and an unknown key each leave LKG in place and are
      attested under `config.rejected` / `config.source`; the nudge header
      triggers a fetch only when the version differs.
- [ ] `bootstrap.test.mjs`: `FIRECRAWL_*` no longer exported into
      `hermes.env`; the bootstrap writes `~/.hermes/.env` and the LKG from
      the fetched document; a failed fetch fails the bootstrap.
- [ ] On the dev sprite, before the release: a `web_extract` call after
      writing `~/.hermes/.env` with no gateway restart reads a page (this is
      the open question about `.env` shadowing, answered by trying it).
- [ ] `AISAR_EXTRACT_BASE` set by deploy; `observed_config_version` reaches
      every runtime that woke within a week; the canary probe reads a page;
      the result recorded here with the date.

Step 3

- [ ] Document covers every key `configure-model-provider.py` wrote
      outside the safety pins; the Python's remaining hard-coded keys are
      exactly the bundle column of section 2 (a test enumerates them).
- [ ] Runner routing reload covered in `server.test.mjs`: a dispatched
      `model` newly named in the document is accepted without restart; one
      removed is refused.
- [ ] The bootstrap smoke runs against the document's models; the four
      transfer fields are ignored by the bootstrap one release before
      `provision.ts` stops sending them; `bootstrap-transfer.test.ts` checks
      the whole list.
- [ ] A candidate model added by deploy alone shows in the canary's
      `/readyz` within one wake.

Step 4

- [ ] Migration 028 applied; tenant-free tables carry the migration-020
      comment; `rollout_ring` seeded from `AISAR_ROLLOUT_CANARY_BUSINESS_IDS`.
- [ ] `claimRuntime` no longer writes `desired_release` from env;
      `runtime_drift_targets` compares observed to desired;
      `runtime-consumer.test.ts` "does not rerun a stale release repair" and
      the drift tests updated and green.
- [ ] `rollout.test.ts`: promotion requires soak, `MIN_RUNS` and the health
      bound; a deterministic exhausted error halts; an `error` runtime
      halts; halted publishes nothing; `--rollback` sets the previous target
      for moved rings only.
- [ ] Lazy convergence: a run on a drifted runtime at or above
      `RUNTIME_MIN_RELEASE` proceeds and publishes `post_run`; below it, the
      pre-run gate behaves as today; stragglers are pushed at most two per
      sweep and never above the slot reserve (provider `list()` faked).
- [ ] `ship-runtime.sh` exits after the sweep by default; `--watch`
      restores the old tail; `--compatible` refused by the gate when the
      patch id changes.
- [ ] `/api/support/fleet` and `stats.sh fleet` show the same numbers;
      `health.sh` fails on a halted rollout (tested with `--json`).
- [ ] The first real release after this step converges ring by ring with no
      operator action, and the row history is pasted here.

Step 5

- [ ] `verifyJenteraKey` accepts the previous secret only while
      `AISAR_MODEL_KEY_PREVIOUS` is set (`model-proxy.test.ts`,
      `runtime-config.test.ts`).
- [ ] Runner restarts Hermes only when idle and only on env-bound changes;
      a run arriving mid-restart is refused with a retryable status the
      consumer already handles (`server.test.mjs`).
- [ ] Config-scoped credential issued in the response and required on
      subsequent fetches; the model credential is refused for config after
      the handover (`runtime-config.test.ts`).
- [ ] A live rotation of `AISAR_MODEL_KEY` completes fleet-wide without a
      release; the `runner/README.md` sentence about re-provisioning is
      replaced.

Throughout

- [ ] No `fleet-exec.sh` write at any step.
- [ ] CLAUDE.md "Shipping to sprites" rewritten: the two-release paragraph
      becomes "a transfer field is identity; configuration goes through the
      config channel; an unknown field is ignored and attested"; the
      sentence "a config-only change still needs a `RUNTIME_RELEASE` bump"
      is deleted when step 2 ships.

## Delivery order

1. Step 1, this week. Half a day of code, one release, then wait for the
   three stragglers. Step 1b only if step 2 slips past the following week.
2. Step 2 worker side deployed early (it is inert without a caller), the
   runner release when the dev-sprite `.env` check passes. Two to three
   days. Firecrawl on by deploy the same day the fleet observes it.
3. Step 3, one release, after a week of step 2 in service. The cost plan's
   sprite-side knobs (3e, 3f) can start as deploys the day after.
4. Step 4 in its three deploys, migration first. No release. A week, then
   the first automatic rollout is the next real release.
5. Step 5 when a rotation is actually wanted, not before; the code is small
   but the rotation itself deserves a quiet afternoon.
6. Step 6 is a reading, not a build.

## Open questions

Stated so nobody mistakes a guess here for a fact.

- Whether `hermes gateway run` at the pin copies `~/.hermes/.env` into
  `os.environ` at start. If it does, a later `.env` write is shadowed for
  `get_env_value` until a restart, and step 2's "no restart" for Firecrawl
  becomes "restart when idle" — the mechanism exists either way. Answered
  by the dev-sprite check in step 2's gate.
- Whether `gateway.api_server.extra.model_routes` and
  `agent.reasoning_overrides` are read per run (through
  `_load_gateway_config` in `_create_agent`) or once at gateway start. The
  B1 plan's reading says per run for routes; verify at the pin before step 3
  relies on it, and fall back to idle restart for any key that is not.
- Whether `sprite-env` (or the services API on `/.sprite/api.sock`, which
  the runner already uses for Tasks) is reachable from the `aisar-runner`
  service for step 5's restart.
- Whether `GET /v1/sprites` returns per-sprite `status` for the whole org in
  one call cheaply enough to run every sweep; `health.sh` uses it, so
  probably, but its cost at a hundred sprites is unmeasured.
- The exact form of Sprites' "Maximum concurrent sprites limit" error, so
  the straggler push recognises it as a quota and backs off without spending
  an attempt (the DO plan's stress test saw it; the string is not in this
  repo).
- Whether a `run` that started on release A and finished after the sprite
  upgraded to B is attributable cleanly in `runtime_rollout_health`. The
  snapshots say A; the tail-of-run upgrade cannot start until the run is
  terminal (one lease per business), so the answer should be yes, and a
  test should say so.
