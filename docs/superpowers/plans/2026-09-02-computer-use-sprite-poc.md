# Computer-Use on a Sprite — POC Plan

> **Status:** Plan + research complete. Awaiting go-ahead to execute the spike.
> **Owner:** AISAR / Jentera runtime
> **Date:** 2026-09-02

**Goal:** Prove that a Jentera per-business Sprite (Hermes on headless Linux) can **see a computer screen** — a real desktop GUI on a virtual display — and drive it (click, type, verify) through Hermes's built-in `computer_use` tool, using the pinned text-only main model plus a vision-capable auxiliary model.

**Architecture:** Keep the existing one-Sprite-per-business shape. Add a **virtual X11 display (Xvfb)** + minimal window manager + `at-spi2-core`/dbus to the Sprite OS layer. The agent then uses the **already-shipped Hermes `computer_use` tool** (cua-driver backend) to capture the virtual screen (`som`/`ax` modes), click by element index, type, and re-capture. Screenshots are routed to an **auxiliary vision model** (`deepseek/deepseek-v4-flash-vision-exp`) because the pinned main model (`deepseek-v4-flash-0731`) is text-only — Hermes's `vision_routing.py` already does exactly this fallback.

**Tech stack:** Hermes v2026.8.19 (pinned, contains `tools/computer_use/`), cua-driver (trycua/cua, Linux X11 backend), Xvfb, openbox, at-spi2-core, dbus, Ubuntu Sprite image, OpenRouter (`deepseek-v4-flash-vision-exp`).

---

## 1. Research findings (verified 2026-09-02)

### 1.1 Hermes already ships computer use — no custom driver needed

- `tools/computer_use/` (tool.py, cua_backend.py, doctor.py, vision_routing.py, permissions.py) is **in the pinned Hermes tag `v2026.8.19`** (verified via `git ls-tree` on the tag; computer-use was merged 2026-07-23, PR #69909).
- It drives **cua-driver** (https://github.com/trycua/cua) over MCP stdio. Linux backend = **X11 today** (AT-SPI tree; Wayland via XWayland; pure-Wayland incomplete upstream).
- Missing pieces surface as blocked checks in `hermes computer-use doctor` (e.g. no `DISPLAY`, missing AT-SPI) — fail loud, not silent.
- Official skill: `skills/computer-use/SKILL.md` (v2.0.0) — capture → click-by-index → verify workflow, `som`/`vision`/`ax` capture modes, the verify→escalate ladder, hard safety rules.

### 1.2 The vision problem is already solved by `vision_routing.py`

- Pinned main model `deepseek/deepseek-v4-flash-0731` is **text-only** (`modalities: ["text"]` on OpenRouter).
- OpenRouter has `deepseek/deepseek-v4-flash-vision-exp` — `["text", "image"]`, same model family/latency class.
- Hermes `vision_routing.py` (in v2026.8.19): when the active main model is non-vision, capture screenshots are **routed through the auxiliary vision pipeline** (`auxiliary.vision` config) and the main model receives a text description. It fails **closed** toward aux routing when metadata is ambiguous. So: configure `auxiliary.vision` → vision-exp and the text-only main model can act on screenshots. `ax` mode (accessibility tree only) needs no vision at all — the POC can run a text-only lane as an extra gate.

### 1.3 Sprite fleet facts

- `sprite` CLI v2026-08-21 works locally; org **`aisar`** (fly.io login qhkmdev90@gmail.com) → `https://api.sprites.dev`.
- Fleet: **8 sprites** (2 warm), all `aisar-b-*`. Production canary = `aisar-b-c679d9df0aaa77ba1ec7` (I Run Cafe, warm). ⚠️ **POC must use a fresh throwaway Sprite — never the canary.**
- `sprite exec` runs commands in a Sprite (WebSocket or `--http-post`), `sprite file` uploads, `sprite checkpoint` manages snapshots, `sprite create` provisions.
- Sprite platform image is Ubuntu 26.04-based (`0.0.1-rc48`), apt available (bootstrap already repairs Playwright deps with apt).

### 1.4 The `hermes-api-server` toolset does NOT include `computer_use` today

- `toolsets.py` → `hermes-api-server` lists web/terminal/files/vision/browser/todo/memory/session_search/execute_code/delegate_task/cronjob/HA — **no `computer_use`**.
- The Jentera runner pins `platform_toolsets.api_server = hermes-api-server` + HA opt-in, and the Worker grants "the pinned Hermes API-server tool bundle".
- **Consequence:** for the POC we enable `computer_use` directly in the dev Sprite's Hermes config (operator-level). Shipping it for customers additionally requires: adding `computer_use` to the grant/toolset (Worker + runner change) — tracked as the production path below. The POC proves the OS + vision loop first.

---

## 2. Approach decision

| Option | What it is | Verdict |
|---|---|---|
| **A. Hermes `computer_use` + cua-driver + Xvfb** | Built-in tool, AX-tree + SOM overlays, any tool-capable model, ax-mode for text-only, active upstream (trycua/cua) | ✅ **Chosen** — least custom code, most robust clicks (element indices), vision routing already handled |
| B. Hand-rolled Xvfb + scrot + vision_analyze + xdotool | No cua-driver dependency; ~100+ lines of custom glue; pixel-coordinate clicking; no AX tree | ❌ Rejected — reinvents cua-driver, fragile clicks, more code to maintain |
| C. Browser-only (`browser_*` tools) | Already available on Sprite; headless Chromium | ❌ Wrong scope — proves web, not "computer screen" |
| D. VNC/noVNC human-view | Human remote desktop | ❌ Not agent-autonomous |

**What we add to the Sprite OS:** `xvfb`, `openbox` (minimal WM), `at-spi2-core`, `dbus`, `x11-utils`, `xdotool` (diagnostics), `scrot` (diagnostics), and `cua-driver` (install script). Display `:99`.

---

## 3. Spike decomposition (feasibility gates)

| # | Gate | Given / When / Then | Kills idea if… |
|---|------|---------------------|----------------|
| M0 | **Doctor passes under Xvfb** | Given Xvfb + WM + AT-SPI running on a fresh Sprite, when cua-driver is installed and `hermes computer-use doctor` runs, then X11/AT-SPI/driver checks all pass | Doctor can't pass on the Sprite image |
| M1 | **Capture works** | Given a GUI app on display :99, when `computer_use(capture, mode="som")` runs, then a screenshot + numbered AX index return | Capture returns empty / "no on-screen window" |
| M2 | **See + drive loop** | Given vision-exp as `auxiliary.vision`, when the agent captures, describes, clicks an element, types, and re-captures, then the described screen state changes | vision-exp can't describe the screenshot reliably |
| M3 | **Canned end-to-end task** | Given a task through the Sprite's Hermes API-server (runner path) with `computer_use` enabled, when the task is "open X app, type Y, verify", then it completes with captured proof | Worker/runner path can't carry the tool |

Order = risk: M0 first (cheapest kill), M3 last.

---

## 4. Task-by-task steps

### Task 1: Provision a throwaway POC Sprite

```bash
sprite create aisar-poc-cu            # org aisar; confirm it appears in sprite list
sprite use aisar-poc-cu               # or pass -s aisar-poc-cu to every command
```

- ⚠️ Rule: **never** `-s aisar-b-c679d9df0aaa77ba1ec7`. Create fresh; destroy after verdict.
- Verify: `sprite exec -s aisar-poc-cu -- uname -a` and `cat /etc/os-release`.

### Task 2: Install the X11 desktop stack on the Sprite

```bash
sprite exec -s aisar-poc-cu -- apt-get update
sprite exec -s aisar-poc-cu -- apt-get install -y xvfb openbox at-spi2-core dbus \
    x11-utils xdotool scrot imagemagick xterm
```

- Add the pinned Hermes + runner bootstrap if not already on this Sprite — reuse existing `runner/bin/bootstrap-runtime.sh` from the repo (it is deterministic and reconciles).
- Verify: `sprite exec -- which Xvfb openbox cua-driver || true` (cua-driver comes next).

### Task 3: Install cua-driver

Try the upstream install script (same one macOS uses):
```bash
sprite exec -s aisar-poc-cu -- /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
```
- Verify: `sprite exec -- cua-driver --version` and `cua-driver mcp` starts.

### Task 4: Start the virtual display as a service

Mirror the existing runner service pattern (`runner/bin/hermes-service.sh` / `runner-service.sh`):
- systemd-style launch: `Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp`
- `dbus-run-session` wrapping the WM + Hermes (AT-SPI needs a session bus)
- `DISPLAY=:99` exported for the Hermes service env
- verify with `DISPLAY=:99 xdpyinfo | head -5` and `xterm -e true`

### Task 5: Enable computer_use + aux vision in the Sprite Hermes config

Patch `~/.hermes/config.yaml` on the Sprite (dev Sprite only):
```yaml
auxiliary:
  vision:
    provider: openrouter
    model: deepseek/deepseek-v4-flash-vision-exp
    base_url: https://openrouter.ai/api/v1
computer_use:
  cua_telemetry: false
  permissions: unrestricted   # dev-only; standard/bounded for anything customer-facing
```
- Note: OpenRouter key must be in the Sprite's mode-0600 runtime env (existing pattern).
- Verify: restart Hermes; `hermes computer-use doctor` → all green.

### Task 6: M1 — capture a real app

Start a GUI app (e.g. `DISPLAY=:99 xterm` or `gedit` if installable), then via the Hermes API-server:
`computer_use(action="capture", mode="som", app="...")` — expect numbered overlays + AX index.
Save the screenshot to a file for evidence.

### Task 7: M2 — see-and-drive loop (text-only + vision lanes)

1. `capture mode=ax` → main model (text-only) reads AX tree, clicks element by index.
2. `capture mode=som` → aux vision (vision-exp) describes screen; main model acts on description.
3. Loop: click → type → capture_after → verify state changed. Keep evidence PNGs.

### Task 8: M3 — end-to-end through the runner (if time-box allows)

Enable `computer_use` in the dev Sprite toolset grant (runner/Worker side is out of POC scope — see §7) and run a canned task via the existing smoke flow (`runner/bin/task-smoke-sprite.sh` style): "Open xterm, type `hello from jentera`, take a screenshot." Verify output + saved screenshot.

### Task 9: Verdict + teardown

Write verdict in a `spikes/2026-09-02-computer-use-xvfb/README.md` (repo root), destroy the Sprite:
```bash
sprite destroy aisar-poc-cu
```
Verdict format: VALIDATED / PARTIAL / INVALIDATED per gate, with evidence paths and recommendations.

---

## 5. Files likely to change (after POC, if it goes to production)

- `runner/bin/bootstrap-runtime.sh` — add Xvfb/openbox/at-spi packages + DISPLAY service + `auxiliary.vision` + computer_use toolset enablement (guarded, POC-flag until gated)
- `worker/src/runtime/*` — signed grant tool bundle: add `computer_use` (+ `hermes_computer_use`-related actions) to the canary capability set
- `worker/src/.../toolset pins` — extend `hermes-api-server` toolset coverage check
- `docs/superpowers/specs/2026-08-26-hermes-sprites-runtime.md` — runtime capability section (new "desktop GUI" capability)
- Safety docs: computer_use permission mode policy (bounded), screenshot retention, what leaves the Sprite (screenshots must NOT cross the runtime boundary unless explicitly delivered as artifacts)

## 6. Validation / acceptance

- M0–M3 gates pass with evidence (doctor output, screenshots, task transcript).
- Vision lane: vision-exp accurately describes screen contents ≥ 2 consecutive captures with a real app.
- Text-only lane: ax-mode click lands with `effect: "confirmed"` (or successful escalate per the ladder).
- No production resources touched; throwaway Sprite destroyed after verdict.
- Runtime cost noted: capture ≈ 1 extra aux-vision call per screenshot (cheap; flash-class).

## 7. Risks & open questions

- **cua-driver under Xvfb** (compositor-less): openbox + dbus session should satisfy AT-SPI; this is the #1 POC risk → M0/M1 test it first. Fallback: `xdotool` for input + `scrot`/`import` capture + `vision_analyze` (option B) if cua-driver won't cooperate — still validates the "see the screen" question.
- **vision-exp is experimental**: quality unknown on dense UIs. `ax` mode is the escape hatch that needs no vision.
- **Pinned Hermes on the Sprite is v2026.8.19** — verified the `tools/computer_use/` package exists in the tag; runtime behavior under the Sprite's exact service env must still be proven (that IS the POC).
- **Bootstrap coverage check** tolerance for an extra toolset entry — verify when enabling computer_use in config; if it hard-fails on drift, enable via a dedicated dev toolset instead.
- **Security:** `computer_use` gives the agent real GUI input. For production: keep `permissions: bounded`, gate `computer_use` behind the signed grant (never unrestricted), screenshots are sensitive artifacts — decide retention + whether they may leave the Sprite (default: no, except explicit artifact delivery).
- **Cost:** Xvfb idle ≈ negligible; each screenshot = 1 aux vision call (flash pricing).

## 8. Open production path (after VALIDATED)

1. Extend Worker signed-grant + runner attestation to include `computer_use` (capability-gated, canary first).
2. Bootstrap change: install X11 stack + start display service on customer Sprites; keep it cheap (only run Xvfb on demand / when a computer-use task starts? — decision: always-on vs wake-on-demand).
3. Add computer_use permission-mode policy + approvals to the Control layer.
4. Spec update + security audit pass (screenshot handling).
