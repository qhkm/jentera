# Where the sprites actually are

Recorded: 21 September 2026.
Status: finding, not a change. Nothing was provisioned, purchased or moved.

`RUNTIME_EXPECTED_REGION` has said `sin` for as long as it has existed, and
`/api/runtime` reports every runtime's placement as optimal, different or
unknown against it. It has always answered **unknown**, for every business,
because the value it compares against has never been collected. Probed
directly, 4 of 10 sprites egress from the United States — including the one
belonging to the business that the owner tests with.

This came out of reviewing a proposal to tunnel the sprite's browser traffic
through a customer-hosted connector in Malaysia, to reduce CAPTCHA challenges
during owner sign-in. That proposal's premise — "the browser appears to be in
San Jose while the owner is in Malaysia" — is true of the sprite it was
observed on and false of the fleet. The cheaper move comes first: collect the
region, then put the sprites where the configuration already says they should
be.

## What the probe found

Ten sprites, asked what the internet thinks of them:

```bash
worker/scripts/fleet-exec.sh --only <names> \
  'curl -s --max-time 8 https://www.cloudflare.com/cdn-cgi/trace | grep -E "^(colo|loc|ip)="'
```

| Sprite | Business | colo | loc |
|---|---|---|---|
| `aisar-b-c679d9df0aaa77ba1ec7` | Kitakod Ventures (desktop canary) | SJC | **US** |
| `aisar-b-1f5ebbf25ca93689105b` | Warung Demo | SJC | **US** |
| `aisar-b-13402336ec9982adf8ce` | SiiruApp | LAX | **US** |
| `aisar-b-87c04c88287c31d9d324` | NEOREKA ASIA | LAX | **US** |
| `aisar-b-84fc033cb5b39a3ce8e3` | Jentera | SIN | SG |
| `aisar-b-4c2f85dc2709d4bd75d6` | Kitakod Ventures | SIN | SG |
| `aisar-b-05a921d0d21112fc3657` | SEIDO Coffee Roasters | SIN | SG |
| `aisar-b-2f9b73c0d0678d38411c` | Parcel Tracker | SIN | SG |
| `aisar-b-e7ffced8688cb130c265` | Aster Edu | SIN | SG |
| `aisar-b-934fab32e48c9fb237a3` | Batik People | HKG | SG |

`colo` is the Cloudflare edge that answered; `loc` is the country Cloudflare
assigns the client address, which is the one a website geolocates. Batik
People answers at Hong Kong on a Singapore-registered address.

Two things worth keeping:

- **It is not per-business.** Kitakod Ventures has two sprites, one in
  California and one in Singapore.
- **Egress is IPv6** on both sprites whose address was read
  (`2605:4c40:…` in the US, `2a02:6ea0:…` in Singapore). Anything that
  reasons about reputation by address range is reasoning about those.

Ten of twenty-six is a sample, and it was not drawn randomly — it is the
first few of the list plus the two that matter. It is enough to say the fleet
is split; it is not a distribution.

## Why nobody saw it

The chain is four hops and the first one is empty.

1. `runner/src/server.mjs:1429` — the runner reports
   `process.env.FLY_REGION ?? req.headers['fly-region']`.
   **`FLY_REGION` is unset inside the sprite** (verified), and the worker
   reaches the runner over its `sprites.app` URL, which carries no
   `fly-region` header.
2. `worker/src/runtime/runner-client.ts:236` requires three alphanumerics and
   yields `null` otherwise. It yields `null`.
3. `worker/src/agent-runtime.ts:85` reads the last provision, upgrade or
   reconcile task's `result->>'region'`. For all 26 businesses that value is
   the empty string — the key is written, the content is not.
4. `worker/src/routes/runtime.ts:109` therefore answers `regionStatus:
   'unknown'` always, and the comparison against
   `RUNTIME_EXPECTED_REGION = "sin"` (`worker/wrangler.toml:117`) has never
   once been made.

```sql
select region, count(*) from (
  select distinct on (business_id) business_id, result->>'region' as region
    from runtime_task
   where kind in ('provision','upgrade','reconcile') and status = 'completed'
     and jsonb_typeof(result) = 'object' and result ? 'region'
   order by business_id, completed_at desc) t
 group by region;
--  region | count
-- --------+-------
--         |    26
```

The Sprites API does not offer the value either: `GET /v1/sprites/<name>`
returns id, name, status, version, url and timestamps, and no region.
`sprite create` has no region flag. So placement is not something we choose
today, and reading it back needs a source that is not `FLY_REGION` — an
egress probe like the one above, or an ask to Fly.

## What else was checked on the sprite

All read-only, on `aisar-b-c679d9df0aaa77ba1ec7`:

- **`/dev/net/tun` exists** (`c-w--wx-wT root root 10, 200`), and
  `CapEff = CapBnd = 00000000a82435fb`, which carries `CAP_NET_ADMIN`,
  `CAP_NET_RAW`, `CAP_SYS_ADMIN`, `CAP_MKNOD` and `CAP_DAC_OVERRIDE`.
  Kernel-mode Tailscale would work. **Those capabilities belong to uid 1001,
  the `sprite` user — the same user the agent runs as.** Anything routed
  through a tunnel on this machine is a tunnel the agent can also reach and
  reconfigure, which is the same property recorded in
  [`the conversational connect design`](superpowers/specs/2026-09-18-conversational-connect-design.md):
  the agent has a terminal here, so machine-local isolation is not a boundary.
- `tailscale` and `tailscaled` are not installed. Anything that must be true
  on every sprite ships in the bundle, and a new `transfer` field needs its
  `bootstrap-runtime.sh` arm in the **pinned** bundle before a worker sends
  it — the failure mode of getting that order wrong is in `CLAUDE.md`.
- **Playwright is 1.58.2** at
  `/home/sprite/.hermes/hermes-agent/apps/desktop/node_modules/playwright`,
  and it already has the switch the proposal wants to hand-roll a launch for:
  `lib/server/chromium/chromiumSwitches.js:92` omits `--enable-automation`
  when `assistantMode` is set, and `:51` adds `AutomationControlled` to
  `--disable-features` in the same mode. `connectOverCDP` is already how the
  runner reattaches (`runner/src/business-browser.mjs:255`, `:449`).

## What this does not say

There is **no CAPTCHA measurement anywhere in this repository** — no baseline,
no rate, no before. The account of challenges during sign-in is one owner's
experience on one sprite, which happens to be the one in California. Moving
placement to Singapore is worth doing because the configuration already asks
for it and because it costs nothing; whether it changes how often a human is
challenged is unmeasured, and a CAPTCHA shown to an owner signing in by hand
is not a thing we can promise away.

## Suggested order

1. Collect the region for real, since every judgement below depends on it.
2. Ask Fly whether placement can be pinned, and put sprites in `sin`.
3. Measure challenges against that baseline.
4. Only then consider a customer-hosted connector — and scope it to a CONNECT
   proxy reachable on one port under a tailnet ACL, never exit-node routing,
   given who else is on the machine.
