# Provisioning time: where it goes, and what Fly offers

How long a business waits for its sprite, measured on 2026-09-11; why the
bootstrap-level speedups were not taken; and what Fly has said in public
about forking a sprite from a template. Re-measure before quoting any number
here — the query is at the end.

## What a bootstrap costs today

`bootstrap-runtime.sh` reports wall-clock seconds per stage in its JSON
result (`stages`), and `provision.ts` stores it on the runtime task. Over the
30 days to 2026-09-11 that gave 191 upgrades and one cold provision.

| Stage | Upgrade p50 | Upgrade p90 | Cold provision (n=1) |
|---|---|---|---|
| `install` — Hermes clone and installer | 1 s | | 185 s |
| `npm` — dependency patch, install, verify, audit | 7 s | | 11 s |
| `playwright` — Chromium download | 6 s | | 72 s |
| `configure` — env files, profiles | 1 s | | 7 s |
| `smokes` — models, search, services, gateway, browser | 28 s | 33 s (max 151) | 35 s |
| **bootstrap total** | **43 s** | | **310 s** |
| **whole task, created to completed** | **203 s** | **364 s** | **323 s** |

Two readings follow.

**An upgrade spends a quarter of its time in the bootstrap.** The other
160 s is around it and untimed: the queue wait, waking the sprite, fetching
the bootstrap from the pinned commit, the readiness attestation, finalising
the model-key rotation, and the checkpoint the control plane creates after
the script returns (`AISAR_BOOTSTRAP_CONTROL_PLANE=1` moves it out of the
script, so it is not in `stages`). Timing those four or five phases in
`provision.ts` is a small worker change with no runtime release, and it is
the prerequisite for making upgrades faster.

**A cold provision is the bootstrap, and 83% of it is two downloads.** The
Hermes clone plus installer (185 s) and Chromium (72 s). Nothing inside the
script's logic is the problem; the bytes are.

## The smokes stage, and what can overlap

`smokes` runs in this order, all serial: one real inference per configured
model (quick, deep, and each candidate route; three attempts each), the uv
pins for ddgs and Firecrawl, a real web search and extraction, the
computer-use doctor when enabled, recreating the three services, the
readiness poll (1 s ticks, up to 60 s), one real inference through the
gateway (3 s polls), the browser launch, and the `stage_done`.

Only the model, search and browser smokes are independent of each other.
Services, readiness and the gateway inference must follow configure and each
other. Overlapping the independent three saves roughly 10 to 15 s of the
28 s stage.

## The speedups that were not taken

`perf/provisioning-speedups` (c673e5b, 2026-09-02; kept as the tag
`archive/2026-09-11/perf-provisioning-speedups`) proposed two changes to the
bootstrap, measured against a 5.5-minute cold provision at the time:

1. **Skip the patch, `npm install` and audit on a recycled sprite** when the
   pinned commit matches and the patched tree verifies. On today's numbers
   that is the 7 s `npm` stage on upgrades and nothing on a cold provision,
   which has no tree to reuse. The precondition it used (nanoid manifest at
   3.3.18 plus `--verify`) is also too narrow now: `patch-hermes-dependencies.mjs`
   pins eight packages and rewrites API-server files, and its verify mode reads
   the lock it rewrote, so a fail-closed skip needs a new check of the installed
   manifest of every pin.
2. **Run the smokes concurrently** as tracked background jobs. Saves the 10 to
   15 s above. Needs explicit `wait "$pid"` checks, since `set -e` ignores a
   failing background job, and the EXIT trap must clear the per-job logs.

Together: 15 to 20 s of a 203 s upgrade, 10 to 15 s of a 323 s provision, for
a fleet release. The branch was dropped on 2026-09-11 after twelve commits to
the same file had made it a rewrite anyway. If the overlap is ever wanted, it
is an afternoon on today's script plus `ship-runtime.sh`.

## What would actually shorten a cold provision

**Template and fork.** Bootstrap one template sprite per release, checkpoint
it, and create each new business's sprite as a fork of that template. What
remains per business is `configure` and the smokes: about 40 s on today's
numbers instead of 310. Upgrades stay in place, because a business's Hermes
session history and memories live on its sprite and a fork of a fresh
template would not carry them. This needs Fly to expose forking, which they
have not done for customers (below).

**Serve the bytes ourselves.** A prebuilt Hermes tree and a Chromium archive
in R2, fetched and unpacked instead of `git clone` plus the installer and
Playwright's CDN. Self-serve, no dependency on Fly, but a larger change to the
bootstrap than either speedup above, and only worth it if signups are waiting
on the five minutes. `ARTIFACT-STORAGE.md` in the global instructions has the
R2 conventions.

**Pre-provision a spare.** Keep one bootstrapped, unassigned sprite per
release and hand it to the next signup. Bounded by the organisation's limit of
ten concurrent active sprites, which the fleet already exceeds when awake.

## What Fly has said and shipped, as of 2026-09-11

Checked on 2026-09-11 against the newest API reference (`0.0.1-dev`), the CLI
reference, the release notes and the community forum. None of the exchange
with Fly's own people is in the repository; this is the public record.

- **Forking exists only in Fly's internal admin console.** Release notes of
  2 April 2026 ("Admins can now fork an existing sprite's storage at any point
  in time") and 16 April 2026 ("Sprite snapshots, forking, and fork progress
  now work correctly", about 90 s per fork). On 19 May 2026 Fly support wrote
  that "right now, there isn't a forking functionality in general that is
  available"; on 1 July 2026 they called it "one of the most popular requests"
  with announcements to follow.
- **The public API, CLI and SDKs cannot do it.** `POST /v1/sprites` takes a
  name, capacity wait and URL settings; there is no source sprite, checkpoint
  or snapshot parameter. `POST /v1/checkpoints/{id}/restore` is in-place only.
  `sprite create` has `--org`, `--sprite`, `--skip-console`, `--label`. A
  customer who wants to seed a sprite from another today copies the writable
  overlay themselves, which one user reported failing at 723 MB.
- **Custom base images are not planned.** Fly staff, January 2026: not
  supported; the intended path is "build up your base, then fork off of it".
- **The Sprites Block Device is the enabler.** Kurt Mackey, 24 July 2026: SBD
  "enables drive forking: you can create a template Sprite, and then
  efficiently clone millions of times", copy-on-write. Fly's newsletter of
  10 September 2026 says SBD entered private beta and is being rolled out to
  everyone who requested it at fly.io/early-access.
- **Sprites create from a standard container in "a second or two"** and wake
  in about the same; the platform keeps pools of empty sprites ready. The cost
  Jentera pays is entirely what the bootstrap installs afterwards.
- **Concurrency.** Organisations without a plan are limited to ten concurrent
  active sprites; paid levels raise it. See the memory note on the fleet's
  twelve business sprites plus the proof-of-concept.

Sources: [fork-from-checkpoint feature request](https://community.fly.io/t/feature-request-native-fork-sprite-from-checkpoint/28191),
[forking functionality](https://community.fly.io/t/sprites-forking-functionality/27838),
[clone sprite?](https://community.fly.io/t/sprites-clone-sprite/26728),
[base image](https://community.fly.io/t/sprites-base-image/26789),
[one sprite per SaaS customer](https://community.fly.io/t/one-sprite-for-each-saas-customer/28190),
[destroy and restore](https://community.fly.io/t/can-you-destroy-and-restore-a-sprite/26892),
[release notes](https://fly.io/sprites/release-notes/),
[Turn And Face The Strange](https://fly.io/blog/kurt-scott-money-sprites/),
[Design & Implementation of Sprites](https://fly.io/blog/design-and-implementation/),
[API reference, dev-latest](https://docs.sprites.dev/api/dev-latest/),
[CLI commands](https://docs.sprites.dev/cli/commands/).

## What to ask Fly for

1. Fork-from-template through the API or an SDK, not only the admin console,
   with the numbers above: a 310 s cold provision of which 257 s is a clone
   and a browser download that every sprite repeats.
2. SBD private beta access for the organisation, if the request has not gone
   in.
3. Whether a sleeping template sprite and freshly forked sprites count against
   the ten-concurrent limit.

## Re-measuring

```bash
./worker/scripts/stats.sh sql "
with t as (select kind, result->'stages' as st from runtime_task
  where kind in ('provision','upgrade') and status='completed'
    and result ? 'stages' and updated_at > now() - interval '30 days')
select kind, count(*) as n,
  percentile_cont(0.5) within group (order by (st->>'install')::int)    as install_p50,
  percentile_cont(0.5) within group (order by (st->>'npm')::int)        as npm_p50,
  percentile_cont(0.5) within group (order by (st->>'playwright')::int) as pw_p50,
  percentile_cont(0.5) within group (order by (st->>'configure')::int)  as conf_p50,
  percentile_cont(0.5) within group (order by (st->>'smokes')::int)     as smokes_p50,
  percentile_cont(0.9) within group (order by (st->>'smokes')::int)     as smokes_p90
from t group by kind"
```

For the whole-task figure, `updated_at - created_at` on the same rows;
`started_at` and `completed_at` are not populated for provision and upgrade
tasks, which is itself part of the 160 s gap above.
