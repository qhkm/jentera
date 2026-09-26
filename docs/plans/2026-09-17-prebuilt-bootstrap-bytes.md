# Serving the bootstrap's bytes ourselves

Status: **not built; not needed on the evidence of 27 September.** The failures
this set out to remove were read from a query that counted almost any early
failure as `STAGE:install` (the marker prints before anything runs). By the
stage each sprite actually reported, the 14 days to 27 September hold 39
install-stage failures, 38 of them the 18 September tag incident, against 524 at
`downloads` from three sprites Fly could not wake and 438 at `checks` from
release-wide failures. Nothing in that points at the third-party downloads this
plan replaces; `docs/todo.md` ("Setup failures, read by the stage they failed
at") has the query. Other parts are stale too: the runner bundle already comes
from R2 on a signed ticket (`routes/runtime-bundle.ts`), the Chromium half was
answered by the 18 September measurements (`docs/chrome-*-2026-09-18.md`), and
`qhkm/hermes-agent` stays public. Revisit only if install-stage failures come
back.

Original status: proposal, 17 September 2026. No code. Read
[`provisioning-time.md`](../provisioning-time.md) first — it holds the
measurements this argues from.

## The case

A cold provision is 285–325 s created to ready, and **257 s of it is two
downloads from third parties that every sprite repeats**:

| Stage | Cold | What it does |
|---|---|---|
| `install` | 185 s | Fetches the Hermes installer from `raw.githubusercontent.com`, verifies its SHA-256, runs it; the installer clones and checks out the pinned commit and installs dependencies |
| `playwright` | 72 s | `node playwright/cli.js install --with-deps chromium` — Chromium from Playwright's CDN, plus its apt dependencies |

Everything else — `npm` 11 s, `configure` 7 s, `smokes` 35 s — is 53 s
together.

## It is also the fleet's most common failure point

Measured 17 September 2026, and this is the stronger argument:

- **16 Sep 00:52-00:59 — 12 upgrade tasks across 10 businesses exhausted** at
  attempt 8. Two errors, both inside `install`: `pinned Hermes dependencies
  (nanoid, undici, postcss, react-router…)`, and Playwright reporting the host
  is "not officially supported… downloading fallback build for
  ubuntu24.04-x64".
- **17 Sep 17:51 — a provision exhausted the same way**, then succeeded
  unattended at 18:00 and reached `ready` on `2026.09.17-4`.
- **15 Sep 16:28-18:16 — five `owner.ask` runs failed** on Kitakod Ventures
  with `runtime task exceeded its time limit before Hermes started`, no
  `work.started` event at all, hours before the upgrade failures above. The
  sprite could not come up, so the asks never reached it.

It exhausts eight attempts and then works minutes later, which is the
signature of an upstream fetch being briefly unavailable rather than anything
wrong on the sprite. That is what a `git clone` from GitHub plus a Chromium
download from Playwright's CDN buys: two third parties that both have to be up
at the moment a customer signs up, on the one stage that is 60% of the wall
clock.

So the case is not only that `install` is slow. **It is the stage that fails.**
Prebuilt bytes in R2 replace two external dependencies with one we control and
already depend on for artifacts.

The durable fix is Fly's: fork a bootstrapped template per release, leaving
only `configure` and the smokes. That needs the Sprites Block Device, which
was in private beta as of 10 September and is not exposed through the API.
**This proposal is what can be done without waiting for Fly**, and it is
independent of forking: if SBD arrives, this becomes redundant and should be
deleted rather than kept alongside.

## The shape

Build the bytes once per release, put them in R2, and have the bootstrap fetch
and unpack instead of clone and download.

Two artifacts, keyed by exactly what determines their contents:

- `runtime/hermes/<commit>.tar.zst` — the installed Hermes tree for the pinned
  commit, after dependency install and patching, before any per-business
  configuration.
- `runtime/chromium/<playwright-version>-<platform>.tar.zst` — the Playwright
  browser directory for `ubuntu24.04-x64` and `ubuntu24.04-arm64`.

`ship-runtime.sh` already pins `RUNTIME_BUNDLE_COMMIT` and bumps
`RUNTIME_RELEASE`. Building and uploading these belongs in the same place, as
a step that runs before the pin is written — a release whose artifacts are
missing must not be pinnable.

## What makes this safe rather than a new class of outage

**Integrity is not optional and the precedent already exists.** The bootstrap
verifies the Hermes installer against `hermes_installer_sha256` and exits 1 on
a mismatch. Prebuilt artifacts get the same treatment: a `MANIFEST.json` beside
them carrying sha256 and size per object, the digest checked after download and
before unpack, and a mismatch is a hard failure, never a warning. This is the
convention in `ARTIFACT-STORAGE.md`; it also records that `wrangler r2 object
put` without `--remote` writes to a local simulator and exits 0, which is how
twelve uploads once "succeeded" into nothing. Verify a release's upload by
fetching a byte range back, not by exit code.

**The slow path stays, and failure falls back to it.** If the fetch fails, the
digest mismatches, or the manifest is absent, the bootstrap does what it does
today: clone and download. A provision that takes five minutes is a bad day; a
provision that fails because R2 was unreachable is an outage we introduced.
The fallback must be exercised in the release gate, not assumed — flip the URL
to something unreachable and confirm the sprite still reaches ready.

**The artifacts are private.** `qhkm/hermes-agent` is not public, so these
objects must not be either. That rules out a public `r2.dev` URL and means the
worker mints a short-lived presigned GET at provision time.

**Which drags in the ordering rule, and this is the part that bites.** A
presigned URL reaches the sprite as a field in `provision.ts`'s `transfer`,
and those fields are parsed by `bootstrap-runtime.sh` against a **closed
allowlist that exits 1 on anything else** — from the bundle at
`RUNTIME_BUNDLE_COMMIT`, not from whatever is on the sprite's disk. On
2026-09-10 `EXTRACT_BASE_B64` went out in a worker deploy while the pinned
bundle had no matching arm: every sprite rejected the transfer, upgrade tasks
retried to exhaustion, and convergence stalled until the field was withdrawn.
So: **add the arm, pin a bundle containing it, then deploy a worker that sends
the field.** `check-transfer-fields.mjs` runs as `predeploy` and blocks exactly
this mismatch.

## What this does not fix

- **`--with-deps` installs apt packages**, and a tarball of the browser
  directory does not carry them. Measure the split before assuming 72 s is
  recoverable: if the apt half dominates, the answer is a base layer with the
  dependencies already present, which is a different piece of work.
- **Upgrade *speed*, which is the common case.** 191 upgrades to one cold
  provision over the 30 days to 2026-09-11. Upgrades are 203 s p50 and already
  reuse the tree, so on time alone this proposal barely touches them.

On reliability it does touch them, and that changes the balance. Ten of the
twelve exhausted tasks on 16 September were **upgrades**, failing in `install`
for the same reason a cold provision does — the upgrade path re-runs the
installer against the pinned commit, so it depends on the same two third
parties. Prebuilt bytes remove that dependency from every release, not only
from a new customer's first five minutes.

So the honest position is narrower than "wait for signups to be gated": on
speed this is a first-impression fix and can wait; on fleet convergence it is
a fix for the thing that most recently stalled a release.

## Sequence

1. Measure the `--with-deps` split inside the `playwright` stage, and time an
   unpack of each artifact on a sprite. If the saving is under ~120 s, stop
   here and wait for SBD.
2. Add the `transfer` arms to `bootstrap-runtime.sh` — fetch, verify, unpack,
   fall back — with the fields unused. Pin a bundle carrying them.
3. Add artifact build and upload to `ship-runtime.sh`, before the pin, with a
   round-trip verification of the upload.
4. Deploy a worker that mints the presigned URLs and sends the fields.
5. Re-measure a cold provision against the figures in `provisioning-time.md`,
   and force a fetch failure to prove the fallback.

## Cheaper things worth doing first

Neither needs R2 and both improve the thing the owner actually complained
about:

- **Weight the progress bar by measured stage duration** rather than stage
  count, and name the running stage. `install` is 60% of the wall clock and
  currently shows nothing between its start and its end, which is why a
  healthy provision reads as stuck at ~25%.
- **Ask Fly for SBD private-beta access**, quoting the number: 310 s of which
  257 s is a clone and a browser download that every sprite repeats. The
  concurrency objection to a sleeping template is gone since the Hero upgrade
  raised the limit from 10 to 100.
