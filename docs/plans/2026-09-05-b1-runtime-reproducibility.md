# B1 Fix: Runtime Release Reproducibility (Hermes API contract)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the declared runtime release (runner bundle + pinned Hermes `111949b9…`) reproducible from a clean provisioning — the Jentera API patch applies at the pin, and quick/deep model routing actually routes.

**Architecture:** Two independent defects. (B1a) `patch-hermes-dependencies.mjs` anchors on an obsolete `agent_kwargs = {` dict shape that the pinned Hermes commit no longer has (it directly constructs `AIAgent(...)` with kwarg-style args). (B1b) the runner sends `model` + `model_options.reasoning`, but clean Hermes config has no `model_routes` and the pinned API ignores `model_options` — so a clean runtime can report the deep model while executing the default, and quick-mode reasoning suppression is a no-op.

**Tech Stack:** Node.js patch script (`.mjs`), Python bootstrap (`configure-model-provider.py` / `bootstrap-runtime.sh`), pinned Hermes fork (Python), Node test runner (`node --test`), Cloudflare Worker (TypeScript).

**Verification source of truth:** pinned Hermes commit `111949b9750f7dafc8adaf0829de9cc108aa4236` lives in `~/ios/hermes-agent` (fork `qhkm/hermes-agent`, `origin` → qhkm). Every claim below was checked against `git show <pin>:<file>`.

---

## Pre-flight (do first, 5 min)

### Task 0: Synchronize with the dirty working tree

**Objective:** Don't build the fix on top of unrelated WIP.

**Files:** `~/ios/aisar-site` (git repo; NOT the review worktree `/tmp/aisar-arch-review`)

Local `main` has uncommitted, unrelated WIP: runner iteration-progress SSE events + long-task Telegram statuses (bumps `HERMES_PATCH_ID` 2026-09-01 → 2026-09-04, `RUNTIME_RELEASE` → 2026.09.04-2). That is a separate feature — do not fold it into the B1 fix.

**Step 1:** Inspect tip state:

```bash
cd ~/ios/aisar-site && git status --short && git log --oneline -3
```

**Step 2:** Create the B1 branch from the current dirty tree so the fix is isolated:

```bash
git stash push -m "b1-wip-separation" -- runner/bin/patch-hermes-dependencies.mjs runner/src/server.mjs runner/test worker/src/runtime/runner-client.ts worker/src/runtime/consumer.ts
git checkout -b fix/b1-release-reproducibility
```

or, if the WIP is already committed, just branch from it and work on the patch script only.

**Step 3:** Verify the pinned Hermes commit is fetchable for tests (used in Task 4):

```bash
cd ~/ios/hermes-agent && git rev-parse 111949b9750f7dafc8adaf0829de9cc108aa4236
```

Expected: prints the pin. If missing: `git fetch origin` (repo is large; allow time).

---

## B1a: Fix the Hermes API patch anchors (clean install still fails at the pin)

Verified facts (all at pin `111949b9…`, file `gateway/platforms/api_server.py`):

- `agent_kwargs = {` does **not** exist; `_create_agent` constructs `agent = AIAgent(` directly (line 1934), preceded by `user_config = _load_gateway_config()` (line 1931).
- The kwargs block is kwarg-style: lines 1951-1952 `reasoning_config=reasoning_config,` / `gateway_session_key=gateway_session_key,` — NOT dict-style `"reasoning_config": reasoning_config,`.
- `reasoning_config=reasoning_config,` occurs exactly once (line 1951) — unique anchor. `        agent = AIAgent(` (8-space indent) occurs exactly once.
- Pinned `AIAgent.__init__` (run_agent.py:423+) accepts every injected kwarg: `providers_allowed`, `providers_ignored`, `providers_order`, `provider_sort`, `provider_require_parameters`, `provider_data_collection`.

### Task 1: Re-anchor the provider-routing insertion point

**Objective:** Make Stage-1 patch injection target the real `AIAgent(` call instead of the vanished `agent_kwargs = {` dict.

**Files:**
- Modify: `runner/bin/patch-hermes-dependencies.mjs` (function `patchApiServer`, lines ~84-110)
- Test: `runner/test/dependency-patch.test.mjs`

**Step 1 (RED):** Update the fixture in `dependency-patch.test.mjs` so the fabricated `api_server.py` matches the REAL pinned shape:

Replace the fabricated dict block:

```js
'        user_config = _load_gateway_config()',
'        agent_kwargs = {',
'            "reasoning_config": reasoning_config,',
'            "gateway_session_key": gateway_session_key,',
'        }',
```

with the pinned shape:

```js
'        user_config = _load_gateway_config()',
'        agent = AIAgent(',
'            model=model,',
'            **runtime_kwargs,',
'            quiet_mode=True,',
'            reasoning_config=reasoning_config,',
'            gateway_session_key=gateway_session_key,',
'        )',
```

**Step 2 (RED):** Run and confirm the patch-apply test now fails:

```bash
cd ~/ios/aisar-site && node --test runner/test/dependency-patch.test.mjs
```

Expected: FAIL in the routing-marker application ("reviewed Hermes API anchor drifted" with the `agent_kwargs = {` anchor).

**Step 3 (GREEN):** Re-anchor `patchApiServer` in `patch-hermes-dependencies.mjs`:

Old (dict-dict shape):

```js
const configAnchor = '        agent_kwargs = {\n';
const configPatch = [
  `        ${routingMarker}`,
  '        provider_routing = user_config.get("provider_routing") or {}',
  '        if not isinstance(provider_routing, dict):',
  '            provider_routing = {}',
  '',
  configAnchor.trimEnd(),
].join('\n') + '\n';
source = replaceReviewedAnchor(source, configAnchor, configPatch);

const kwargsAnchor = [
  '            "reasoning_config": reasoning_config,',
  '            "gateway_session_key": gateway_session_key,',
].join('\n');
const kwargsPatch = [
  '            "reasoning_config": reasoning_config,',
  '            "providers_allowed": provider_routing.get("only"),',
  '            "providers_ignored": provider_routing.get("ignore"),',
  '            "providers_order": provider_routing.get("order"),',
  '            "provider_sort": provider_routing.get("sort"),',
  '            "provider_require_parameters": provider_routing.get("require_parameters", False),',
  '            "provider_data_collection": provider_routing.get("data_collection"),',
  '            "gateway_session_key": gateway_session_key,',
].join('\n');
source = replaceReviewedAnchor(source, kwargsAnchor, kwargsPatch);
```

New (kwarg-call shape):

```js
const configAnchor = '        agent = AIAgent(\n';
const configPatch = [
  `        ${routingMarker}`,
  '        provider_routing = user_config.get("provider_routing") or {}',
  '        if not isinstance(provider_routing, dict):',
  '            provider_routing = {}',
  '',
  configAnchor.trimEnd(),
].join('\n') + '\n';
source = replaceReviewedAnchor(source, configAnchor, configPatch);

const kwargsAnchor = [
  '            reasoning_config=reasoning_config,',
  '            gateway_session_key=gateway_session_key,',
].join('\n');
const kwargsPatch = [
  '            reasoning_config=reasoning_config,',
  '            providers_allowed=provider_routing.get("only"),',
  '            providers_ignored=provider_routing.get("ignore"),',
  '            providers_order=provider_routing.get("order"),',
  '            provider_sort=provider_routing.get("sort"),',
  '            provider_require_parameters=provider_routing.get("require_parameters", False),',
  '            provider_data_collection=provider_routing.get("data_collection"),',
  '            gateway_session_key=gateway_session_key,',
].join('\n');
source = replaceReviewedAnchor(source, kwargsAnchor, kwargsPatch);
```

Note: `user_config` is already in scope immediately above `agent = AIAgent(` (line 1931), so the injected `provider_routing = user_config.get(...)` lines are valid. The injected kwargs ride into the already-unpacked `**runtime_kwargs` region without colliding (AIAgent accepts all of them as named params).

**Step 4:** Fix the `--verify` gate strings that still look for dict-style injected text:

In the `--verify` block (lines ~58-65), the check:

```js
!apiServer.includes('"provider_sort": provider_routing.get("sort"),')
```

must become:

```js
!apiServer.includes('provider_sort=provider_routing.get("sort"),')
```

**Step 5 (GREEN):** Run the full patch test suite:

```bash
cd ~/ios/aisar-site && node --test runner/test/dependency-patch.test.mjs runner/test/bootstrap.test.mjs
```

Expected: PASS.

**Step 6 (regression, important):** Add a test that runs the patch against a **verbatim slice of the pinned `_create_agent`** (vendored fixture), not a hand-fabricated shape. Extract once:

```bash
cd ~/ios/hermes-agent && git show 111949b9750f7dafc8adaf0829de9cc108aa4236:gateway/platforms/api_server.py | sed -n '1822,1955p' > /tmp/pinned-create-agent.py
```

Copy the region containing `_create_agent` (from `def _create_agent(` through the `return agent` before the HTTP handlers) into `runner/test/fixtures/pinned-api-server-create-agent.py`, and add a test that asserts: patch applies cleanly, `--verify` passes, and the patched output contains `"provider_sort": ` style injections in kwarg form (`providers_allowed=provider_routing.get("only"),`). This makes future Hermes pins fail loudly instead of green-on-fake.

**Step 7:** Commit:

```bash
git add runner/bin/patch-hermes-dependencies.mjs runner/test/dependency-patch.test.mjs runner/test/fixtures/pinned-api-server-create-agent.py
git commit -m "fix(runner): re-anchor Hermes API patch to pinned AIAgent() call shape (B1a)"
```

---

## B1b: Per-request model routing actually routes (and quick/deep is truthful)

Verified facts:

- Runner sends `model: config.modelName | config.deepModelName` and `model_options: { reasoning: {enabled:false|true, effort} }` (`runner/src/server.mjs:347-349`).
- Pinned `/v1/runs` resolves `route = self._resolve_route(body.get("model"))` against config `model_routes`; on a clean provisioning `configure-model-provider.py` writes **no** `model_routes`, so `route` is `None` and the agent falls back to the global default model (`_resolve_gateway_model()`).
- Run metadata records the *requested* model (`model=body.get("model", self._model_name)`), so the UI/status says "deep" while the agent runs the default.
- `model_options` is never read anywhere in pinned `api_server.py` (grep for `model_options` → 0 hits) — quick-mode reasoning suppression (`enabled:false`) is silently ignored.
- `configure-model-provider.py` currently takes `PROVIDER BASE_URL MODEL KEY_ENV [CUA_ENABLED]` — the deep model name is NOT passed in, so it cannot write routes for it.

### Task 2: Write `model_routes` for both quick and deep aliases

**Objective:** Make pinned Hermes' existing `_resolve_route` machinery resolve each request to the right model.

**Files:**
- Modify: `runner/bin/configure-model-provider.py`
- Modify: `runner/bin/bootstrap-runtime.sh` (call site passing `AISAR_DEEP_MODEL_NAME`)

**Step 1 (RED):** Add a unit-style assertion in `runner/test/bootstrap.test.mjs` (or a new `configure-model-provider` test) that the generated config contains `model_routes` with entries for both the quick and deep model ids, each with `model`, `provider`, `base_url`, `api_key` in `${ENV}` form.

**Step 2 (GREEN):** Extend `configure-model-provider.py`:

- Accept a 6th positional arg `DEEP_MODEL` (validate with the same regex as `model_name`; may be empty → then skip deep route).
- After the existing `config["model"] = model` block, add:

```python
existing_routes = dict(config.get("model_routes") or {})
model_routes = dict(existing_routes)
for alias, target_model in (
    (model_name, model_name),
    (deep_model_name, deep_model_name) if deep_model_name else (),
):
    model_routes[alias] = {
        "model": target_model,
        "provider": provider,
        "base_url": base_url.rstrip("/"),
        "api_key": f"${{{key_env}}}",
    }
config["model_routes"] = model_routes
```

**Step 3:** Call-site: in `bootstrap-runtime.sh`, pass the deep model id:

```bash
/.sprite/bin/python3 /home/sprite/aisar/runner/bin/configure-model-provider.py \
  "$provider" "$base_url" "$model_name" "$key_env" "${CUA_ENABLED:-}" "$deep_model_name"
```

(Adjust arg order/quoting to match the current call; the script already validates `deep_model_name` syntax at lines ~118-121.)

**Step 4 (GREEN):** Run bootstrap tests:

```bash
cd ~/ios/aisar-site && node --test runner/test/bootstrap.test.mjs
```

**Step 5:** Commit:

```bash
git add runner/bin/configure-model-provider.py runner/bin/bootstrap-runtime.sh runner/test/bootstrap.test.mjs
git commit -m "fix(runner): write model_routes for quick+deep so /v1/runs routing is truthful (B1b)"
```

### Task 3: Make the model smoke exercise the runner→Hermes contract

**Objective:** The current smoke calls the provider directly and cannot catch routing defects; drive it through `/v1/runs` instead.

**Files:**
- Modify: `runner/bin/model-smoke.py` (or equivalent; find it via `grep -rn "model-smoke\|smoke" runner/bin/`)

**Step 1:** Locate the smoke and confirm its current provider-direct call (`grep -n "openrouter\|chat.completions\|/v1/chat" runner/bin/model-smoke.py*`).

**Step 2:** Add an assertion path that starts a run via `/v1/runs` with `model=<deep model id>` and verifies the run status `/v1/runs/{id}` reports the requested model AND that the agent responded using it. Minimal truthful signal available at the pin: the run status `model` field (`_set_run_status(..., model=body.get("model", ...))`) + the reasoning patch's `reasoning` field presence. Assert `response.model == requested` for both quick and deep ids (a degraded runtime that silently reroutes will report the mismatch via the `model` field only if the API echoes the executed route — if the pin's status only echoes the request, at minimum assert the deep request's *route* was resolved by checking `/v1/models` lists both aliases from `model_routes`).

**Step 3:** Run it against a local staged Hermes (see Task 4 for the staging recipe):

```bash
cd ~/ios/aisar-site && node --test runner/test/server.test.mjs && /.sprite/bin/python3 runner/bin/model-smoke.py --local
```

**Step 4:** Commit:

```bash
git commit -am "test(runner): smoke quick/deep routing through /v1/runs, not provider-direct (B1b gate)"
```

---

## Validation gate: clean-install and upgrade tests against the exact artifact

### Task 4: Add a clean-install + upgrade contract test against the pinned commit

**Objective:** Release pins are gated on patch-apply + `--verify` succeeding against the *declared* Hermes commit — and on an upgrade path from the previous patched state.

**Files:**
- Create: `runner/test/clean-install.test.mjs`
- Modify: `runner/package.json` (test script / CI hookup) or the existing npm test runner config

**Step 1:** Write the test: create a temp dir, `git clone`/`git archive` the pinned commit (or `cp -R ~/ios/hermes-agent` + `git checkout <pin>`), run `patch-hermes-dependencies.mjs <dir>`, then `<dir> --verify`. Assert exit 0. Then run the patch a second time to assert idempotency (upgrade path: already-patched tree stays patched, no drift).

**Step 2:** For the true upgrade path, additionally fabricate the *previous* patched state by applying the pre-fix patch script (from `git show HEAD~2` or the stash of Task 0) to a pinned checkout, then apply the new script and assert `--verify` passes and markers migrate.

**Step 3:** Wire it into the release procedure: the runner release checklist (and any CI hint in `runner/package.json`) must run `node --test runner/test/clean-install.test.mjs` before a new `RUNTIME_RELEASE`/`HERMES_PATCH_ID` pin is allowed to ship.

**Step 4:** Commit:

```bash
git add runner/test/clean-install.test.mjs runner/package.json
git commit -m "test(runner): gate release pins on clean-install+upgrade contract tests (B1 gate)"
```

---

## Sequencing / release

### Task 5: Cut the B1 release

**Objective:** Ship as its own release id so deployed sprites can be told apart.

**Files:** `worker/wrangler.toml` (`RUNTIME_RELEASE`, `HERMES_PATCH_ID`), `worker/src/runtime/runner-client.ts` (`HERMES_PATCH_ID`), plus the runner bundle commit.

**Step 1:** Bump to the next release id (follow the existing scheme; do not guess — read `worker/wrangler.toml` and `runner-client.ts` for the current id first).

**Step 2:** Run the complete test suite:

```bash
cd ~/ios/aisar-site && node --test runner/test/ && npm test --prefix worker 2>/dev/null || true
```

**Step 3:** Stage on a scratch sprite (never a live sprite): deploy the new bundle to one non-production sprite, run Task 3's smoke, and confirm `/health` shows `"jentera_patch"` + healthy `img` status.

**Step 4:** Commit and push the branch; report to the user with the release id, the new Hermes pin expectation, and the staged-sprite evidence before any fleet rollout (fleet rollout requires explicit user confirmation per standing policy).

---

## Open items (explicitly NOT in this hotfix)

- `model_options.reasoning.enabled:false` still cannot suppress reasoning on the pinned API (no `model_options` handling upstream). Quick mode now correctly *routes* to the quick model (Task 2); suppressing its reasoning requires a Hermes fork change (accept `model_options` in `/v1/runs` → per-run `reasoning_config`) + re-pin → follow-up release. Do not attempt in this branch.
- The `agent.reasoning_overrides[model_name] = "high"` line in `configure-model-provider.py` keys on the quick model id; Task 2 routes deep requests to the deep id, which has no override today — if deep needs `"high"` (or model-specific effort), add it in the same follow-up after confirming the quick/deep routing evidence.

## Verification recap

- `node --test runner/test/` — all green, including the new vendored-pinned-fixture regression.
- `patch-hermes-dependencies.mjs <pinned-checkout> && <pinned-checkout> --verify` exits 0 (the exact command that is failing today).
- Staged sprite: quick and deep `/v1/runs` requests resolve different `model_routes` entries; `/health` shows the B1 release id; smoke passes through the runner (not provider-direct).
