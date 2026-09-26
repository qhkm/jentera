# Specialists Hand Work To Each Other — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chief of Staff, and specialists within limits, hand part of a task to another specialist. That specialist works in its own Hermes profile inside the caller's turn, and the owner reads one combined answer that credits each part.

**Architecture:**
- A new Hermes tool, `ask_specialist`, lives in our fork's `plugins/jentera`. It asks the runner on loopback.
- The runner's new `HandoffEngine` does three things:
  - enforces depth, count, loops, one-at-a-time and time;
  - runs the specialist's turn at `/p/<profile>/v1/runs` while the caller waits, relaying its tools and approvals into the task's stream, marked with the specialist;
  - returns the answer as the tool's result.
- The control plane decides who may hand off (a per-business switch), writes what the agents are told, records hand-off events, and names specialists on steps, approvals and "Who's working on this".

**Tech Stack:** Node 22 (runner, `node:test`), Python 3.12 (Hermes fork, pytest via `scripts/run_tests.sh`), TypeScript Cloudflare Worker (vitest, real Postgres in Docker), React/Vite app (vitest, jsdom).

**Spec:** [`docs/plans/2026-09-26-specialist-handoff.md`](2026-09-26-specialist-handoff.md). Read it first; this plan argues from it.

## Rulings against the spec

These were decided while reading the code, and each is binding for this plan.

1. **The tool is offered per business, not per task.**
   - **Why:** Hermes caches each tool's availability check for 30 s, and keeps answering "yes" for up to 60 s after a recent yes (`tools/registry.py` `_CHECK_FN_TTL_SECONDS`, `_CHECK_FN_FAILURE_GRACE_SECONDS`). A per-task answer would be stale either way.
   - **What instead:** The switch travels in the runner's config document as `handoff: { enabled: true }`, and the tool's check reads it. The runner still refuses any call from a task that carried no hand-off limits, such as a quick reply, with code `unavailable`.
   - **Cost if wrong:** within 30 s of a switch change, a model may see the tool and be refused.
2. **No `approval_expired` code.**
   - **Why:** When an approval goes unanswered, the Worker's existing timeout path answers it as a denial (`HERMES_APPROVAL_WAIT_SECONDS`). The specialist's own turn receives that denial and reports it in its answer.
   - **What instead:** The runner's codes are `unavailable`, `unknown_specialist`, `loop`, `limit_depth`, `limit_count`, `time`, `budget`, `failed` and `stopped`.
3. **The start body carries limits and a preamble, not the roster.**
   - **Why:** Each specialist's name, remit and owner instructions already reach the runner through the config document (`specialists`). Sending them again per task would push a start body past the runner's 64 KB limit.
   - **What instead:** The start body carries `handoff: { maxDepth, maxHandoffs, preamble }`. The Worker writes the preamble, including who asked; the runner appends the remit from the document. Both come from the control plane, so the spec's "the runner never writes a specialist's instructions itself" still holds.
4. **Hand-offs are queued per calling run, not per task.**
   - **Why:** A per-task queue deadlocks at depth 2. The specialist's own request would wait behind its caller's hand-off, which is waiting on that specialist.
   - **What instead:** Every caller up the chain is blocked inside its tool call, so a per-caller queue still means one specialist works at a time.
5. **Specialist usage is kept in the runner's memory for the task's life.**
   - **Cost if wrong:** a runner restart mid-task undercounts that task by its specialists' tokens.
   - **Mitigation:** the root run's usage is still reported, and a restart already loses the hand-off itself. `docs/todo.md` carries it as a follow-up.
6. **Steps carry the specialist's name as a prefix, `⟦Name⟧ `, on the step string.**
   - **Why:** It keeps `AskAnswer.steps: string[]`, the live `status` detail and `agent.tool` payloads in their current shapes.
   - **Old app builds:** they still classify the tool part correctly and show no name.
   - **Where it's written and read:** only in `worker/src/handoff.ts` (`agentStep`) and `app/src/lib/task-presentation.ts` (`splitAgentStep`).
7. **`ask_specialist`'s own step never carries a preview.**
   - **Why:** Hermes builds the preview from the tool's arguments, and that is the brief.
   - **What instead:** The runner blanks it the same way it blanks `execute_code`.
8. **The runner learns about exhausted credits when the specialist's first model call fails.** It does not check before the hand-off starts.
   - **Why:** The runner cannot read the budget. The model proxy refuses the call with `budget_exceeded`, and the engine maps that failure to code `budget`.
   - **Cost:** one refused model call.
9. **"Activity shows which specialists took part" is met through the task detail.** An Activity row opens the task detail, which mounts the same "Who's working on this" chip. The Activity list rows themselves do not change.

## Global Constraints

- **Limits:** at most 2 levels (Chief of Staff → specialist → specialist), at most 5 hand-offs per task, one specialist working at a time.
- **Time per hand-off:** `min(time left in the task − 60 s, 390 s)`. Less than 15 s left means refuse with `time`. The task keeps its 15-minute cap.
- **The brief:** at most 2,000 characters. It is never stored, never on a stream, never shown to the owner.
- **Specialist steps:** redacted by the same runner rules as today (`commandProgram`, `safeToolPreview`, tool results stripped). Only tool starts, tool completions and approvals cross. The specialist's answer text, reasoning and iterations do not.
- **Approvals:** the same gate; every approval from a specialist names it.
- **Credits:** specialist token usage is added to the task's reported usage.
- **The switch:** `HANDOFF_ENABLED = "true"` plus `HANDOFF_BUSINESS_IDS`, exact UUIDs, comma-separated, empty meaning nobody. It ships empty.
- **Release order:** app → runtime release (Hermes tag, pin, runner) → Worker with the switch empty → switch on for Kitakod.
- **No new bootstrap transfer field.** The runner reads the existing `HERMES_API_KEY`; the tool reads the existing `API_SERVER_KEY`.
- **Text:** English and Bahasa Malaysia together, every time.
- **House rules (`CLAUDE.md`):**
  - Stage named paths; never `git add -A` or `git add .`.
  - Conventional Commit subjects, one visible behaviour per commit.
  - TypeScript: two-space indent, semicolons, single quotes.
  - Import through `@/` in `app/`.

## Review Focus

1. **The model names a specialist by display name** ("Finance and records") instead of its key (`records`). Expected: refused with `unknown_specialist`, not a crash. Pinned in Task 3.
2. **The owner stops the task while a specialist is working.** Expected: the specialist's run is stopped, and the caller's tool call returns `stopped` at once instead of hanging for up to 390 s. Pinned in Tasks 3 and 4.
3. **The runner is unreachable or restarts mid-hand-off.** Expected: the tool returns `failed`, and the caller reports the part as missing. Pinned in Task 2.
4. **A quick reply still sees the tool** during Hermes's 30 s cache. Expected: refused with `unavailable`, with no specialist run started. Pinned in Task 3.
5. **A brief that contains a password or token.** Expected: it appears nowhere on the task's stream, in `agent.tool`, or in the popover. Pinned in Tasks 3 and 4.

## File map

| Where | File | Responsibility |
|---|---|---|
| Hermes fork | `plugins/jentera/handoff.py` (new) | The `ask_specialist` tool and its availability check |
| Hermes fork | `plugins/jentera/__init__.py`, `plugin.yaml` | Register it beside `business_records` |
| Runner | `runner/src/handoff.mjs` (new) | `HandoffEngine`: limits, the nested run, relay, stop, usage |
| Runner | `runner/src/server.mjs` | Routes, config switch, registration, approval routing, stop cascade, usage, preview blanking |
| Worker | `worker/src/handoff.ts` (new) | Switch, limits, preamble, instructions, step prefix, status lines, durable record |
| Worker | `worker/src/runtime/config-document.ts`, `routes/runtime-config.ts` | `handoff` in the config document |
| Worker | `worker/src/runtime/run-task.ts`, `runner-client.ts` | Start body field, new stream event, `agent` on events |
| Worker | `worker/src/runtime/consumer.ts`, `routes/runs.ts`, `ask.ts`, `specialists.ts` | Instructions, relay, Telegram, approvals |
| Worker | `worker/src/runtime/tasks.ts`, `routes/runtime.ts` | `agent` on a runtime approval |
| Worker | `worker/src/coordination.ts`, `runs.ts` | `agent.handoff` event, `handoffs` in "Who's working on this" |
| App | `app/src/lib/task-presentation.ts`, `components/LiveTaskProgress.tsx`, `components/AskReply.tsx`, `styles/ask.css` | Specialist tag on steps, helper label |
| App | `app/src/components/TaskCoordination.tsx`, `components/RuntimeApprovalCard.tsx`, `routes/views/RunTrace.tsx`, `lib/repo/types.ts`, `i18n/pages.ts`, `lib/data/i18n.ts` | Popover, approval card, trace label, text |

**Where to work:**
- **This repository:** branch `specialist-handoff-spec` in the `wake-copy` worktree, which carries the spec. Rebase it onto `origin/main` before Task 3.
- **The Hermes fork:** a `wt` worktree in `~/ios/hermes-agent` whose branch starts at tag `v2026.9.22` (commit `929f477c`), the release production pins.

---

### Task 1: Prove an approval round trip inside a nested run (gate)

The feasibility test on 26 September had no approval in it. Before building on approach B, prove that an approval raised inside a specialist's run can be answered through that run and lets it finish. **This is a gate:** if it fails, stop and return to the spec, where approach A is the fallback. Nothing from this task is committed except the result.

**Files:**
- Create (throwaway, scratchpad only): `handoff-spike/` as below
- Modify: `docs/plans/2026-09-26-specialist-handoff.md`, adding a line under "Feasibility test"

- [ ] **Step 1: Build the harness.** Use a scratch folder, `$S`, in your session's scratchpad.

```bash
S=<scratchpad>/handoff-spike && rm -rf $S && mkdir -p $S/hermes $S/home/profiles/records
cd ~/ios/hermes-agent && git archive 929f477c30773e0efa3983bf7074695f6e51dd5c | tar -x -C $S/hermes
cd $S/hermes && uv venv -q --python 3.12 .venv && uv pip install -q --python .venv/bin/python -e '.[messaging]'
for d in memories sessions skills skins logs plans workspace cron home; do mkdir -p $S/home/profiles/records/$d; done
```

Write `$S/home/config.yaml`:

```yaml
model:
  default: mock/model
  provider: openrouter
  base_url: http://127.0.0.1:18900/v1
  api_key: ${OPENROUTER_API_KEY}
  api_mode: chat_completions
platform_toolsets:
  api_server: [hermes-api-server, spike]
agent:
  max_turns: 6
  run_budget_seconds: 120
  gateway_timeout: 120
gateway:
  multiplex_profiles: true
  api_server:
    max_concurrent_runs: 10
```

Then set up the two profiles' files:

```bash
cp $S/home/config.yaml $S/home/profiles/records/config.yaml
printf 'API_SERVER_ENABLED=true\nAPI_SERVER_KEY=spike-local-key-0123456789abcdef0123456789abcdef\nOPENROUTER_API_KEY=spike-dummy\nOPENROUTER_BASE_URL=http://127.0.0.1:18900/v1\n' > $S/home/.env
printf 'OPENROUTER_API_KEY=spike-dummy\nOPENROUTER_BASE_URL=http://127.0.0.1:18900/v1\n' > $S/home/profiles/records/.env
chmod 600 $S/home/.env $S/home/profiles/records/.env
printf 'description: "Spike records specialist."\ndescription_auto: false\n' > $S/home/profiles/records/profile.yaml
printf '# Records specialist (spike)\n' > $S/home/profiles/records/SOUL.md
```

- [ ] **Step 2: Add a throwaway plugin with a tool that needs approval.** Write `$S/hermes/plugins/spike_rule/plugin.yaml`:

```yaml
name: spike_rule
version: 0.0.1
description: "THROWAWAY: a tool that always needs the owner's approval."
author: spike
kind: backend
provides_tools:
  - spike_write
```

Write `$S/hermes/plugins/spike_rule/__init__.py`:

```python
"""THROWAWAY: spike_write always needs approval, through the plugin approval rule path."""
import json

SCHEMA = {"name": "spike_write", "description": "Write the test record.",
          "parameters": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]}}


def _handle(args, **_kw):
    return json.dumps({"written": args.get("note", "")})


def _require_approval(tool_name=None, args=None, **_kw):
    if tool_name == "spike_write":
        return {"action": "approve", "message": "Write the test record", "rule_key": "spike_write"}
    return None


def register(ctx):
    ctx.register_tool(name="spike_write", toolset="spike", schema=SCHEMA, handler=_handle,
                      check_fn=lambda: True, emoji="📝")
    ctx.register_hook("pre_tool_call", _require_approval)
```

If the hook is never called, read `_get_pre_tool_call_directive_details` in `hermes_cli/plugins.py` for the keyword arguments it passes, and match them.

- [ ] **Step 3: Script the model** so that a `records` run calls `spike_write` once, then answers. Write `$S/mock.py`:

```python
"""THROWAWAY scripted model: records calls spike_write, then answers."""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def reply(body):
    messages = body.get("messages", [])
    if any(m.get("role") == "tool" for m in messages):
        return {"content": "RECORDS_DONE after approval"}
    return {"tool_call": {"id": "call_1", "name": "spike_write", "arguments": json.dumps({"note": "x"})}}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        data = json.dumps({"object": "list", "data": [{"id": "mock/model"}]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if not self.path.endswith("/chat/completions"):
            self.send_response(404); self.end_headers(); return
        r = reply(body)
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        if "tool_call" in r:
            c = r["tool_call"]
            delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": c["id"], "type": "function",
                                                          "function": {"name": c["name"], "arguments": c["arguments"]}}]}
            finish = "tool_calls"
        else:
            delta, finish = {"role": "assistant", "content": r["content"]}, "stop"
        for d, f in ((delta, None), ({}, finish)):
            self.wfile.write(f"data: {json.dumps({'id': 'm', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'mock/model', 'choices': [{'index': 0, 'delta': d, 'finish_reason': f}]})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
```

- [ ] **Step 4: Start both, and run the `records` run directly.**

```bash
(cd $S && nohup python3 mock.py 18900 > mock.out 2>&1 & echo $! > mock.pid)
(cd $S/hermes && HERMES_HOME=$S/home HERMES_KANBAN_DB=$S/home/kanban.db API_SERVER_HOST=127.0.0.1 API_SERVER_PORT=18642 \
  OPENROUTER_BASE_URL=http://127.0.0.1:18900/v1 nohup .venv/bin/hermes gateway run --force > $S/gateway.out 2>&1 & echo $! > $S/gateway.pid)
K=spike-local-key-0123456789abcdef0123456789abcdef
until /usr/bin/curl -s http://127.0.0.1:18642/health | grep -q ok; do sleep 1; done
RUN=$(/usr/bin/curl -s -X POST -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d '{"input":"write it"}' http://127.0.0.1:18642/p/records/v1/runs | python3 -c 'import sys,json;print(json.load(sys.stdin)["run_id"])')
timeout 20 /usr/bin/curl -sN -H "Authorization: Bearer $K" http://127.0.0.1:18642/p/records/v1/runs/$RUN/events | tee $S/events.txt | grep -m1 approval.request
```

Expected: one `approval.request` line with a `request_id`.

- [ ] **Step 5: Answer it through the profile route, and check that the run finishes.**

```bash
REQ=$(grep -m1 approval.request $S/events.txt | sed 's/^data: //' | python3 -c 'import sys,json;print(json.load(sys.stdin)["request_id"])')
/usr/bin/curl -s -X POST -H "Authorization: Bearer $K" -H 'Content-Type: application/json' \
  -d "{\"choice\":\"once\",\"request_id\":\"$REQ\"}" http://127.0.0.1:18642/p/records/v1/runs/$RUN/approval
sleep 3; /usr/bin/curl -s -H "Authorization: Bearer $K" http://127.0.0.1:18642/p/records/v1/runs/$RUN
```

Expected: the approval response says `"resolved": 1`, and the run status is `completed` with output `RECORDS_DONE after approval`.

**Gate:** if either expectation fails, stop, write down what you saw, and take it to the owner. Approach A in the spec is the fallback.

- [ ] **Step 6: Stop the processes and record the result.** Run `kill $(cat $S/gateway.pid) $(cat $S/mock.pid)`. Then add one line under "Feasibility test (26 September)" in the spec:

```markdown
- An approval raised inside the specialist's run (a plugin approval rule) arrived on that run's own event stream at `/p/records/v1/runs/{id}/events`, was answered at `/p/records/v1/runs/{id}/approval` with `choice: once`, and the run then completed (checked <date>, same pinned Hermes).
```

- [ ] **Step 7: Commit.**

```bash
git add docs/plans/2026-09-26-specialist-handoff.md
git commit -m "docs(plans): an approval inside a specialist's run round-trips" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hermes fork — the `ask_specialist` tool

**Repository:** `~/ios/hermes-agent` (remote `fork` = `qhkm/hermes-agent`).

**Files:**
- Create: `plugins/jentera/handoff.py`
- Modify: `plugins/jentera/__init__.py`, `plugins/jentera/plugin.yaml`
- Test: `tests/plugins/jentera/test_ask_specialist.py`

**Interfaces:**
- Consumes: the runner's `POST /v1/handoff` and `GET /v1/handoff/available`, built in Task 4.
  - Both require `Authorization: Bearer <API_SERVER_KEY>`.
  - The POST body is `{ runId, specialist, brief }`.
  - It returns `{ ok: true, specialist, name, answer }` or `{ ok: false, code, message }`.
- Produces: the tool `ask_specialist(specialist: str, brief: str)`.
  - Success result: JSON `{"specialist", "name", "answer"}`.
  - Failure result: JSON `{"error": str, "code": str}`.

- [ ] **Step 1: Make the worktree at the pinned tag.**

```bash
cd ~/ios/hermes-agent && git fetch fork --tags
wt new jentera-ask-specialist && git reset --hard v2026.9.22 && git log --oneline -1
```

Expected: `929f477c30 fix(browser): refuse tool calls while the owner holds the browser`.

- [ ] **Step 2: Write the failing tests** in `tests/plugins/jentera/test_ask_specialist.py`:

```python
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from plugins.jentera import handoff

RUN_ID = "run_" + "a" * 32


class _Runner(BaseHTTPRequestHandler):
    received: list = []
    reply = (200, {})
    available = True

    def log_message(self, *args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        _Runner.received.append(("GET", self.path, self.headers.get("Authorization"), None))
        self._send(200, {"ok": True, "available": _Runner.available})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        _Runner.received.append(("POST", self.path, self.headers.get("Authorization"), body))
        self._send(*_Runner.reply)


@pytest.fixture()
def runner(monkeypatch):
    _Runner.received = []
    _Runner.available = True
    _Runner.reply = (200, {"ok": True, "specialist": "records", "name": "Finance and records",
                           "answer": "3 invoices are unpaid."})
    server = HTTPServer(("127.0.0.1", 0), _Runner)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("JENTERA_RUNNER_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("API_SERVER_KEY", "hermes-key-for-tests")
    monkeypatch.setattr(handoff, "_calling_run_id", lambda: RUN_ID)
    yield _Runner
    server.shutdown()


def test_hands_off_and_returns_the_specialists_answer(runner):
    out = json.loads(handoff.handle_ask_specialist({"specialist": "records", "brief": "Which invoices are unpaid?"}))
    assert out == {"specialist": "records", "name": "Finance and records", "answer": "3 invoices are unpaid."}
    method, path, auth, body = runner.received[-1]
    assert (method, path, auth) == ("POST", "/v1/handoff", "Bearer hermes-key-for-tests")
    assert body == {"runId": RUN_ID, "specialist": "records", "brief": "Which invoices are unpaid?"}


def test_a_refusal_carries_its_code_and_asks_for_honesty(runner):
    runner.reply = (200, {"ok": False, "code": "limit_count", "message": "This task has already used its five hand-offs."})
    out = json.loads(handoff.handle_ask_specialist({"specialist": "records", "brief": "More"}))
    assert out["code"] == "limit_count"
    assert "which part is missing" in out["error"]


def test_an_unreachable_runner_is_a_failure_not_an_exception(runner, monkeypatch):
    monkeypatch.setenv("JENTERA_RUNNER_URL", "http://127.0.0.1:9")
    out = json.loads(handoff.handle_ask_specialist({"specialist": "records", "brief": "x"}))
    assert out["code"] == "failed"


def test_a_long_or_empty_brief_is_refused_before_anything_is_sent(runner):
    assert json.loads(handoff.handle_ask_specialist({"specialist": "records", "brief": "x" * 2_001}))["code"] == "invalid"
    assert json.loads(handoff.handle_ask_specialist({"specialist": "records", "brief": "  "}))["code"] == "invalid"
    assert runner.received == []


def test_offered_only_when_the_runner_says_hand_offs_are_on(runner, monkeypatch):
    assert handoff.check_handoff_available() is True
    runner.available = False
    assert handoff.check_handoff_available() is False
    monkeypatch.delenv("API_SERVER_KEY")
    assert handoff.check_handoff_available() is False


def test_registered_beside_business_records():
    import plugins.jentera as plugin

    registered = []

    class Ctx:
        def register_tool(self, **kwargs):
            registered.append(kwargs["name"])

    plugin.register(Ctx())
    assert registered == ["business_records", "connect_service", "ask_specialist"]
```

- [ ] **Step 3: Run the tests and watch them fail.**

Run: `scripts/run_tests.sh tests/plugins/jentera/test_ask_specialist.py -q`
Expected: FAIL with `ImportError: cannot import name 'handoff'`.

- [ ] **Step 4: Write `plugins/jentera/handoff.py`.**

```python
"""Ask another Jentera specialist to do part of this task.

The tool asks the Jentera runner on this machine. The runner runs the named
specialist's turn on its own profile while this turn waits, and returns its
answer. The runner holds every limit — depth, count, time, one at a time —
so this module only carries the request. The contract is aisar-site's
docs/plans/2026-09-26-specialist-handoff.md.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from tools.registry import tool_error, tool_result

HANDOFF_PATH = "/v1/handoff"
AVAILABLE_PATH = "/v1/handoff/available"
USER_AGENT = "Jentera-Agent/1.0"
BRIEF_MAX_CHARS = 2_000
# The runner gives a hand-off at most 390 s. A single tool call has no Hermes
# timeout on the sequential path, so this is the only bound on the wait.
HANDOFF_TIMEOUT_SECONDS = 420
AVAILABLE_TIMEOUT_SECONDS = 3

ASK_SPECIALIST_SCHEMA = {
    "name": "ask_specialist",
    "description": (
        "Hand part of this task to another specialist on this business's Jentera team and wait "
        "for their answer. Name the specialist by its profile key and say exactly what you need. "
        "They work with their own memory and skills and reply to you, not to the owner. Use it "
        "only when that part clearly sits in their remit."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "specialist": {"type": "string", "description": "The specialist's profile key, for example records."},
            "brief": {"type": "string", "description": "What you need from them, in at most 2000 characters."},
        },
        "required": ["specialist", "brief"],
    },
}


def _runner_url() -> str:
    return os.environ.get("JENTERA_RUNNER_URL", "http://127.0.0.1:8080").strip().rstrip("/")


def _runner_key() -> str:
    # The runner and Hermes share the Hermes API key. The default profile's
    # .env puts it in the process environment, which every profile's turn sees.
    return os.environ.get("API_SERVER_KEY", "").strip()


def _request(method: str, path: str, payload: dict | None, timeout: float) -> tuple[int, dict]:
    request = urllib.request.Request(
        _runner_url() + path,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {_runner_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}


def check_handoff_available() -> bool:
    """Offered only on a business whose hand-offs are switched on."""
    if not _runner_key():
        return False
    try:
        status, body = _request("GET", AVAILABLE_PATH, None, AVAILABLE_TIMEOUT_SECONDS)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False
    return status == 200 and body.get("available") is True


def _calling_run_id() -> str:
    # The API server binds the run id as the approval session key of the
    # thread running this turn (gateway/platforms/api_server.py). The runner
    # started that run, so the id identifies the caller exactly.
    from tools.approval import get_current_session_key

    return str(get_current_session_key() or "")


def handle_ask_specialist(args: dict, **_kw) -> str:
    specialist = str(args.get("specialist") or "").strip()
    brief = str(args.get("brief") or "").strip()
    if not specialist or not brief:
        return tool_error("Name the specialist and say what you need from them.", code="invalid")
    if len(brief) > BRIEF_MAX_CHARS:
        return tool_error(f"Keep the brief under {BRIEF_MAX_CHARS} characters.", code="invalid")
    run_id = _calling_run_id()
    if not run_id or not _runner_key():
        return tool_error("Hand-offs are not available here.", code="unavailable")
    try:
        status, body = _request(
            "POST", HANDOFF_PATH, {"runId": run_id, "specialist": specialist, "brief": brief},
            HANDOFF_TIMEOUT_SECONDS,
        )
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return tool_error("The specialist could not be reached. Say in your answer which part is missing.",
                          code="failed")
    if status == 200 and body.get("ok") is True:
        return tool_result(specialist=body.get("specialist", specialist), name=body.get("name", ""),
                           answer=body.get("answer", ""))
    code = body.get("code") if isinstance(body.get("code"), str) else "failed"
    message = body.get("message") if isinstance(body.get("message"), str) else "The specialist could not finish."
    return tool_error(f"{message} Say in your answer which part is missing.", code=code)
```

- [ ] **Step 5: Register it.** In `plugins/jentera/__init__.py`, add the import beside the existing one:

```python
from plugins.jentera.handoff import ASK_SPECIALIST_SCHEMA, check_handoff_available, handle_ask_specialist
```

Add this as the last call inside `register(ctx)`, after `connect_service`:

```python
    ctx.register_tool(
        name="ask_specialist",
        toolset="jentera",
        schema=ASK_SPECIALIST_SCHEMA,
        handler=handle_ask_specialist,
        check_fn=check_handoff_available,
        emoji="🤝",
    )
```

In `plugins/jentera/plugin.yaml`, add `  - ask_specialist` under `provides_tools`.

- [ ] **Step 6: Run the tests and watch them pass.**

Run: `scripts/run_tests.sh tests/plugins/jentera -q`
Expected: every test in `tests/plugins/jentera` passes, the new ones included.

- [ ] **Step 7: Commit on the fork branch.** Do not push or tag here; that happens in Task 13.

```bash
git add plugins/jentera/handoff.py plugins/jentera/__init__.py plugins/jentera/plugin.yaml tests/plugins/jentera/test_ask_specialist.py
git commit -m "feat(jentera): ask_specialist hands part of a task to another specialist" \
  -m "The tool asks the Jentera runner on loopback, with the Hermes API key it already shares, and waits for the specialist's answer. It is offered only while the runner says the business has hand-offs on; the runner holds every limit." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Runner — the hand-off engine

**Files:**
- Create: `runner/src/handoff.mjs`
- Test: `runner/test/handoff.test.mjs`

**Interfaces:**
- Produces, all exported from `runner/src/handoff.mjs`:
  - Constants: `HANDOFF_BRIEF_MAX` (2000), `HANDOFF_ANSWER_MAX` (16000), `HANDOFF_MAX_MS` (390000), `HANDOFF_ANSWER_RESERVE_MS` (60000), `HANDOFF_MIN_MS` (15000) and `HANDOFF_MESSAGES`.
  - `handoffRequestProblem(body)` returns `string | null`.
  - `handoffFieldProblem(value)` returns `string | null`.
  - `handoffRefusal({ caller, specialist, roster, used, limits })` returns a code or `null`.
  - `handoffBudgetMs(deadlineAt, now)` returns a number.
  - `specialistInstructions(preamble, specialist, outputsInstruction)` returns a string.
  - `addUsage(total, usage)` returns a usage object.
  - `class HandoffEngine(deps)`:
    - `register(taskId, { rootRunId, rootProfile, deadlineAt, model, handoff, outputsInstruction })`
    - `request({ runId, specialist, brief })`, returning `Promise<{ ok: true, specialist, name, answer } | { ok: false, code, message }>`
    - `stopTask(taskId)`
    - `usageOf(taskId)`
  - The deps the engine takes:
    - `hermes(path, init, profile)` returns a `Response`.
    - `events(runId, profile, signal)` returns a `Response` whose body is SSE.
    - `emit(taskId, event, target)`.
    - `translate(hermesEvent, profile)` returns a safe event or `null`.
    - `roster()`, `enabled()` and `now()`.
- The stream events it emits:
  - `{ type: 'handoff', stage: 'requested'|'started'|'finished'|'failed'|'refused', specialist, name?, depth, code? }`
  - relayed specialist events, `{ ...translated, agent }`, with `target: { runId, profile }`.

- [ ] **Step 1: Write the failing tests** in `runner/test/handoff.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HANDOFF_MAX_MS,
  HandoffEngine,
  addUsage,
  handoffBudgetMs,
  handoffFieldProblem,
  handoffRequestProblem,
} from '../src/handoff.mjs';

const ROSTER = [
  { profile: 'records', name: 'Finance and records', description: 'Invoices and cash flow.', instructions: '' },
  { profile: 'growth', name: 'Growth and marketing', description: 'Campaigns.', instructions: 'Keep it short.' },
  { profile: 'operations', name: 'Operations', description: 'Stock.', instructions: '' },
];
const LIMITS = { maxDepth: 2, maxHandoffs: 5, preamble: 'You are working on part of a task for a colleague.' };
const NOW = 1_000_000;

function sse(events) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
  }), { status: 200 });
}

/** A fake Hermes: each started run replays `script(profile, runId)` as its event stream. */
function fakeHermes(script) {
  const calls = [];
  let started = 0;
  return {
    calls,
    status: () => ({ status: 'completed', output: 'from status' }),
    async hermes(path, init = {}, profile) {
      calls.push({ path, method: init.method ?? 'GET', profile, body: init.body ? JSON.parse(init.body) : undefined });
      if (path === '/v1/runs' && init.method === 'POST') {
        started += 1;
        return Response.json({ run_id: `run_${profile}_${started}`, status: 'started' }, { status: 202 });
      }
      if (/^\/v1\/runs\/[^/]+$/.test(path)) return Response.json(this.status(path.split('/').at(-1)));
      return Response.json({ status: 'stopping' });
    },
    events: async (runId, profile) => sse(script(profile, runId)),
  };
}

function engine(script, overrides = {}) {
  const fake = fakeHermes(script);
  const emitted = [];
  const handoffs = new HandoffEngine({
    hermes: (...args) => fake.hermes(...args),
    events: (...args) => fake.events(...args),
    emit: (taskId, event, target) => emitted.push({ taskId, event, target }),
    translate: (event, profile) => event.event === 'tool.started'
      ? { type: 'tool.started', tool: event.tool, agent: profile } : null,
    roster: () => ROSTER,
    enabled: () => true,
    now: () => NOW,
    ...overrides,
  });
  handoffs.register('task-1', {
    rootRunId: 'run_root', deadlineAt: NOW + 900_000, model: 'deep-model', handoff: LIMITS,
  });
  return { handoffs, fake, emitted };
}

const done = (output, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) => [
  { event: 'tool.started', tool: 'business_records' },
  { event: 'run.completed', output, usage },
];
const ask = (specialist, brief = 'Which invoices are unpaid?', runId = 'run_root') => ({ runId, specialist, brief });

test('runs the specialist on its own profile and hands back its answer', async () => {
  const { handoffs, fake, emitted } = engine(() => done('3 invoices are unpaid.'));
  const result = await handoffs.request(ask('records'));
  assert.deepEqual(result, { ok: true, specialist: 'records', name: 'Finance and records', answer: '3 invoices are unpaid.' });
  const start = fake.calls.find((call) => call.path === '/v1/runs');
  assert.equal(start.profile, 'records');
  assert.equal(start.body.input, 'Which invoices are unpaid?');
  assert.equal(start.body.model, 'deep-model');
  assert.match(start.body.instructions, /^You are working on part of a task for a colleague\./);
  assert.match(start.body.instructions, /You are the Finance and records specialist\. Your remit: Invoices and cash flow\./);
  assert.deepEqual(emitted.map(({ event }) => event.type === 'handoff' ? event.stage : event.type),
    ['requested', 'started', 'tool.started', 'finished']);
  assert.deepEqual(emitted.find(({ event }) => event.type === 'tool.started'), {
    taskId: 'task-1',
    event: { type: 'tool.started', tool: 'business_records', agent: 'records' },
    target: { runId: 'run_records_1', profile: 'records' },
  });
  assert.deepEqual(handoffs.usageOf('task-1'), { input_tokens: 10, output_tokens: 5, total_tokens: 15 });
});

test('never puts the brief on the stream', async () => {
  const { handoffs, emitted } = engine(() => done('ok'));
  await handoffs.request(ask('records', 'password=hunter2 check the invoices'));
  assert.doesNotMatch(JSON.stringify(emitted), /hunter2|check the invoices/);
});

test('refuses a display name, an unknown caller and a switched-off business without starting a run', async () => {
  const { handoffs, fake } = engine(() => done('ok'));
  assert.equal((await handoffs.request(ask('Finance and records'))).code, 'unknown_specialist');
  assert.equal((await handoffs.request(ask('records', 'x', 'run_nobody'))).code, 'unavailable');
  const off = engine(() => done('ok'), { enabled: () => false });
  assert.equal((await off.handoffs.request(ask('records'))).code, 'unavailable');
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs').length, 0);
});

test('a task started without hand-off limits cannot hand off', async () => {
  const { handoffs, fake } = engine(() => done('ok'));
  handoffs.register('task-2', { rootRunId: 'run_quick', handoff: undefined });
  assert.equal((await handoffs.request(ask('records', 'x', 'run_quick'))).code, 'unavailable');
  assert.equal(fake.calls.length, 0);
});

test('lets a specialist ask one more, but not a third level, and never back up its chain', async () => {
  const seen = {};
  const { handoffs, fake } = engine(() => []);
  fake.events = async (runId, profile) => {
    if (profile === 'records') {
      seen.growth = await handoffs.request(ask('growth', 'Last month sales?', runId));
      seen.self = await handoffs.request(ask('records', 'Me again', runId));
    }
    if (profile === 'growth') {
      seen.deeper = await handoffs.request(ask('operations', 'Stock?', runId));
      seen.upstream = await handoffs.request(ask('records', 'Back to you', runId));
    }
    return sse([{ event: 'run.completed', output: `${profile} done`, usage: {} }]);
  };
  const top = await handoffs.request(ask('records', 'Reconcile last month'));
  assert.equal(top.ok, true);
  assert.equal(seen.growth.ok, true);
  assert.equal(seen.self.code, 'loop');
  assert.equal(seen.deeper.code, 'limit_depth');
  assert.equal(seen.upstream.code, 'loop');
});

test('refuses the sixth hand-off in a task', async () => {
  const { handoffs } = engine(() => done('ok'));
  for (let i = 0; i < 5; i += 1) assert.equal((await handoffs.request(ask('records', `#${i}`))).ok, true);
  assert.equal((await handoffs.request(ask('records', '#6'))).code, 'limit_count');
});

test('gives a hand-off only the time the caller can spare', async () => {
  assert.equal(handoffBudgetMs(NOW + 900_000, NOW), HANDOFF_MAX_MS);
  assert.equal(handoffBudgetMs(NOW + 70_000, NOW), 10_000);
  assert.equal(handoffBudgetMs(undefined, NOW), HANDOFF_MAX_MS);
  const { handoffs, fake } = engine(() => done('ok'));
  handoffs.register('task-3', { rootRunId: 'run_late', deadlineAt: NOW + 70_000, handoff: LIMITS });
  assert.equal((await handoffs.request(ask('records', 'x', 'run_late'))).code, 'time');
  assert.equal(fake.calls.filter((call) => call.path === '/v1/runs').length, 0);
});

test('stopping the task stops the specialist and answers its caller at once', async () => {
  const { handoffs, fake } = engine(() => []);
  fake.events = async (_runId, _profile, signal) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    },
  }), { status: 200 });
  const pending = handoffs.request(ask('records', 'A long job'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await handoffs.stopTask('task-1');
  assert.equal((await pending).code, 'stopped');
  assert.ok(fake.calls.some((call) => call.path === '/v1/runs/run_records_1/stop' && call.profile === 'records'));
  assert.equal((await handoffs.request(ask('records', 'Again'))).code, 'stopped');
});

test('a specialist out of credits is reported as that, not as a failure', async () => {
  const { handoffs } = engine(() => [{ event: 'run.failed', error: 'budget_exceeded: monthly model budget exhausted' }]);
  assert.equal((await handoffs.request(ask('records'))).code, 'budget');
});

test('asks Hermes directly when the event stream ends without a result', async () => {
  const { handoffs } = engine(() => [{ event: 'tool.started', tool: 'web_search' }]);
  assert.deepEqual(await handoffs.request(ask('records')),
    { ok: true, specialist: 'records', name: 'Finance and records', answer: 'from status' });
});

test('checks what a task start and a tool request may carry', () => {
  assert.equal(handoffFieldProblem(undefined), null);
  assert.equal(handoffFieldProblem(LIMITS), null);
  assert.match(handoffFieldProblem({ ...LIMITS, maxDepth: 3 }), /maxDepth/);
  assert.match(handoffFieldProblem({ ...LIMITS, preamble: '' }), /preamble/);
  assert.equal(handoffRequestProblem({ runId: 'run_1', specialist: 'records', brief: 'x' }), null);
  assert.match(handoffRequestProblem({ runId: 'run_1', specialist: 'records', brief: 'x'.repeat(2_001) }), /brief/);
  assert.match(handoffRequestProblem({ runId: '../etc', specialist: 'records', brief: 'x' }), /runId/);
  assert.deepEqual(addUsage({ input_tokens: 1 }, { input_tokens: 2, output_tokens: 3, bogus: 9 }),
    { input_tokens: 3, output_tokens: 3 });
});
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd runner && node --test test/handoff.test.mjs`
Expected: FAIL with `Cannot find module '../src/handoff.mjs'`.

- [ ] **Step 3: Write `runner/src/handoff.mjs`.**

```js
/* ============================================================
   Specialists hand work to each other inside one task.

   A caller's Hermes turn — Chief of Staff or a specialist — calls the
   `ask_specialist` tool. The tool asks this runner on loopback; the runner
   runs the named specialist's turn on its own Hermes profile while the
   caller waits inside its tool call, and the answer comes back as the
   tool's result. The contract is docs/plans/2026-09-26-specialist-handoff.md.

   The limits hold here, not in the model: depth, count, loops, one at a
   time, and the time left in the task. The model proposes; this decides.
   ============================================================ */

export const HANDOFF_BRIEF_MAX = 2_000;
export const HANDOFF_ANSWER_MAX = 16_000;
/** Under Hermes's 420 s guard on tool calls issued together. */
export const HANDOFF_MAX_MS = 390_000;
/** Kept back so the caller can still write its answer. */
export const HANDOFF_ANSWER_RESERVE_MS = 60_000;
/** Less time than this is not worth starting a specialist for. */
export const HANDOFF_MIN_MS = 15_000;

const PROFILE = /^[a-z][a-z0-9-]{0,47}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const BUDGET = /budget_exceeded|model budget exhausted|runtime budget exceeded/i;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped', 'expired']);

export const HANDOFF_MESSAGES = Object.freeze({
  unavailable: 'Hand-offs are not available for this task.',
  unknown_specialist: "That is not one of this business's specialists.",
  loop: 'That specialist is already waiting further up this chain.',
  limit_depth: 'Hand-offs cannot go more than two levels deep.',
  limit_count: 'This task has already used its five hand-offs.',
  time: 'There is not enough time left in this task for that.',
  budget: "This month's AI credits are used up.",
  failed: 'The specialist could not finish.',
  stopped: 'The task was stopped.',
});

/** Why a request from the tool is malformed, or null. */
export function handoffRequestProblem(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body is not an object';
  if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) return 'runId is invalid';
  if (typeof body.specialist !== 'string' || body.specialist.length > 48) return 'specialist is invalid';
  if (typeof body.brief !== 'string' || !body.brief.trim() || body.brief.length > HANDOFF_BRIEF_MAX) {
    return `brief must contain 1 to ${HANDOFF_BRIEF_MAX} characters`;
  }
  return null;
}

/** Why a task start's hand-off limits are refused, or null. Absent is fine. */
export function handoffFieldProblem(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'handoff is not an object';
  if (!Number.isSafeInteger(value.maxDepth) || value.maxDepth < 1 || value.maxDepth > 2) {
    return 'handoff.maxDepth must be 1 or 2';
  }
  if (!Number.isSafeInteger(value.maxHandoffs) || value.maxHandoffs < 1 || value.maxHandoffs > 5) {
    return 'handoff.maxHandoffs must be 1 to 5';
  }
  if (typeof value.preamble !== 'string' || !value.preamble.trim() || value.preamble.length > 4_000) {
    return 'handoff.preamble must contain 1 to 4000 characters';
  }
  return null;
}

/** Why a hand-off must be refused, or null when it may start. */
export function handoffRefusal({ caller, specialist, roster, used, limits }) {
  if (!caller || !limits) return 'unavailable';
  if (!PROFILE.test(specialist) || !roster.some((entry) => entry.profile === specialist)) {
    return 'unknown_specialist';
  }
  if (caller.chain.includes(specialist)) return 'loop';
  if (caller.depth + 1 > limits.maxDepth) return 'limit_depth';
  if (used >= limits.maxHandoffs) return 'limit_count';
  return null;
}

/** How long a hand-off may run: what is left before the caller must answer, capped. */
export function handoffBudgetMs(deadlineAt, now) {
  if (typeof deadlineAt !== 'number') return HANDOFF_MAX_MS;
  return Math.min(deadlineAt - now - HANDOFF_ANSWER_RESERVE_MS, HANDOFF_MAX_MS);
}

/** The specialist's own turn: the control plane's preamble, then its remit. */
export function specialistInstructions(preamble, specialist, outputsInstruction = '') {
  return [
    preamble,
    `You are the ${specialist.name} specialist. Your remit: ${specialist.description}`,
    specialist.instructions ? `Business-owner instructions: ${specialist.instructions}` : '',
    outputsInstruction,
  ].filter(Boolean).join('\n\n');
}

export function addUsage(total, usage) {
  const out = { ...(total ?? {}) };
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    const value = usage?.[key];
    if (Number.isSafeInteger(value) && value >= 0) out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

function parseFrame(frame) {
  const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart()).join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function pause(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export class HandoffEngine {
  constructor(deps) {
    this.deps = { now: () => Date.now(), ...deps };
    this.tasks = new Map();
    this.runs = new Map();
  }

  /** The task that just started. One task runs at a time, so any earlier one is forgotten. */
  register(taskId, { rootRunId, rootProfile, deadlineAt, model, handoff, outputsInstruction = '' }) {
    this.tasks.clear();
    this.runs.clear();
    if (!handoff) return;
    this.tasks.set(taskId, {
      taskId,
      deadlineAt,
      model,
      outputsInstruction,
      limits: { maxDepth: handoff.maxDepth, maxHandoffs: handoff.maxHandoffs },
      preamble: handoff.preamble,
      used: 0,
      usage: null,
      active: null,
      stopped: false,
    });
    this.runs.set(rootRunId, { taskId, depth: 0, chain: [rootProfile ?? 'default'], queue: Promise.resolve() });
  }

  /** Tokens the task's specialists used, to add to its own. */
  usageOf(taskId) {
    return this.tasks.get(taskId)?.usage ?? null;
  }

  /** Stop the specialist working for this task, and refuse any that would follow. */
  async stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.stopped = true;
    const active = task.active;
    if (!active) return;
    active.abort.abort();
    await this.deps.hermes(`/v1/runs/${encodeURIComponent(active.runId)}/stop`, { method: 'POST' }, active.profile)
      .catch(() => undefined);
  }

  /** One request from a caller's tool; resolves to what the tool receives. */
  request({ runId, specialist, brief }) {
    const caller = this.runs.get(runId);
    const task = caller && this.tasks.get(caller.taskId);
    if (!task || !this.deps.enabled()) {
      return Promise.resolve({ ok: false, code: 'unavailable', message: HANDOFF_MESSAGES.unavailable });
    }
    /* One at a time. A caller waits inside its own tool call, so a queue per
       caller is enough; a queue per task would deadlock the second level,
       where a specialist asks for help while its own caller waits on it. */
    const turn = caller.queue.then(() => this.handOff(task, caller, specialist, brief.trim()));
    caller.queue = turn.catch(() => undefined);
    return turn;
  }

  async handOff(task, caller, specialist, brief) {
    const key = PROFILE.test(specialist) ? specialist : 'unknown';
    const roster = this.deps.roster();
    const entry = roster.find((item) => item.profile === key);
    const depth = caller.depth + 1;
    const mark = (stage, extra = {}) => this.deps.emit(task.taskId, {
      type: 'handoff', stage, specialist: key, ...(entry ? { name: entry.name } : {}), depth, ...extra,
    });
    const refuse = (code) => {
      mark('refused', { code });
      return { ok: false, code, message: HANDOFF_MESSAGES[code] };
    };
    const fail = (code) => {
      mark('failed', { code });
      return { ok: false, code, message: HANDOFF_MESSAGES[code] };
    };
    mark('requested');
    if (task.stopped) return refuse('stopped');
    const refusal = handoffRefusal({ caller, specialist: key, roster, used: task.used, limits: task.limits });
    if (refusal) return refuse(refusal);
    const budgetMs = handoffBudgetMs(task.deadlineAt, this.deps.now());
    if (budgetMs < HANDOFF_MIN_MS) return refuse('time');
    task.used += 1;

    const started = await this.deps.hermes('/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: brief,
        instructions: specialistInstructions(task.preamble, entry, task.outputsInstruction),
        ...(task.model ? { model: task.model } : {}),
        model_options: { reasoning: { enabled: true, effort: 'high' } },
      }),
    }, key).catch(() => null);
    const body = started?.ok ? await started.json().catch(() => null) : null;
    if (typeof body?.run_id !== 'string') return fail('failed');

    const runId = body.run_id;
    const abort = new AbortController();
    this.runs.set(runId, { taskId: task.taskId, depth, chain: [...caller.chain, key], queue: Promise.resolve() });
    task.active = { runId, profile: key, abort };
    mark('started');
    const stopRun = () => this.deps.hermes(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' }, key)
      .catch(() => undefined);
    /* A stop that landed between the start and this line would otherwise
       find nothing active to stop. */
    if (task.stopped) {
      abort.abort();
      void stopRun();
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
      void stopRun();
    }, budgetMs);
    try {
      const outcome = await this.follow(task.taskId, runId, key, abort.signal);
      if (outcome.usage) task.usage = addUsage(task.usage, outcome.usage);
      if (outcome.status === 'completed' && typeof outcome.output === 'string' && outcome.output.trim()) {
        mark('finished');
        return { ok: true, specialist: key, name: entry.name, answer: outcome.output.slice(0, HANDOFF_ANSWER_MAX) };
      }
      return fail(task.stopped ? 'stopped' : timedOut ? 'time'
        : BUDGET.test(String(outcome.error ?? '')) ? 'budget' : 'failed');
    } finally {
      clearTimeout(timer);
      if (task.active?.runId === runId) task.active = null;
      this.runs.delete(runId);
    }
  }

  /** Follow a specialist's run to its end, relaying its tools and approvals. */
  async follow(taskId, runId, profile, signal) {
    const target = { runId, profile };
    try {
      const response = await this.deps.events(runId, profile, signal);
      if (response?.ok && response.body) {
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const event = parseFrame(frame);
            if (!event) continue;
            if (event.event === 'run.completed') return { status: 'completed', output: event.output, usage: event.usage };
            if (event.event === 'run.failed') return { status: 'failed', error: event.error };
            if (event.event === 'run.cancelled') return { status: 'cancelled', usage: event.usage };
            const safe = this.deps.translate(event, profile);
            if (safe) this.deps.emit(taskId, safe, target);
          }
        }
      }
    } catch {
      if (signal.aborted) return { status: 'cancelled' };
    }
    /* The stream ended without a result: ask Hermes directly. */
    while (!signal.aborted) {
      const response = await this.deps.hermes(`/v1/runs/${encodeURIComponent(runId)}`, {}, profile).catch(() => null);
      const status = response?.ok ? await response.json().catch(() => null) : null;
      const state = typeof status?.status === 'string' ? status.status.toLowerCase() : '';
      if (TERMINAL.has(state)) return { status: state, output: status.output, usage: status.usage, error: status.error };
      await pause(1_000, signal);
    }
    return { status: 'cancelled' };
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass.**

Run: `cd runner && node --test test/handoff.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit.**

```bash
git add runner/src/handoff.mjs runner/test/handoff.test.mjs
git commit -m "feat(runner): a hand-off engine that runs a specialist inside its caller's turn" \
  -m "It holds the limits (two levels, five hand-offs, one at a time, the time left), runs the specialist on its own profile, relays its tools and approvals marked with it, and stops it with the task. The brief never reaches the stream." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Runner — wire the engine into the server

**Files:**
- Modify: `runner/src/server.mjs`, in these places:
  - imports;
  - `configRejection` (~line 282);
  - `createConfigChannel` (~386);
  - `createRunner` (~562);
  - the routes before the runner-key check (~645);
  - `taskProblem` (~1450);
  - task start (~962);
  - the stop route (~1073);
  - `persistObservedStatus` (~1786);
  - `hermesEvents` (~1550);
  - `SafeDeltaStreams` (~2163, ~2305, ~2375);
  - two new module functions.
- Test: `runner/test/server.test.mjs`

**Interfaces:**
- Consumes: Task 3's exports.
- Produces:
  - `GET /v1/handoff/available`, answering `{ ok: true, available: boolean }`.
  - `POST /v1/handoff`, which takes `{ runId, specialist, brief }` and answers with the engine's result.
    - Both routes accept only `Authorization: Bearer <HERMES_API_KEY>`.
  - The task start body accepts `handoff: { maxDepth, maxHandoffs, preamble }`.
  - Stream events gain `{ type: 'handoff', … }`, plus `agent` on `tool.started`, `tool.completed` and `approval` events from a specialist.
  - Task status `usage` includes the task's specialists' usage.

- [ ] **Step 1: Write the failing tests.** Make three changes to the fake Hermes in `runner/test/server.test.mjs`:

  1. Add module-level variables beside the other `let`s:

     ```js
     let eventsByRun = {};
     let holdRootEvents = null;
     ```

  2. Reset them at the top of `beforeEach`:

     ```js
     eventsByRun = {};
     holdRootEvents = null;
     ```

  3. Replace the fake's `/events` branch:

     ```js
     if (requestPath?.endsWith('/events')) {
       const runId = requestPath.split('/').at(-2);
       res.writeHead(200, { 'Content-Type': 'text/event-stream' });
       for (const event of eventsByRun[runId] ?? hermesEventsList) res.write(`data: ${JSON.stringify(event)}\n\n`);
       /* A root run waiting inside ask_specialist keeps its stream open. */
       if (runId === 'run-1' && holdRootEvents) await holdRootEvents;
       return res.end();
     }
     ```

Next, move the object literal passed to `createRunner` in `beforeEach` into a function, `runnerInput()`, defined in the same scope, so that `beforeEach` reads `runnerServer = createRunner(runnerInput());`. Then add these helpers and tests at the end of the file:

```js
const HANDOFF = { maxDepth: 2, maxHandoffs: 5, preamble: 'You are working on part of a task for a colleague.' };

function handoffChannel() {
  return {
    state: () => ({ schema: 2, version: 'abcdef12', appliedAt: null, source: 'control-plane' }),
    profiles: () => ['operations', 'customers', 'growth', 'records'],
    handoffEnabled: () => true,
    roster: () => [{ profile: 'records', name: 'Finance and records', description: 'Invoices and cash flow.', instructions: '' }],
    loadLastKnownGood: async () => {},
    refresh: async () => 'unchanged',
    applyPending: async () => false,
    backoffMs: () => 60_000,
  };
}

async function withHandoffs() {
  await close(runnerServer);
  runnerServer = createRunner({ ...runnerInput(), configChannel: handoffChannel() });
  runnerOrigin = await listen(runnerServer);
  let release;
  holdRootEvents = new Promise((resolve) => { release = resolve; });
  return () => release();
}

const handOff = (body) => fetch(`${runnerOrigin}/v1/handoff`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${HERMES_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('hand-off routes answer only the Hermes key', async () => {
  assert.equal((await fetch(`${runnerOrigin}/v1/handoff/available`)).status, 401);
  assert.equal((await fetch(`${runnerOrigin}/v1/handoff/available`, {
    headers: { 'X-Aisar-Runner-Key': RUNNER_KEY } })).status, 401);
  const answer = await fetch(`${runnerOrigin}/v1/handoff/available`, { headers: { Authorization: `Bearer ${HERMES_KEY}` } });
  assert.deepEqual(await answer.json(), { ok: true, available: false });
  assert.equal((await fetch(`${runnerOrigin}/v1/handoff`, { method: 'POST', body: '{}' })).status, 401);
});

test('a specialist works inside the task that asked for it', async () => {
  const release = await withHandoffs();
  hermesStatus = 'completed';
  eventsByRun['run-2'] = [
    { event: 'tool.started', tool: 'terminal', preview: 'TOKEN=secret git status' },
    { event: 'run.completed', output: '3 invoices are unpaid.', usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
  ];
  await start(TASK, { handoff: HANDOFF });
  const response = await handOff({ runId: 'run-1', specialist: 'records', brief: 'password=hunter2 Which invoices?' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(),
    { ok: true, specialist: 'records', name: 'Finance and records', answer: '3 invoices are unpaid.' });
  assert.ok(hermesPaths.includes('/p/records/v1/runs'));
  assert.match(starts.at(-1).instructions, /You are the Finance and records specialist/);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const stream = await (await call(`/v1/tasks/${TASK}/events`, { headers: { Accept: 'text/event-stream' } })).text();
  assert.match(stream, /"type":"handoff","stage":"started","specialist":"records","name":"Finance and records","depth":1/);
  assert.match(stream, /"tool":"terminal","preview":"git","agent":"records"/);
  assert.doesNotMatch(stream, /hunter2|Which invoices|secret/);
  const status = await (await call(`/v1/tasks/${TASK}`)).json();
  assert.deepEqual(status.usage, { input_tokens: 142, output_tokens: 32, total_tokens: 174 });
});

test("ask_specialist's own step never carries the brief", async () => {
  hermesEventsList = [{ event: 'tool.started', tool: 'ask_specialist', preview: 'records: password=hunter2 check invoices' }];
  await start(TASK);
  const stream = await (await call(`/v1/tasks/${TASK}/events`, { headers: { Accept: 'text/event-stream' } })).text();
  assert.match(stream, /"tool":"ask_specialist"/);
  assert.doesNotMatch(stream, /hunter2|check invoices/);
});

test("an approval from a specialist is answered on the specialist's own run", async () => {
  const release = await withHandoffs();
  hermesStatus = 'running';
  eventsByRun['run-2'] = [{ event: 'approval.request', request_id: 'b'.repeat(32), description: 'Create a draft invoice' }];
  await start(TASK, { handoff: HANDOFF });
  const pending = handOff({ runId: 'run-1', specialist: 'records', brief: 'Draft it' });
  /* The first status poll of run-2 comes after its stream, and so its approval, was relayed. */
  await waitFor(() => hermesPaths.includes('/p/records/v1/runs/run-2'), 3_000);
  const decided = await call(`/v1/tasks/${TASK}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'b'.repeat(32), decision: 'approve' }),
  });
  assert.equal(decided.status, 200);
  assert.ok(hermesPaths.includes('/p/records/v1/runs/run-2/approval'));
  hermesStatus = 'completed';
  assert.equal((await (await pending).json()).ok, true);
  release();
});

test('stopping the task stops the specialist working for it', async () => {
  const release = await withHandoffs();
  hermesStatus = 'running';
  eventsByRun['run-2'] = [];
  await start(TASK, { handoff: HANDOFF });
  const pending = handOff({ runId: 'run-1', specialist: 'records', brief: 'A long job' });
  await waitFor(() => hermesPaths.includes('/p/records/v1/runs/run-2'), 3_000);
  assert.equal((await call(`/v1/tasks/${TASK}/stop`, { method: 'POST' })).status, 200);
  assert.equal((await (await pending).json()).code, 'stopped');
  assert.ok(hermesPaths.includes('/p/records/v1/runs/run-2/stop'));
  release();
});
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd runner && node --test test/server.test.mjs`
Expected: the new tests FAIL. The first gets 404 on `/v1/handoff/available`; the others fail because no hand-off exists.

- [ ] **Step 3: Import the engine** at the top of `runner/src/server.mjs`:

```js
import { HandoffEngine, addUsage, handoffFieldProblem, handoffRequestProblem } from './handoff.mjs';
```

- [ ] **Step 4: Let the config document carry the switch.** In `configRejection`, before its final `return null;`, add:

```js
  /* A business on the hand-off pilot is told so here (worker config-document.ts). */
  if (document.handoff !== undefined) {
    const handoff = document.handoff;
    if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) ||
        Object.keys(handoff).some((key) => key !== 'enabled') || typeof handoff.enabled !== 'boolean') {
      return 'handoff must be { enabled: boolean }';
    }
  }
```

In `createConfigChannel`, add these two functions beside `profiles`:

```js
  const handoffEnabled = () => applied?.handoff?.enabled === true;
  const roster = () => (applied?.specialists ?? []).map(({ profile, name, description, instructions }) =>
    ({ profile, name, description, instructions }));
```

Then change its `return` to include them:

```js
  return { state, profiles, handoffEnabled, roster, loadLastKnownGood, refresh, applyPending, backoffMs };
```

- [ ] **Step 5: Add the two module functions** near `safeToolPreview` (~line 2666):

```js
/* What a tool start may show. Shell and process input can hold a bare OAuth
   code with no key name to redact, code has no safe first word, and
   ask_specialist's argument is the caller's brief to a colleague, which the
   owner is never shown verbatim. */
function toolStartedPreview(tool, preview) {
  if (/^(?:execute_code|ask_specialist)$/i.test(tool)) return '';
  if (/^(?:terminal|process|shell|bash)$/i.test(tool)) return commandProgram(preview);
  return safeToolPreview(preview);
}

/* A specialist's Hermes event, reduced to what its caller's task stream may
   carry: tools and approvals, marked with the specialist. Its answer text,
   reasoning and iterations stay out; the owner reads the caller's one answer. */
function nestedHermesEvent(event, agent) {
  if (event?.event === 'tool.started') {
    const tool = safeToolName(event.tool);
    if (!tool) return null;
    const preview = toolStartedPreview(tool, event.preview);
    return { type: 'tool.started', tool, ...(preview ? { preview } : {}), agent };
  }
  if (event?.event === 'tool.completed') {
    const tool = safeToolName(event.tool);
    if (!tool) return null;
    return {
      type: 'tool.completed',
      tool,
      duration: Number.isFinite(event.duration) ? Math.max(0, Math.min(900, Number(event.duration))) : 0,
      error: event.error === true,
      agent,
    };
  }
  if (event?.event === 'approval.request') {
    const requestId = safeApprovalRequestId(event.request_id);
    const message = safeToolPreview(event.description);
    if (!requestId || !message) return null;
    return { type: 'approval', requestId, tool: approvalToolName(event), message, agent };
  }
  return null;
}
```

In `SafeDeltaStreams.acceptFrame`'s `tool.started` branch (~line 2305), replace the three-line `const preview = /^execute_code$/i.test(tool) ? '' : …` expression, together with its comment, with:

```js
      const preview = toolStartedPreview(tool, event.preview);
```

- [ ] **Step 6: Relay specialist events and route their approvals.** In `SafeDeltaStreams.start()`, add `approvalTargets: new Map(),` to the new stream object, right after `resolvedApprovals: new Map(),`. Then add this method to `SafeDeltaStreams`:

```js
  /** A specialist's event, relayed into the task it is working for. */
  emitNested(taskId, event, target) {
    const stream = this.streams.get(taskId);
    if (!stream || stream.done) return;
    if (event.type === 'approval') {
      if (stream.pendingApprovals.some((approval) => approval.requestId === event.requestId) ||
          stream.resolvedApprovals.has(event.requestId)) return;
      const approval = { ...event, seq: stream.nextSeq++ };
      stream.pendingApprovals.push(approval);
      if (target) stream.approvalTargets.set(event.requestId, target);
      this.emitEvent(stream, approval);
      return;
    }
    this.emitEvent(stream, { ...event, seq: stream.nextSeq++ });
  }
```

In `resolveApproval`, route to the run that asked. Just before `const operation = (async () => {`, add:

```js
    const target = stream.approvalTargets.get(requestId);
```

In the `hermes(...)` call inside `operation`, replace the path argument with ``/v1/runs/${encodeURIComponent(target?.runId ?? runId)}/approval``, and replace the final argument `stream.profile` with `target ? target.profile : stream.profile`. After `stream.pendingApprovals.shift();`, add:

```js
      stream.approvalTargets.delete(requestId);
```

- [ ] **Step 7: Let `hermesEvents` be cancelled.** Change its signature to `async function hermesEvents(config, runId, profile, signal)`, and replace its `signal: AbortSignal.timeout(15 * 60 * 1000)` with:

```js
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15 * 60 * 1000)])
      : AbortSignal.timeout(15 * 60 * 1000),
```

- [ ] **Step 8: Build the engine and its routes.** In `createRunner`, right after `const streams = new SafeDeltaStreams(config);`, add:

```js
  const handoffs = new HandoffEngine({
    hermes: (path, init, profile) => hermes(config, path, init, profile),
    events: (runId, profile, signal) => hermesEvents(config, runId, profile, signal),
    emit: (taskId, event, target) => streams.emitNested(taskId, event, target),
    translate: nestedHermesEvent,
    roster: () => configChannel.roster?.() ?? [],
    enabled: () => configChannel.handoffEnabled?.() === true,
  });
```

Directly before `if (!sameSecret(req.headers['x-aisar-runner-key'], config.runnerKey)) {`, add:

```js
      /* Called by the ask_specialist tool from Hermes on this machine. Hermes
         holds its own API key, not the runner key, so these answer before the
         runner-key check and accept only the Hermes key. */
      if (url.pathname === '/v1/handoff/available' && req.method === 'GET') {
        if (!sameSecret(authorizationBearer(req.headers.authorization), config.hermesKey)) {
          return json(res, 401, { ok: false, error: 'unauthorized' });
        }
        return json(res, 200, { ok: true, available: configChannel.handoffEnabled?.() === true });
      }
      if (url.pathname === '/v1/handoff' && req.method === 'POST') {
        if (!sameSecret(authorizationBearer(req.headers.authorization), config.hermesKey)) {
          return json(res, 401, { ok: false, error: 'unauthorized' });
        }
        const body = await readJson(req);
        const problem = handoffRequestProblem(body);
        if (problem) return json(res, 400, { ok: false, error: problem });
        return json(res, 200, await handoffs.request(body));
      }
```

- [ ] **Step 9: Accept and register a task's limits.** In `taskProblem`, directly before `const grant = validateGrant(body.toolGrant, config, body.taskId);`, add:

```js
  const handoffProblem = handoffFieldProblem(body.handoff);
  if (handoffProblem) return handoffProblem;
```

In the `POST /v1/tasks` handler, directly after `streams.start(body.taskId, result.run_id, body.profile);`, add:

```js
          handoffs.register(body.taskId, {
            rootRunId: result.run_id,
            rootProfile: body.profile,
            deadlineAt: body.deadlineAt,
            model: body.model ?? (responseMode === 'quick' ? config.modelName : config.deepModelName),
            handoff: body.handoff,
            outputsInstruction: outputsDir ? outputsInstruction(outputsDir) : '',
          });
```

- [ ] **Step 10: Stop the chain, and count its usage.** In the stop route, directly before `const stopped = await hermes(`, add:

```js
        /* A specialist working for this task is stopped first; its caller's
           tool call is waiting on it and would otherwise hang to its limit. */
        await handoffs.stopTask(saved.taskId);
```

In `persistObservedStatus`, directly after `let observed = boundedTaskStatus(result);`, add:

```js
  /* Specialists' tokens are the task's tokens. Added only to a measured
     figure: a missing root figure makes the worker charge its ceiling, and
     a partial one would undercount. */
  const handoffUsage = deps.handoffUsage?.(saved.taskId);
  if (handoffUsage && observed.usage) observed = { ...observed, usage: addUsage(observed.usage, handoffUsage) };
```

At the two `persistObservedStatus(state, saved, result, { config })` calls in the `GET /v1/tasks/:id` and `POST …/stop` routes, pass `{ config, handoffUsage: (taskId) => handoffs.usageOf(taskId) }`.

- [ ] **Step 11: Run the whole runner suite.**

Run: `cd runner && npm test`
Expected: PASS, including every existing test. The earlier `terminal transcript must not cross` assertions still hold.

- [ ] **Step 12: Commit.**

```bash
git add runner/src/server.mjs runner/test/server.test.mjs
git commit -m "feat(runner): hand-offs run inside the task, with approvals, stop and usage" \
  -m "The ask_specialist tool reaches the runner on loopback with the Hermes key. A task started with hand-off limits registers its root run; a specialist's tools and approvals are relayed into the task's stream marked with it, an approval is answered on the specialist's own run, stopping the task stops the specialist, and its usage is added to the task's. ask_specialist's own step carries no preview, because that preview is the brief." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Worker — the switch, the config document and the start body

**Files:**
- Create: `worker/src/handoff.ts`
- Modify:
  - `worker/src/env.ts`
  - `worker/wrangler.toml`
  - `worker/src/runtime/config-document.ts`
  - `worker/src/routes/runtime-config.ts`
  - `worker/src/runtime/runner-client.ts` (`RunnerTaskRequest`)
  - `worker/src/runtime/run-task.ts` (`RunPayload`, `runPayload`, start body)
- Test: `worker/test/handoff.test.ts` (new), `worker/test/runtime-config.test.ts`

**Interfaces:**
- Produces, from `worker/src/handoff.ts`:
  - `handoffEnabledFor(env: Env, businessId: string): boolean`
  - `HANDOFF_LIMITS`
  - `HANDOFF_PREAMBLE: string`
  - `interface HandoffTaskField { maxDepth: number; maxHandoffs: number; preamble: string }`
  - `handoffTaskField(speakerText?: string): HandoffTaskField`
- Also produces:
  - `renderRuntimeConfig(..., options: { handoff?: boolean } = {})`, whose document carries `handoff: { enabled: true }` only when on.
  - `RunPayload.handoff?: HandoffTaskField`.
  - `runPayload` is now exported.

- [ ] **Step 1: Write the failing tests.** Create `worker/test/handoff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HANDOFF_PREAMBLE, handoffEnabledFor, handoffTaskField } from '../src/handoff';
import { runPayload } from '../src/runtime/run-task';
import { testEnv } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('who may hand off', () => {
  it('is nobody until a business is listed, and only while the switch is on', () => {
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: '' }), A)).toBe(false);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: `${B}, ${A}` }), A)).toBe(true);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'false', HANDOFF_BUSINESS_IDS: A }), A)).toBe(false);
    expect(handoffEnabledFor(testEnv({ HANDOFF_ENABLED: 'true', HANDOFF_BUSINESS_IDS: `${A},not-a-uuid` }), A)).toBe(false);
  });
});

describe('what a task start carries', () => {
  it('puts who asked into what the specialist is told', () => {
    expect(handoffTaskField().preamble).toBe(HANDOFF_PREAMBLE);
    expect(handoffTaskField('The person typing is staff member sam@example.com.').preamble)
      .toBe(`${HANDOFF_PREAMBLE}\n\nThe person typing is staff member sam@example.com.`);
    expect(handoffTaskField()).toMatchObject({ maxDepth: 2, maxHandoffs: 5 });
  });

  it('keeps well-formed hand-off limits on a run payload and drops anything else', () => {
    const field = handoffTaskField();
    expect(runPayload({ input: 'hi', handoff: field }).handoff).toEqual(field);
    expect(runPayload({ input: 'hi', handoff: { ...field, maxDepth: 3 } }).handoff).toBeUndefined();
    expect(runPayload({ input: 'hi', handoff: { ...field, preamble: 'x'.repeat(4_001) } }).handoff).toBeUndefined();
    expect(runPayload({ input: 'hi' }).handoff).toBeUndefined();
  });
});
```

Then add this test inside the existing `describe` in `worker/test/runtime-config.test.ts`:

```ts
  it('carries the hand-off switch only for a business on it, and leaves everyone else unchanged', async () => {
    const at = new Date('2026-09-26T00:00:00Z');
    const off = await renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA, at);
    const alsoOff = await renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA, at, [], {}, { handoff: false });
    const on = await renderRuntimeConfig(configEnv(), runtime, CONFIG_SCHEMA, at, [], {}, { handoff: true });
    expect(off.handoff).toBeUndefined();
    expect(alsoOff.version).toBe(off.version);
    expect(on.handoff).toEqual({ enabled: true });
    expect(on.version).not.toBe(off.version);
  });
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd worker && npx vitest run test/handoff.test.ts test/runtime-config.test.ts`
Expected: FAIL. `../src/handoff` does not exist, and `renderRuntimeConfig` takes no options.

- [ ] **Step 3: Create `worker/src/handoff.ts`.** Later tasks add to it.

```ts
/* ============================================================
   Specialists hand work to each other: the control plane's half.

   docs/plans/2026-09-26-specialist-handoff.md is the contract. The runner
   holds the limits while a task runs; this file decides who may hand off at
   all, writes what the agents are told, and turns the runner's hand-off
   events into the run's durable trace.
   ============================================================ */

import type { Env } from './env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pilot: on only for the businesses listed, and nobody when the list is empty. */
export function handoffEnabledFor(env: Env, businessId: string): boolean {
  const ids = (env.HANDOFF_BUSINESS_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return env.HANDOFF_ENABLED === 'true' && UUID.test(businessId) &&
    ids.length <= 20 && ids.every((id) => UUID.test(id)) && ids.includes(businessId);
}

export const HANDOFF_LIMITS = { maxDepth: 2, maxHandoffs: 5 } as const;

/** What a specialist is told when a colleague hands it part of a task. */
export const HANDOFF_PREAMBLE =
  "A colleague on this business's Jentera team has handed you part of a task. You are " +
  'answering them, not the owner: do the part they asked for with your own expertise and ' +
  'memory, then reply with what you found or did, plainly and completely, so they can use ' +
  'it in their answer. If you could not finish, say exactly which part is missing and why. ' +
  'Never say something was done when it was not.';

export interface HandoffTaskField {
  maxDepth: number;
  maxHandoffs: number;
  preamble: string;
}

/** The limits and preamble a task start carries to the runner. */
export function handoffTaskField(speakerText?: string): HandoffTaskField {
  return {
    ...HANDOFF_LIMITS,
    preamble: speakerText ? `${HANDOFF_PREAMBLE}\n\n${speakerText}` : HANDOFF_PREAMBLE,
  };
}
```

- [ ] **Step 4: Declare the switch.** In `worker/src/env.ts`, beside `DESKTOP_VIEW_BUSINESS_IDS?: string;`, add:

```ts
  /** Specialists hand work to each other (docs/plans/2026-09-26-specialist-handoff.md). */
  HANDOFF_ENABLED?: string;
  /** Exact business UUIDs on the hand-off pilot, comma-separated; empty means nobody. */
  HANDOFF_BUSINESS_IDS?: string;
```

In `worker/wrangler.toml`, directly after the `DESKTOP_VIEW_BUSINESS_IDS = …` line under `[vars]`, add:

```toml
# Specialists hand work to each other (docs/plans/2026-09-26-specialist-handoff.md).
# A pilot: exact business UUIDs, comma-separated; empty means nobody.
HANDOFF_ENABLED = "true"
HANDOFF_BUSINESS_IDS = ""
```

- [ ] **Step 5: Put the switch in the config document.** In `worker/src/runtime/config-document.ts`:
  - Add `handoff?: { enabled: true };` to `RuntimeConfigDocument`.
  - Add a seventh parameter to `renderRuntimeConfig`: `options: { handoff?: boolean } = {},`.
  - Add this as the last property of `body`:

    ```ts
        /* Present only for a business on the hand-off pilot, so every other
           business's document, and so its version, stays byte for byte the same. */
        ...(options.handoff ? { handoff: { enabled: true as const } } : {}),
    ```

In `worker/src/routes/runtime-config.ts`:
  - Add `import { handoffEnabledFor } from '../handoff';`.
  - Add a seventh argument to the `renderRuntimeConfig(` call: `{ handoff: handoffEnabledFor(env, identity.businessId) }`.

- [ ] **Step 6: Carry the limits on the start body.** In `worker/src/runtime/runner-client.ts`, add this to `RunnerTaskRequest`:

```ts
  /** Present when this task may hand work to specialists (docs/plans/2026-09-26-specialist-handoff.md). */
  handoff?: { maxDepth: number; maxHandoffs: number; preamble: string };
```

In `worker/src/runtime/run-task.ts`:
  - Add `import type { HandoffTaskField } from '../handoff';`.
  - Add `handoff?: HandoffTaskField;` to `RunPayload`.
  - Change `function runPayload(` to `export function runPayload(`.
  - Add `handoff: handoffField(body.handoff),` as the last property of its returned object.
  - Add this function below `runPayload`:

```ts
/* Malformed limits run the task without hand-offs rather than failing it:
   the task is still worth doing, and the runner would refuse them anyway. */
function handoffField(value: unknown): HandoffTaskField | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const field = value as Record<string, unknown>;
  const maxDepth = Number(field.maxDepth);
  const maxHandoffs = Number(field.maxHandoffs);
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 2) return undefined;
  if (!Number.isSafeInteger(maxHandoffs) || maxHandoffs < 1 || maxHandoffs > 5) return undefined;
  if (typeof field.preamble !== 'string' || !field.preamble.trim() || field.preamble.length > 4_000) return undefined;
  return { maxDepth, maxHandoffs, preamble: field.preamble };
}
```

In `dispatchRuntimeRun`'s `client.start({ … })` call, add `...(payload.handoff ? { handoff: payload.handoff } : {}),` after `selectedSkills: payload.selectedSkills,`.

- [ ] **Step 7: Run the tests and the typecheck.**

Run: `cd worker && npx vitest run test/handoff.test.ts test/runtime-config.test.ts && pnpm typecheck`
Expected: PASS, and a clean typecheck.

- [ ] **Step 8: Commit.**

```bash
git add worker/src/handoff.ts worker/src/env.ts worker/wrangler.toml worker/src/runtime/config-document.ts worker/src/routes/runtime-config.ts worker/src/runtime/runner-client.ts worker/src/runtime/run-task.ts worker/test/handoff.test.ts worker/test/runtime-config.test.ts
git commit -m "feat(worker): a per-business switch and task limits for specialist hand-offs" \
  -m "HANDOFF_BUSINESS_IDS names the pilot businesses, and it ships empty. A business on it gets handoff: { enabled: true } in its runner config document; everyone else's document is unchanged byte for byte. A task payload may carry hand-off limits and the specialist preamble to the runner." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Worker — what the agents are told

**Files:**
- Modify:
  - `worker/src/handoff.ts`, adding `handoffInstructions`
  - `worker/src/specialists.ts` (`specialistRunInstructions`)
  - `worker/src/ask.ts` (`prepareHermesAgent`)
  - `worker/src/routes/runs.ts` (web intake, ~line 860)
  - `worker/src/runtime/consumer.ts` (Telegram intake, ~line 738)
- Test: `worker/test/handoff.test.ts`

**Interfaces:**
- Consumes: `handoffEnabledFor` and `handoffTaskField` (Task 5).
- Produces:
  - `handoffInstructions(roster, self?: string): string`
  - `specialistRunInstructions(specialist, options?: { handoff?: boolean })`
  - `prepareHermesAgent(…, responseMode?, handoffRoster?: readonly SpecialistDefinition[])`

- [ ] **Step 1: Write the failing tests** at the end of `worker/test/handoff.test.ts`, extending the imports:

```ts
import { handoffInstructions } from '../src/handoff';
import { prepareHermesAgent } from '../src/ask';
import { specialistRunInstructions, type SpecialistDefinition } from '../src/specialists';

const specialist = (profile: string, name: string, description: string): SpecialistDefinition =>
  ({ id: profile, profile, name, description, instructions: '', enabled: true });
const ROSTER = [
  specialist('records', 'Finance and records', 'Invoices and cash flow.'),
  specialist('growth', 'Growth and marketing', 'Campaigns.'),
];

describe('what the agents are told', () => {
  it('lists the other specialists by key and asks for credit by name', () => {
    const text = handoffInstructions(ROSTER, 'growth');
    expect(text).toContain('ask_specialist');
    expect(text).toContain('- records: Finance and records — Invoices and cash flow.');
    expect(text).not.toContain('- growth:');
    expect(text).toContain('Never present a missing part as done');
    expect(handoffInstructions([ROSTER[1]], 'growth')).toBe('');
  });

  it('lets a routed specialist credit a colleague only when hand-offs are on', () => {
    expect(specialistRunInstructions(ROSTER[1])).toContain('do not expose internal profile names, routing, delegation, or handoffs');
    expect(specialistRunInstructions(ROSTER[1], { handoff: true })).toContain('say which part by their name');
    expect(specialistRunInstructions(ROSTER[1], { handoff: true })).not.toContain('delegation, or handoffs');
  });

  it('adds hand-off instructions to a turn only when given a roster', () => {
    const at = new Date('2026-09-26T00:00:00Z');
    expect(prepareHermesAgent('Reconcile last month', [], [], at).instructions).not.toContain('ask_specialist');
    expect(prepareHermesAgent('Reconcile last month', [], [], at, undefined, undefined, 'deep', ROSTER).instructions)
      .toContain('ask_specialist');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd worker && npx vitest run test/handoff.test.ts`
Expected: FAIL. `handoffInstructions` is not exported.

- [ ] **Step 3: Add `handoffInstructions`** to `worker/src/handoff.ts`:

```ts
import type { SpecialistDefinition } from './specialists';

/** What a turn that may hand off is told: who else is on the team and how to credit them. */
export function handoffInstructions(
  roster: readonly Pick<SpecialistDefinition, 'profile' | 'name' | 'description'>[],
  self?: string,
): string {
  const others = roster.filter((entry) => entry.profile !== self);
  if (!others.length) return '';
  const list = others.map((entry) => `- ${entry.profile}: ${entry.name} — ${entry.description}`).join('\n');
  return 'You can hand part of this task to a specialist with the ask_specialist tool: give their ' +
    'profile key and a brief of exactly what you need. Do it only when that part clearly sits in ' +
    `their remit, and one at a time. Specialists on this team:\n${list}\n` +
    'Wait for their answer, then write one reply to the owner that says who did which part, by ' +
    'name (for example "Finance and records checked Bukku: …"). If a specialist could not finish, ' +
    'say which part is missing. Never present a missing part as done.';
}
```

- [ ] **Step 4: Let a routed specialist credit a colleague.** Replace `specialistRunInstructions` in `worker/src/specialists.ts` with:

```ts
export function specialistRunInstructions(
  specialist: SpecialistDefinition,
  options: { handoff?: boolean } = {},
): string {
  return `Internal assignment: the Chief of Staff has routed this request to the ${specialist.name} ` +
    `specialist profile. Apply that profile's durable expertise and memory. Return one coherent, ` +
    (options.handoff
      ? `owner-facing Jentera answer; do not expose internal profile names or routing, but when ` +
        `another specialist did part of the work through ask_specialist, say which part by their name. `
      : `owner-facing Jentera answer; do not expose internal profile names, routing, delegation, or ` +
        `handoffs. `) +
    `Your business-defined remit is: ${specialist.description}\n` +
    `${specialist.instructions ? `Business-owner instructions: ${specialist.instructions}\n` : ''}` +
    (options.handoff
      ? `If the request materially crosses another domain, hand that part to its specialist, or ` +
        `state the dependency plainly without pretending it was completed.`
      : `If the request materially crosses another domain, state the dependency plainly without ` +
        `pretending it was completed.`);
}
```

- [ ] **Step 5: Give `prepareHermesAgent` a roster.** In `worker/src/ask.ts`:
  - Add `import { handoffInstructions } from './handoff';`.
  - Add a last parameter, `handoffRoster?: readonly SpecialistDefinition[],`.
  - Replace the `const preamble = …` expression with:

```ts
  const handoff = handoffRoster?.length ? handoffInstructions(handoffRoster, specialist?.profile) : '';
  const preamble = HERMES_AGENT_PROMPT +
    `${specialist ? `\n\n${specialistRunInstructions(specialist, { handoff: Boolean(handoff) })}` : ''}` +
    `${speaker ? `\n\n${speakerInstructions(speaker)}` : ''}` +
    `${handoff ? `\n\n${handoff}` : ''}` +
    `${responseMode === 'quick' ? `\n\n${QUICK_TURN_PROMPT}` : ''}` +
    '\n\n';
```

- [ ] **Step 6: Web intake.** In `worker/src/routes/runs.ts`:
  - Add the imports `import { handoffEnabledFor, handoffTaskField } from '../handoff';` and, if not already there, `speakerInstructions` from `'../ask'`.
  - Return the roster from the tenant block that already lists specialists:

```ts
  const { facts, work, specialist, roster } = await withTenant(env, businessId, async (tx) => {
    const context = await retrieveHermesContext(tx, question);
    const specialists = await listSpecialists(tx, { enabledOnly: true });
    const preference = await botPreference(tx, userId);
    return { ...context, roster: specialists, specialist: await specialistForTurn(tx, businessId, sessionId, question, specialists, botProfile ?? preference.defaultBotProfile) };
  });
```

Directly after `const responseMode = requestedMode ?? responseModeFor(question);`, add:

```ts
  /* Quick replies never hand off: a hand-off is work, and a quick turn has two iterations. */
  const handoffRoster = responseMode !== 'quick' && handoffEnabledFor(env, businessId) ? roster : undefined;
```

Pass `handoffRoster` as the new last argument of `prepareHermesAgent(`. In the `enqueueRuntimeTask` payload, add after `responseMode,`:

```ts
        ...(handoffRoster?.length ? { handoff: handoffTaskField(speaker ? speakerInstructions(speaker) : undefined) } : {}),
```

- [ ] **Step 7: Telegram intake.** In `worker/src/runtime/consumer.ts`:
  - Add `import { handoffEnabledFor, handoffTaskField } from '../handoff';`.
  - Replace the `specialistForTurn(` call and the `prepareHermesAgent(` call around line 740 with:

```ts
      const roster = await listSpecialists(tx, { enabledOnly: true });
      const specialist = await specialistForTurn(
        tx,
        message.businessId,
        telegramSessionId,
        message.incoming.text,
        roster,
      );
      const handoffRoster = responseMode !== 'quick' && handoffEnabledFor(env, message.businessId)
        ? roster
        : undefined;
      const prepared = prepareHermesAgent(
        /* The note goes to the agent only. The run, the task's `telegram`
           block, retrieval and specialist routing all keep the caption. */
        withUnseenMediaNote(message.incoming.text, message.incoming.unseen),
        facts,
        work,
        new Date(),
        specialist,
        undefined,
        responseMode,
        handoffRoster,
      );
```

In its `enqueueRuntimeTask` payload, add after `responseMode,`:

```ts
          ...(handoffRoster?.length ? { handoff: handoffTaskField() } : {}),
```

- [ ] **Step 8: Run the tests and the typecheck.**

Run: `cd worker && npx vitest run test/handoff.test.ts test/specialists.test.ts && pnpm typecheck`
Expected: PASS. If `test/specialists.test.ts` asserts the old `specialistRunInstructions` text with no options, it still passes, because the default wording is unchanged.

- [ ] **Step 9: Commit.**

```bash
git add worker/src/handoff.ts worker/src/specialists.ts worker/src/ask.ts worker/src/routes/runs.ts worker/src/runtime/consumer.ts worker/test/handoff.test.ts
git commit -m "feat(worker): tell a working turn it may hand part of a task to a specialist" \
  -m "For a business on the pilot, a deep turn from the app or Telegram lists the other specialists by key, asks for one reply that credits each part by name and reports any missing part, and carries the limits and who asked to the runner. Quick replies never hand off." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Worker — relay hand-offs, name the specialist on its steps, Telegram

**Files:**
- Modify:
  - `worker/src/handoff.ts`, adding `agentStep`, `handoffStatus`, `recordHandoff` and `specialistNames`
  - `worker/src/runs.ts` (`EVENTS`)
  - `worker/src/runtime/runner-client.ts` (types, `shapedStreamEvent`, `stream`)
  - `worker/src/runtime/run-task.ts` (`onHandoff`)
  - `worker/src/runtime/consumer.ts` (`onHandoff`, `onToolEvent`)
  - `worker/src/connectors/telegram.ts` (tool copy and icon)
- Test: `worker/test/runtime-runner.test.ts`

**Interfaces:**
- Consumes: the runner's `handoff` events and the `agent` field (Task 4).
- Produces:
  - `RunnerHandoffEvent { type: 'handoff'; stage; specialist; name?; depth; code?; seq? }`
  - `HANDOFF_CODES`
  - `agent?: string` on `RunnerToolEvent` and `RunnerApprovalRequest`
  - run event `agent.handoff` with payload `{ stage, specialist, depth, code? }`
  - `agent.tool` payload gains `agent`, and its `detail` is `⟦Name⟧ <tool line>`
  - live status `🤝 Asking <Name>…` with kind `stage`

- [ ] **Step 1: Write the failing test.** In `worker/test/runtime-runner.test.ts`, add a new `describe('specialists handing off', …)` after the `live progress to the web chat` block. Its single test copies that block's first test, from `const published` through `await handleRuntimeMessage(…)`, with the payload unchanged, and replaces `events` and every assertion after `handleRuntimeMessage` with:

```ts
    const events = [
      { type: 'tool.started', tool: 'ask_specialist', seq: 1 },
      { type: 'handoff', stage: 'requested', specialist: 'records', name: 'Finance and records', depth: 1, seq: 2 },
      { type: 'handoff', stage: 'started', specialist: 'records', name: 'Finance and records', depth: 1, seq: 3 },
      { type: 'tool.started', tool: 'business_records', preview: 'invoices', agent: 'records', seq: 4 },
      { type: 'tool.completed', tool: 'business_records', duration: 1, error: false, agent: 'records', seq: 5 },
      { type: 'handoff', stage: 'finished', specialist: 'records', name: 'Finance and records', depth: 1, seq: 6 },
      { type: 'handoff', stage: 'refused', specialist: 'growth', name: 'Growth and marketing', depth: 1, code: 'limit_count', seq: 7 },
      { type: 'tool.completed', tool: 'ask_specialist', duration: 30, error: false, seq: 8 },
    ].map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
```

```ts
    const trace = await asTenant(A, (tx) => runTrace(tx, run.id));
    expect(trace.filter((event) => event.type === 'agent.handoff').map((event) => event.payload)).toEqual([
      { stage: 'requested', specialist: 'records', depth: 1 },
      { stage: 'started', specialist: 'records', depth: 1 },
      { stage: 'finished', specialist: 'records', depth: 1 },
      { stage: 'refused', specialist: 'growth', depth: 1, code: 'limit_count' },
    ]);
    expect(trace).toContainEqual(expect.objectContaining({
      type: 'agent.tool',
      payload: {
        tool: 'business_records',
        detail: '⟦Finance and records⟧ ⚙️ business_records: "invoices"',
        agent: 'records',
      },
    }));
    const statuses = published.filter((event) => event.type === 'status');
    expect(statuses).toContainEqual(expect.objectContaining({ detail: '🤝 Asking Finance and records…', kind: 'stage' }));
    expect(statuses).toContainEqual(expect.objectContaining({
      detail: '⟦Finance and records⟧ ⚙️ business_records: "invoices"', kind: 'tool' }));
    expect(JSON.stringify(trace)).not.toMatch(/brief/);
```

- [ ] **Step 2: Run the test and watch it fail.**

Run: `cd worker && npx vitest run test/runtime-runner.test.ts -t "specialists handing off"`
Expected: FAIL. No `agent.handoff` events are recorded, because the parser drops the unknown type.

- [ ] **Step 3: Add the Worker-side helpers** to `worker/src/handoff.ts`:

```ts
import type postgres from 'postgres';
import { append } from './runs';
import type { RunnerHandoffEvent } from './runtime/runner-client';

/** A specialist's step, tagged with its name so the app can say who did it. */
export function agentStep(name: string, detail: string): string {
  const clean = name.replace(/[⟦⟧\r\n]/g, '').trim().slice(0, 60);
  return clean ? `⟦${clean}⟧ ${detail}` : detail;
}

/** The live status line for a hand-off stage, or null when it needs none. */
export function handoffStatus(stage: RunnerHandoffEvent['stage'], name: string): string | null {
  if (stage === 'started') return `🤝 Asking ${name}…`;
  if (stage === 'finished') return `✅ ${name} finished their part`;
  if (stage === 'failed' || stage === 'refused') return `⚠️ ${name} could not help with this part`;
  return null;
}

/** The durable record of a hand-off stage. The brief never reaches here. */
export async function recordHandoff(
  tx: postgres.TransactionSql,
  businessId: string,
  runId: string,
  event: RunnerHandoffEvent,
): Promise<void> {
  await append(tx, businessId, runId, 'agent.handoff', {
    stage: event.stage,
    specialist: event.specialist,
    depth: event.depth,
    ...(event.code ? { code: event.code } : {}),
  });
}

/** Specialist names by profile, for a line the runner sent without one. */
export async function specialistNames(tx: postgres.TransactionSql): Promise<Map<string, string>> {
  const rows = await tx<{ profile_key: string; name: string }[]>`
    select profile_key, name from specialist_profile`;
  return new Map(rows.map((row) => [row.profile_key, row.name]));
}
```

In `worker/src/runs.ts`, add `'agent.handoff',` to `EVENTS`, after `'agent.delegation',`.

- [ ] **Step 4: Parse the new event and the `agent` field.** In `worker/src/runtime/runner-client.ts`, add:

```ts
export type HandoffStage = 'requested' | 'started' | 'finished' | 'failed' | 'refused';
export const HANDOFF_CODES = [
  'unavailable', 'unknown_specialist', 'loop', 'limit_depth', 'limit_count', 'time', 'budget', 'failed', 'stopped',
] as const;
export type HandoffCode = (typeof HANDOFF_CODES)[number];

/** A specialist hand-off stage (docs/plans/2026-09-26-specialist-handoff.md). */
export interface RunnerHandoffEvent {
  type: 'handoff';
  stage: HandoffStage;
  specialist: string;
  name?: string;
  depth: number;
  code?: HandoffCode;
  seq?: number;
}

const AGENT = /^[a-z][a-z0-9-]{0,47}$/;
const agentOf = (value: unknown): { agent?: string } =>
  typeof value === 'string' && AGENT.test(value) ? { agent: value } : {};
```

Then make these edits:
  - Change `RunnerToolEvent`'s trailing `& { seq?: number }` to `& { seq?: number; agent?: string }`.
  - Add `agent?: string;` to `RunnerApprovalRequest`.
  - Add `| RunnerHandoffEvent` to the `SafeStreamEvent` union.
  - In `shapedStreamEvent`, spread `...agentOf(event.agent)` into the returned `tool.started`, `tool.completed` and `approval` objects.
  - Add this branch before its final `return null;`:

```ts
  if (event.type === 'handoff' && typeof event.stage === 'string' &&
      ['requested', 'started', 'finished', 'failed', 'refused'].includes(event.stage) &&
      typeof event.specialist === 'string' && AGENT.test(event.specialist) &&
      Number.isSafeInteger(event.depth) && Number(event.depth) >= 1 && Number(event.depth) <= 2 &&
      (event.name === undefined || (typeof event.name === 'string' && event.name.length <= 60)) &&
      (event.code === undefined || (HANDOFF_CODES as readonly unknown[]).includes(event.code))) {
    return {
      type: 'handoff',
      stage: event.stage as HandoffStage,
      specialist: event.specialist,
      depth: Number(event.depth),
      ...(typeof event.name === 'string' && event.name.trim() ? { name: event.name.trim() } : {}),
      ...(event.code ? { code: event.code as HandoffCode } : {}),
    };
  }
```

In `stream()`, add `onHandoff?: (event: RunnerHandoffEvent) => Promise<void>;` to its handlers type. Then add this branch before the `tool.started` branch:

```ts
          if (event.type === 'handoff') {
            received += event.specialist.length + (event.name?.length ?? 0);
            if (received > STREAM_LIMIT) throw new Error('runner stream exceeded limit');
            await handlers.onHandoff?.(event);
            continue;
          }
```

In `worker/src/runtime/run-task.ts`:
  - Add `onHandoff?: (event: RunnerHandoffEvent) => Promise<void>;` to the options type beside `onToolEvent`, importing the type.
  - Add `onHandoff: options.onHandoff,` to the `client.stream(task.id, { … })` handlers.

- [ ] **Step 5: Relay it in the consumer.** In `worker/src/runtime/consumer.ts`:
  - Import `agentStep`, `handoffStatus`, `recordHandoff` and `specialistNames` from `'../handoff'`.
  - Add this module-level helper:

```ts
/* A specialist's display name: from the runner's hand-off events, or — when a
   later slice starts past them — from the business's own roster. */
async function specialistName(
  env: Env,
  businessId: string,
  cache: Map<string, string>,
  profile: string,
): Promise<string> {
  const known = cache.get(profile);
  if (known) return known;
  const names = await withTenant(env, businessId, (tx) => specialistNames(tx))
    .catch(() => new Map<string, string>());
  for (const [key, value] of names) cache.set(key, value);
  return cache.get(profile) ?? profile;
}
```

Directly after `const web = createWebProgress(...)` (~line 1466), add:

```ts
          const agentNames = new Map<string, string>();
```

Add this handler beside `onToolEvent` in the stream options:

```ts
            onHandoff: (liveStream || web)
              ? async (event) => {
                  if (event.name) agentNames.set(event.specialist, event.name);
                  const name = event.name ?? await specialistName(env, message.businessId, agentNames, event.specialist);
                  if (lease.task.runId) {
                    const handoffRunId = lease.task.runId;
                    await withTenant(env, message.businessId, (tx) =>
                      recordHandoff(tx, message.businessId, handoffRunId, event)).catch(() => undefined);
                  }
                  const line = handoffStatus(event.stage, name);
                  if (!line) return;
                  await web?.status(line, 'stage');
                  if (liveStream && !firstVisibleDelta) {
                    currentStep = line;
                    currentStepIsTool = false;
                    await liveStream.setStatus(timedStatus());
                  }
                }
              : undefined,
```

In `onToolEvent`'s `tool.started` branch, replace `const toolLine = hermesToolLine(event.tool, event.preview);` with:

```ts
                    const agentName = event.agent
                      ? await specialistName(env, message.businessId, agentNames, event.agent)
                      : null;
                    const toolLine = agentName
                      ? agentStep(agentName, hermesToolLine(event.tool, event.preview))
                      : hermesToolLine(event.tool, event.preview);
```

Then make three more changes in the same branch:
  - In the `append(... 'agent.tool', …)` call, pass `{ tool: event.tool, detail: toolLine, ...(event.agent ? { agent: event.agent } : {}) }`.
  - Change `if (liveStream) {` around `showTool` to `if (liveStream && !event.agent) {`, so a specialist's tools don't each send a Telegram message.
  - In the working-bubble mirror, replace `currentStep = liveStream ? telegramToolProgress(event.tool) : toolLine;` with:

```ts
                      currentStep = liveStream
                        ? (agentName ? `🤝 ${agentName} is working on their part…` : telegramToolProgress(event.tool))
                        : toolLine;
```

- [ ] **Step 6: Telegram copy and icon.** In `worker/src/connectors/telegram.ts`:
  - In `telegramToolProgress`, replace `'I’m bringing in another specialist to help with this part.'` with `'I’m getting a helper to work on part of this.'`.
  - In the same function, directly before that line, add:

    ```ts
      if (tool === 'ask_specialist') return 'I’m asking a specialist for help with part of this.';
    ```

  - In `hermesToolLine`, add `: tool === 'ask_specialist' ? '🤝'` after the `delegate_task` icon line.

- [ ] **Step 7: Run the test and the typecheck.**

Run: `cd worker && npx vitest run test/runtime-runner.test.ts test/runtime-consumer.test.ts && pnpm typecheck`
Expected: PASS. If an existing assertion on the old `delegate_task` Telegram copy fails, update it to the new copy. That is the intended change.

- [ ] **Step 8: Commit.**

```bash
git add worker/src/handoff.ts worker/src/runs.ts worker/src/runtime/runner-client.ts worker/src/runtime/run-task.ts worker/src/runtime/consumer.ts worker/src/connectors/telegram.ts worker/test/runtime-runner.test.ts
git commit -m "feat(worker): record hand-offs and say which specialist took each step" \
  -m "Each hand-off stage lands on the run as agent.handoff (who, depth, outcome code; never the brief). A specialist's steps carry its name, live and on the trace, the chat says who is being asked, and Telegram shows it in the working bubble. Hermes's own delegate_task is now called a helper." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Worker — approvals name the specialist

**Files:**
- Modify:
  - `worker/src/runtime/tasks.ts` (`RuntimeApproval`, `pauseRuntimeTaskForApproval`, `runtimeApprovalFromResult`)
  - `worker/src/runtime/consumer.ts` (both pause sites, `approvalPrompt`)
  - `worker/src/routes/runtime.ts` (GET approval)
- Test: `worker/test/runtime-runner.test.ts`

**Interfaces:**
- Consumes: `RunnerApprovalRequest.agent` (Task 7) and `specialistName` (Task 7).
- Produces:
  - `RuntimeApproval.agent?: string`, the display name, up to 60 characters.
  - `GET /api/runtime/approvals/:id` includes `agent` when present.

- [ ] **Step 1: Write the failing test.** Add a second test to `describe('specialists handing off', …)`, using the same setup as Task 7's test, with these events:

```ts
    const events = [
      { type: 'handoff', stage: 'started', specialist: 'records', name: 'Finance and records', depth: 1, seq: 1 },
      { type: 'approval', requestId: 'b'.repeat(32), tool: 'business_records', message: 'Create a draft invoice', agent: 'records', seq: 2 },
    ].map((event) => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\n';
```

And these assertions after `handleRuntimeMessage`:

```ts
    const [row] = await asTenant(A, (tx) => tx<{ approval: { id: string; agent?: string } }[]>`
      select result->'approval' as approval from runtime_task where id = ${task.id}`);
    expect(row.approval.agent).toBe('Finance and records');
    const found = await asTenant(A, (tx) => findRuntimeApproval(tx, A, row.approval.id));
    expect(found?.approval.agent).toBe('Finance and records');
```

Import `findRuntimeApproval` from `'../src/runtime/tasks'`.

- [ ] **Step 2: Run the test and watch it fail.**

Run: `cd worker && npx vitest run test/runtime-runner.test.ts -t "specialists handing off"`
Expected: FAIL, with `expected undefined to be 'Finance and records'`.

- [ ] **Step 3: Keep `agent` on the approval.** In `worker/src/runtime/tasks.ts`:
  - Add `/** The specialist asking, when a specialist's turn raised it. */ agent?: string;` to `RuntimeApproval`.
  - Add `agent?: string;` to `pauseRuntimeTaskForApproval`'s `input`.
  - Add `...(input.agent ? { agent: input.agent.slice(0, 60) } : {}),` to the `approval` object it builds, after `surface`.
  - In `runtimeApprovalFromResult`'s returned object, add after `surface,`:

```ts
    ...(typeof approval.agent === 'string' && approval.agent.trim() && approval.agent.length <= 60
      ? { agent: approval.agent }
      : {}),
```

- [ ] **Step 4: Pass it at both pause sites, and name it on Telegram.** In `worker/src/runtime/consumer.ts`, at both pause sites (the web one at ~1751 and the Telegram one), resolve the name *before* the `withTenant(…)` that calls `pauseRuntimeTaskForApproval`. Doing it inside would start a second transaction within the first:

```ts
            const approvalAgent = outcome.approval.agent
              ? await specialistName(env, message.businessId, new Map(), outcome.approval.agent)
              : undefined;
```

Then use `...(approvalAgent ? { agent: approvalAgent } : {}),` in both input objects.

Replace `approvalPrompt` with:

```ts
function approvalPrompt(tool: string, message: string, agent?: string): string {
  return [
    '⚠️ Approval needed',
    ...(agent ? [`${agent} is asking.`] : []),
    '',
    `Allow ${tool}?`,
    message.trim().slice(0, 1_000),
    '',
    `This request expires in ${HERMES_APPROVAL_WAIT_SECONDS} seconds.`,
  ].join('\n').slice(0, 4_000);
}
```

Also change its call to `approvalPrompt(approval.tool, approval.message, approval.agent)`.

- [ ] **Step 5: Return it to the app.** In `worker/src/routes/runtime.ts`'s GET approval response, add after `surface: found.approval.surface,`:

```ts
          ...(found.approval.agent ? { agent: found.approval.agent } : {}),
```

- [ ] **Step 6: Run the tests and the typecheck.**

Run: `cd worker && npx vitest run test/runtime-runner.test.ts test/orchestration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add worker/src/runtime/tasks.ts worker/src/runtime/consumer.ts worker/src/routes/runtime.ts worker/test/runtime-runner.test.ts
git commit -m "feat(worker): an approval from a specialist says which specialist is asking" \
  -m "The runtime approval keeps the specialist's name through its normalisation, the app's approval read returns it, and the Telegram prompt names it." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Worker — "Who's working on this" lists the hand-offs

**Files:**
- Modify: `worker/src/coordination.ts`
- Test: `worker/test/chat-session.test.ts`

**Interfaces:**
- Consumes: `agent.handoff` and `agent.tool` with `agent` (Task 7).
- Produces:
  - `runCoordination(...)` returns `{ assignment, events, handoffs? }`. `handoffs` is present only when non-empty, so existing callers and tests keep their exact shape.
  - The type is `RunHandoff { id: number; specialist: string; name: string; depth: number; outcome: 'working' | 'finished' | 'failed' | 'refused'; code?: string; at: string; steps: string[] }`.

- [ ] **Step 1: Write the failing test** at the end of `worker/test/chat-session.test.ts`, adding `append` to the `'../src/runs'` import:

```ts
it('reports each specialist hand-off with its outcome and the steps it took', async () => {
  const runId = await finishedRun(owner, null);
  await asTenant(A, async (tx) => {
    await append(tx, A, runId, 'agent.handoff', { stage: 'requested', specialist: 'records', depth: 1 });
    await append(tx, A, runId, 'agent.handoff', { stage: 'started', specialist: 'records', depth: 1 });
    await append(tx, A, runId, 'agent.tool', {
      tool: 'business_records', detail: '⟦Finance and records⟧ ⚙️ business_records: "invoices"', agent: 'records' });
    await append(tx, A, runId, 'agent.handoff', { stage: 'finished', specialist: 'records', depth: 1 });
    await append(tx, A, runId, 'agent.handoff', { stage: 'requested', specialist: 'growth', depth: 1 });
    await append(tx, A, runId, 'agent.handoff', { stage: 'refused', specialist: 'growth', depth: 1, code: 'limit_count' });
  });
  const data = await asTenant(A, (tx) => runCoordination(tx, A, runId));
  expect(data.handoffs).toEqual([
    expect.objectContaining({ specialist: 'records', name: 'records', depth: 1, outcome: 'finished',
      steps: ['⟦Finance and records⟧ ⚙️ business_records: "invoices"'] }),
    expect.objectContaining({ specialist: 'growth', outcome: 'refused', code: 'limit_count', steps: [] }),
  ]);
  expect(await asTenant(P1, (tx) => runCoordination(tx, A, runId))).toEqual({ assignment: null, events: [] });
});
```

Without a `specialist_profile` row, `name` falls back to the profile key.

- [ ] **Step 2: Run the test and watch it fail.**

Run: `cd worker && npx vitest run test/chat-session.test.ts`
Expected: FAIL, because `data.handoffs` is undefined. The two existing coordination tests still pass.

- [ ] **Step 3: Implement it.** In `worker/src/coordination.ts`, add:

```ts
export interface RunHandoff {
  id: number;
  specialist: string;
  name: string;
  depth: number;
  outcome: 'working' | 'finished' | 'failed' | 'refused';
  code?: string;
  at: string;
  steps: string[];
}

interface HandoffRow { seq: number; stage: string; specialist: string; depth: number | null; code: string | null; name: string | null; created_at: Date }
interface StepRow { seq: number; agent: string; detail: string }

/* One entry per request, closed by its outcome; a specialist's steps belong
   to its attempt that was open when they happened. */
function handoffsOf(rows: HandoffRow[], steps: StepRow[]): RunHandoff[] {
  const out: (RunHandoff & { openSeq: number; endSeq: number | null })[] = [];
  for (const row of rows) {
    if (row.stage === 'requested') {
      out.push({
        id: row.seq, specialist: row.specialist, name: (row.name ?? row.specialist).slice(0, 60),
        depth: row.depth ?? 1, outcome: 'working', at: row.created_at.toISOString(), steps: [],
        openSeq: row.seq, endSeq: null,
      });
      continue;
    }
    const current = [...out].reverse().find((item) => item.specialist === row.specialist && item.endSeq === null);
    if (!current) continue;
    if (row.stage === 'finished' || row.stage === 'failed' || row.stage === 'refused') {
      current.outcome = row.stage;
      if (row.code) current.code = row.code;
      current.endSeq = row.seq;
    }
  }
  for (const step of steps) {
    const owner = [...out].reverse().find((item) => item.specialist === step.agent &&
      item.openSeq < step.seq && (item.endSeq === null || item.endSeq > step.seq));
    if (owner && owner.steps.length < 40) owner.steps.push(step.detail);
  }
  return out.slice(-10).map(({ openSeq: _open, endSeq: _end, ...handoff }) => handoff);
}
```

In `runCoordination`, before its `return`, add:

```ts
  const handoffRows = await tx<HandoffRow[]>`
    select e.seq, e.payload->>'stage' as stage, e.payload->>'specialist' as specialist,
      (e.payload->>'depth')::int as depth, e.payload->>'code' as code, p.name, e.created_at
    from run_event e left join specialist_profile p on p.business_id = e.business_id
      and p.profile_key = e.payload->>'specialist'
    where e.business_id = ${businessId} and e.run_id = ${runId} and e.type = 'agent.handoff'
    order by e.seq asc limit 200`;
  const stepRows = handoffRows.length ? await tx<StepRow[]>`
    select seq, payload->>'agent' as agent, payload->>'detail' as detail from run_event
    where business_id = ${businessId} and run_id = ${runId} and type = 'agent.tool' and payload ? 'agent'
    order by seq asc limit 400` : [];
  const handoffs = handoffsOf(handoffRows, stepRows);
```

Then add `...(handoffs.length ? { handoffs } : {}),` to the returned object.

- [ ] **Step 4: Run the tests.**

Run: `cd worker && npx vitest run test/chat-session.test.ts && pnpm typecheck`
Expected: PASS, the three coordination tests included.

- [ ] **Step 5: Commit.**

```bash
git add worker/src/coordination.ts worker/test/chat-session.test.ts
git commit -m "feat(worker): who's working on this lists each specialist hand-off" \
  -m "Each hand-off comes back with the specialist, its outcome and refusal code, and the steps it took, under the same visibility rule as the run. The field is absent when a run has none, so older app builds see the shape they know." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: App — say which specialist took each step; call the helper a helper

**Files:**
- Modify:
  - `app/src/lib/task-presentation.ts`
  - `app/src/components/LiveTaskProgress.tsx`
  - `app/src/components/AskReply.tsx`
  - `app/src/styles/ask.css`
- Test: `app/src/lib/__tests__/task-presentation.test.ts`

**Interfaces:**
- Produces:
  - `splitAgentStep(step: string): { agent?: string; step: string }`
  - `StepEntry.agent?: string`
  - The `delegate` label changes to the helper wording, and a new `handoff` label is added for `ask_specialist`.

- [ ] **Step 1: Write the failing tests** at the end of `app/src/lib/__tests__/task-presentation.test.ts`, adding `splitAgentStep` to the import:

```ts
describe('steps a specialist took', () => {
  it('tags each line with the specialist and never folds two people into one line', () => {
    expect(presentTaskSteps([
      '💻 terminal: "git"',
      '⟦Finance and records⟧ 💻 terminal: "git"',
      '⟦Finance and records⟧ 💻 terminal: "python3"',
    ], 'en', { advanced: false })).toEqual([
      { label: 'Running a command', subject: 'git', count: 1 },
      { label: 'Running a command', subject: 'git, python3', count: 2, agent: 'Finance and records' },
    ]);
  });

  it('calls Hermes’s own helper a helper, and a hand-off a request for help', () => {
    expect(presentTaskSteps(['👥 delegate_task...'], 'en', { advanced: false })[0].label)
      .toBe('Getting a helper to work on part of the task');
    expect(presentTaskSteps(['🤝 ask_specialist...'], 'bm', { advanced: false })[0].label)
      .toBe('Meminta bantuan pakar');
  });

  it('reads a plain step unchanged', () => {
    expect(splitAgentStep('💻 terminal: "git"')).toEqual({ step: '💻 terminal: "git"' });
    expect(splitAgentStep('⟦Growth and marketing⟧ 🔍 web_search: "x"'))
      .toEqual({ agent: 'Growth and marketing', step: '🔍 web_search: "x"' });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd app && pnpm vitest run src/lib/__tests__/task-presentation.test.ts`
Expected: FAIL, because `splitAgentStep` is not exported.

- [ ] **Step 3: Implement it in `app/src/lib/task-presentation.ts`.**

  1. Add to `StepEntry`:

     ```ts
       /** The specialist who took this step, when it was not the lead role. */
       agent?: string;
     ```

  2. Add the reader:

     ```ts
     /* The worker tags a specialist's step as `⟦Name⟧ <tool line>`
        (worker/src/handoff.ts agentStep); everything else is the lead role's. */
     const AGENT_STEP = /^⟦([^⟦⟧\r\n]{1,60})⟧ ([\s\S]*)$/;

     export function splitAgentStep(step: string): { agent?: string; step: string } {
       const match = AGENT_STEP.exec(step);
       return match ? { agent: match[1], step: match[2] } : { step };
     }
     ```

  3. Add `| 'handoff'` to `Kind`. In `LABELS`, replace the `delegate` entry and add `handoff`:

     ```ts
       delegate: { en: 'Getting a helper to work on part of the task', bm: 'Meminta pembantu menguruskan sebahagian tugasan' },
       handoff: { en: 'Asking a specialist for help', bm: 'Meminta bantuan pakar' },
     ```

  4. In `classify`, directly after `if (tool === 'delegate_task') return { kind: 'delegate' };`, add:

     ```ts
       if (tool === 'ask_specialist') return { kind: 'handoff' };
     ```

  5. Replace the body of `presentTaskSteps` from `const entries` to the end with:

```ts
  const entries: (StepEntry & { subjects: string[] })[] = [];
  let researching = false;
  for (const raw of steps) {
    const { agent, step } = splitAgentStep(raw);
    let { kind, subject } = classify(step);
    // Infer only the broad ongoing activity from observed tools, never quote
    // narration or invent a phase such as comparing/preparing recommendations.
    if (kind === 'work' && researching) kind = 'research';
    if (kind === 'search' || kind === 'read') researching = true;
    else if (kind !== 'research' && kind !== 'work' && kind !== 'process') researching = false;
    const label = LABELS[kind][lang];
    const last = entries.at(-1);
    if (!options.advanced && last && last.label === label && last.agent === agent) {
      last.count += 1;
      if (subject && !last.subjects.includes(subject) && last.subjects.length < MAX_SUBJECTS) last.subjects.push(subject);
      continue;
    }
    entries.push({ label, count: 1, subjects: subject ? [subject] : [], ...(agent ? { agent } : {}) });
  }
  return entries.map(({ label, count, subjects, agent }) => ({
    label,
    subject: subjects.length ? subjects.join(', ') : undefined,
    count,
    ...(agent ? { agent } : {}),
  }));
```

- [ ] **Step 4: Show the tag.**
  - In `LiveTaskProgress.tsx`'s `ActivityRow`, add `{entry.agent && <span className="ask-step-agent">{entry.agent}</span>}` as the first child of `<div className="ask-activity-heading">`.
  - In the same file, replace `latest?.label` in `currentLabel` with `(latest ? (latest.agent ? `${latest.agent} · ${latest.label}` : latest.label) : undefined)`.
  - In `AskReply.tsx`'s `StepsList`, add the same `ask-step-agent` span directly before `<span className="ask-step-label">`.
  - In `app/src/styles/ask.css`, after the `.computer-preview` rules, add:

```css
/* Which specialist took a step (docs/plans/2026-09-26-specialist-handoff.md). */
.ask-step-agent { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 999px; background: var(--bg-card); color: var(--text-secondary); font-size: 11px; line-height: 18px; white-space: nowrap; }
```

- [ ] **Step 5: Run the tests and the typecheck.**

Run: `cd app && pnpm vitest run src/lib/__tests__/task-presentation.test.ts src/components && pnpm typecheck`
Expected: PASS. If an existing test asserts the old `delegate` label ('Handing part of the task to a specialist'), update it to the helper wording. That is the intended change.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/task-presentation.ts app/src/components/LiveTaskProgress.tsx app/src/components/AskReply.tsx app/src/styles/ask.css app/src/lib/__tests__/task-presentation.test.ts
git commit -m "feat(app): say which specialist took each step, and call the helper a helper" \
  -m "A specialist's steps carry its name in the live list, the status line and the finished step card, and are never folded together with the lead role's. Hermes's own delegate_task, which is an unnamed helper inside the lead role, no longer claims to be a specialist." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: App — the popover, the approval card and the trace

**Files:**
- Modify:
  - `app/src/lib/repo/types.ts`
  - `app/src/components/TaskCoordination.tsx`
  - `app/src/components/RuntimeApprovalCard.tsx`
  - `app/src/routes/views/RunTrace.tsx`
  - `app/src/i18n/pages.ts`
  - `app/src/lib/data/i18n.ts`
  - `app/src/styles/ask.css`
- Test: `app/src/components/TaskCoordination.test.tsx`, `app/src/components/__tests__/RuntimeApprovalCard.test.tsx`

**Interfaces:**
- Consumes: `runCoordination`'s `handoffs` (Task 9), the approval's `agent` (Task 8), and `presentTaskSteps` (Task 10).
- Produces: `RunHandoff` and `RunCoordination.handoffs?` in `types.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `app/src/components/TaskCoordination.test.tsx`:

```tsx
it('names each specialist who helped, what they did, and how it ended', async () => {
  mount(vi.fn().mockResolvedValue({
    assignment: { role: null, kind: 'coordinator' },
    events: [],
    handoffs: [
      { id: 7, specialist: 'records', name: 'Finance and records', depth: 1, outcome: 'finished',
        at: '2026-09-26T01:00:00Z', steps: ['⟦Finance and records⟧ ⚙️ business_records: "invoices"'] },
      { id: 9, specialist: 'growth', name: 'Growth and marketing', depth: 1, outcome: 'refused', code: 'limit_count',
        at: '2026-09-26T01:01:00Z', steps: [] },
    ],
  } satisfies RunCoordination));
  const chip = await screen.findByRole('button', { name: /Who’s working on this/ });
  expect(chip).toHaveTextContent('Chief of Staff + Finance and records, Growth and marketing');
  await userEvent.click(chip);
  expect(screen.getByText('Finance and records')).toBeInTheDocument();
  expect(screen.getByText('Finished their part')).toBeInTheDocument();
  expect(screen.getByText(/five hand-offs already used/)).toBeInTheDocument();
});
```

In the same file's existing polling test, replace `'Specialist assistance requested'` with `'A helper was asked to do part of the task'`, in both places. Append to `app/src/components/__tests__/RuntimeApprovalCard.test.tsx`, rendering the card the same way the file's first test does:

```tsx
  it('says which specialist is asking', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOnce({ approval: { ...PENDING.approval, agent: 'Finance and records' } })));
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <I18nProvider><RuntimeApprovalCard approvalId="a1" /></I18nProvider>
      </RepositoryProvider>,
    );
    expect(await screen.findByText('Finance and records needs your go-ahead')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and watch them fail.**

Run: `cd app && pnpm vitest run src/components/TaskCoordination.test.tsx src/components/__tests__/RuntimeApprovalCard.test.tsx`
Expected: FAIL. The chip shows only "Chief of Staff", and the approval title is generic.

- [ ] **Step 3: Types.** In `app/src/lib/repo/types.ts`, above `RunCoordination`, add:

```ts
/** One specialist hand-off in a run (docs/plans/2026-09-26-specialist-handoff.md). */
export interface RunHandoff {
  id: number;
  specialist: string;
  name: string;
  depth: number;
  outcome: 'working' | 'finished' | 'failed' | 'refused';
  code?: string;
  at: string;
  steps: string[];
}
```

Then add `handoffs?: RunHandoff[];` to `RunCoordination`.

- [ ] **Step 4: Text, in English and Bahasa Malaysia together.** In `app/src/i18n/pages.ts`, replace the `handoff.requested`, `handoff.returned`, `handoff.failed`, `handoff.evidence` and `handoff.none` values, and add the new keys, in the `en` block:

```ts
    'handoff.requested': 'A helper was asked to do part of the task',
    'handoff.returned': 'The helper handed its part back',
    'handoff.failed': 'The helper reported an error',
    'handoff.evidence': 'Named specialists are your own Jentera specialists, each with its own memory. A helper is an unnamed assistant working inside the lead role. A finished part is not proof the whole task succeeded.',
    'handoff.none': 'No hand-offs recorded. Assignment alone is not a hand-off.',
    'handoff.specialists': 'Specialists who helped',
    'handoff.with': '{role} + {names}',
    'handoff.outcome.working': 'Working',
    'handoff.outcome.finished': 'Finished their part',
    'handoff.outcome.failed': 'Could not finish',
    'handoff.outcome.refused': 'Not handed over',
    'handoff.code.unavailable': 'hand-offs are off here',
    'handoff.code.unknown_specialist': 'not one of your specialists',
    'handoff.code.loop': 'already in the chain',
    'handoff.code.limit_depth': 'too many levels deep',
    'handoff.code.limit_count': 'five hand-offs already used',
    'handoff.code.time': 'ran out of time',
    'handoff.code.budget': 'AI credits used up',
    'handoff.code.failed': 'the specialist hit an error',
    'handoff.code.stopped': 'the task was stopped',
```

and in the `bm` block:

```ts
    'handoff.requested': 'Pembantu diminta membuat sebahagian tugasan',
    'handoff.returned': 'Pembantu menyerahkan semula bahagiannya',
    'handoff.failed': 'Pembantu melaporkan ralat',
    'handoff.evidence': 'Pakar bernama ialah pakar Jentera anda sendiri, masing-masing dengan memori sendiri. Pembantu ialah pembantu tanpa nama yang bekerja di dalam peranan utama. Bahagian yang selesai bukan bukti seluruh tugasan berjaya.',
    'handoff.none': 'Tiada serahan direkodkan. Tugasan yang diberikan sahaja bukan serahan.',
    'handoff.specialists': 'Pakar yang membantu',
    'handoff.with': '{role} + {names}',
    'handoff.outcome.working': 'Sedang bekerja',
    'handoff.outcome.finished': 'Selesai bahagian mereka',
    'handoff.outcome.failed': 'Tidak dapat diselesaikan',
    'handoff.outcome.refused': 'Tidak diserahkan',
    'handoff.code.unavailable': 'serahan tidak dihidupkan di sini',
    'handoff.code.unknown_specialist': 'bukan salah seorang pakar anda',
    'handoff.code.loop': 'sudah ada dalam rantaian',
    'handoff.code.limit_depth': 'terlalu banyak peringkat',
    'handoff.code.limit_count': 'lima serahan sudah digunakan',
    'handoff.code.time': 'kehabisan masa',
    'handoff.code.budget': 'kredit AI sudah habis',
    'handoff.code.failed': 'pakar mengalami ralat',
    'handoff.code.stopped': 'tugasan dihentikan',
```

In `app/src/lib/data/i18n.ts`, add beside `"ask.approval.title"`:
- English: `"ask.approval.titleBy": "{name} needs your go-ahead",`
- Bahasa Malaysia: `"ask.approval.titleBy": "{name} perlukan kelulusan anda",`

- [ ] **Step 5: The popover.** In `app/src/components/TaskCoordination.tsx`:

  1. Replace `const t = useT();` with `const { lang, t } = useI18n();`, changing the import to `useI18n`.
  2. Import `presentTaskSteps` from `'@/lib/task-presentation'`.
  3. Change the early return to:

     ```tsx
       if (!error && (!data || (!data.assignment && !data.events.length && !data.handoffs?.length))) return null;
     ```

  4. After `const role = …`, add:

```tsx
  const names = [...new Set((data?.handoffs ?? []).map((handoff) => handoff.name))];
  const label = names.length ? t('handoff.with', { role, names: names.join(', ') }) : role;
  const CODES = new Set(['unavailable', 'unknown_specialist', 'loop', 'limit_depth', 'limit_count', 'time', 'budget', 'failed', 'stopped']);
  const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
```

  5. In the chip, use `label` where `{role}` is rendered in the `<span>` and in the `aria-label`.
  6. In the popover, directly after `{data.assignment && <p>…</p>}`, add:

```tsx
      {data.handoffs?.length ? <ol className="task-coordination-handoffs" aria-label={t('handoff.specialists')}>
        {data.handoffs.map((handoff) => <li key={handoff.id}>
          <div className="task-coordination-handoff">
            <strong>{handoff.name}</strong>
            <span>{t(`handoff.outcome.${handoff.outcome}`)}</span>
            {handoff.code && CODES.has(handoff.code) && <span>{t(`handoff.code.${handoff.code}`)}</span>}
            <time dateTime={handoff.at}>{clock(handoff.at)}</time>
          </div>
          {handoff.steps.length > 0 && <ul>
            {presentTaskSteps(handoff.steps, lang, { advanced: false }).map((entry, index) => <li key={index}>
              {entry.label}{entry.subject ? ` · ${entry.subject}` : ''}{entry.count > 1 ? ` ×${entry.count}` : ''}
            </li>)}
          </ul>}
        </li>)}
      </ol> : null}
```

  7. Change the evidence line to `t(data.events.length || data.handoffs?.length ? 'handoff.evidence' : 'handoff.none')`, and use the `clock(event.at)` helper in the existing events list.
  8. In `app/src/styles/ask.css`, add:

```css
/* One specialist's line in "Who's working on this": name, outcome, reason, time. */
.task-coordination-handoff { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.task-coordination-handoff span + span::before { content: '· '; }
```

- [ ] **Step 6: The approval card and the trace.**
  - In `app/src/components/RuntimeApprovalCard.tsx`, add `agent?: string;` to `PendingApproval`, and set the title to `title={approval?.agent ? t('ask.approval.titleBy', { name: approval.agent }) : t('ask.approval.title')}`.
  - In `app/src/routes/views/RunTrace.tsx`'s `PLAIN`, add `'agent.handoff': 'Handed part to a specialist',`.

- [ ] **Step 7: Run the app suite, the parity test and the typecheck.**

Run: `cd app && pnpm vitest run src/components src/i18n && pnpm typecheck`
Expected: PASS. `pages-parity.test.ts` confirms the English and Malay keys match.

- [ ] **Step 8: Commit.**

```bash
git add app/src/lib/repo/types.ts app/src/components/TaskCoordination.tsx app/src/components/RuntimeApprovalCard.tsx app/src/routes/views/RunTrace.tsx app/src/i18n/pages.ts app/src/lib/data/i18n.ts app/src/styles/ask.css app/src/components/TaskCoordination.test.tsx app/src/components/__tests__/RuntimeApprovalCard.test.tsx
git commit -m "feat(app): who's working on this names the specialists and what they did" \
  -m "The chip reads 'Chief of Staff + Finance and records'; the popover lists each specialist's outcome, refusal reason and steps; an approval from a specialist names it; the trace labels the hand-off. The anonymous delegate_task helper is described as a helper, in English and Bahasa Malaysia." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: An end-to-end test against the pinned Hermes (opt-in)

This is the feasibility setup rebuilt as a permanent test. It is skipped unless `HANDOFF_E2E_HERMES` names a Hermes checkout at the new tag, with a `.venv` that has `.[messaging]` installed. It needs Python, so it never runs in the default suite.

**Files:**
- Create:
  - `runner/test/fixtures/scripted-model.py`
  - `runner/test/handoff-hermes.e2e.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–4.

- [ ] **Step 1: Write the scripted model.** Create `runner/test/fixtures/scripted-model.py`:

```python
"""Scripted OpenAI-compatible model for the hand-off end-to-end test.
COORDINATOR_TASK -> call ask_specialist(records); a tool result -> COMBINED answer;
SPECIALIST_TASK -> an answer. Streams, like Hermes asks for."""
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def text(content):
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def decide(body):
    messages = body.get("messages", [])
    tools = [m for m in messages if m.get("role") == "tool"]
    users = [text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = users[-1] if users else ""
    if tools:
        return {"content": "COMBINED: " + text(tools[-1].get("content"))[:400]}
    if "COORDINATOR_TASK" in last:
        args = json.dumps({"specialist": "records", "brief": "SPECIALIST_TASK: count unpaid invoices"})
        return {"call": {"id": "call_1", "name": "ask_specialist", "arguments": args}}
    if "SPECIALIST_TASK" in last:
        return {"content": "SPECIALIST_RESULT: 3 unpaid invoices"}
    return {"content": "ok"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        data = json.dumps({"object": "list", "data": [{"id": "mock/model"}]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if not self.path.endswith("/chat/completions"):
            self.send_response(404); self.end_headers(); return
        reply = decide(body)
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        if "call" in reply:
            c = reply["call"]
            first = {"role": "assistant", "tool_calls": [{"index": 0, "id": c["id"], "type": "function",
                                                          "function": {"name": c["name"], "arguments": c["arguments"]}}]}
            finish = "tool_calls"
        else:
            first, finish = {"role": "assistant", "content": reply["content"]}, "stop"
        for delta, reason in ((first, None), ({}, finish)):
            chunk = {"id": "m", "object": "chat.completion.chunk", "created": int(time.time()), "model": "mock/model",
                     "choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
```

- [ ] **Step 2: Write the test.** Create `runner/test/handoff-hermes.e2e.test.mjs`. Copy `grant()`, `listen()`, `close()` and `waitFor()` from `test/server.test.mjs`; they are not exported from there.

```js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRunner } from '../src/server.mjs';

const HERMES = process.env.HANDOFF_E2E_HERMES;
const BUSINESS = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const RUNNER_KEY = 'r'.repeat(32);
const HERMES_KEY = 'e2e-hermes-key-0123456789abcdef0123456789abcdef';

test('Chief of Staff hands part of a task to records on the pinned Hermes', { skip: !HERMES, timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handoff-e2e-'));
  const children = [];
  try {
    const modelPort = 18900 + Math.floor(Math.random() * 500);
    const hermesPort = 19500 + Math.floor(Math.random() * 500);
    children.push(spawn('python3', [new URL('./fixtures/scripted-model.py', import.meta.url).pathname, String(modelPort)], { stdio: 'ignore' }));
    const home = join(dir, 'home');
    await mkdir(join(home, 'profiles', 'records'), { recursive: true });
    const config = [
      'model:', '  default: mock/model', '  provider: openrouter', `  base_url: http://127.0.0.1:${modelPort}/v1`,
      '  api_key: ${OPENROUTER_API_KEY}', '  api_mode: chat_completions',
      'platform_toolsets:', '  api_server: [hermes-api-server, jentera]',
      'agent:', '  max_turns: 6', '  run_budget_seconds: 120', '  gateway_timeout: 120',
      'gateway:', '  multiplex_profiles: true', '  api_server:', '    max_concurrent_runs: 10', '',
    ].join('\n');
    await writeFile(join(home, 'config.yaml'), config);
    await writeFile(join(home, 'profiles', 'records', 'config.yaml'), config);
    await writeFile(join(home, '.env'), `API_SERVER_ENABLED=true\nAPI_SERVER_KEY=${HERMES_KEY}\nOPENROUTER_API_KEY=e2e\nOPENROUTER_BASE_URL=http://127.0.0.1:${modelPort}/v1\n`, { mode: 0o600 });
    await writeFile(join(home, 'profiles', 'records', '.env'), `OPENROUTER_API_KEY=e2e\nOPENROUTER_BASE_URL=http://127.0.0.1:${modelPort}/v1\n`, { mode: 0o600 });
    await writeFile(join(home, 'profiles', 'records', 'SOUL.md'), '# Finance and records (e2e)\n');

    const runner = createRunner({
      businessBrowser: { ensure: async () => {}, isPaused: async () => false, status: async () => ({}), preview: async () => ({}), command: async () => ({}) },
      businessId: BUSINESS, runnerKey: RUNNER_KEY, hermesKey: HERMES_KEY,
      hermesOrigin: `http://127.0.0.1:${hermesPort}`, release: 'e2e', toolMode: 'full-tools', webSearchBackend: 'ddgs',
      capabilities: [], modelName: 'mock/model', deepModelName: 'mock/model', candidateModelNames: [],
      stateFile: join(dir, 'state.json'),
      configChannel: {
        state: () => ({}), profiles: () => ['records'], handoffEnabled: () => true,
        roster: () => [{ profile: 'records', name: 'Finance and records', description: 'Invoices.', instructions: '' }],
        loadLastKnownGood: async () => {}, refresh: async () => 'unchanged', applyPending: async () => false, backoffMs: () => 60_000,
      },
    });
    const runnerOrigin = await listen(runner);
    children.push(spawn(join(HERMES, '.venv', 'bin', 'hermes'), ['gateway', 'run', '--force'], {
      cwd: HERMES, stdio: 'ignore',
      env: { ...process.env, HERMES_HOME: home, HERMES_KANBAN_DB: join(home, 'kanban.db'),
        API_SERVER_HOST: '127.0.0.1', API_SERVER_PORT: String(hermesPort),
        OPENROUTER_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, JENTERA_RUNNER_URL: runnerOrigin },
    }));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${hermesPort}/health`).catch(() => null))?.ok, 60_000);

    const started = await fetch(`${runnerOrigin}/v1/tasks`, {
      method: 'POST',
      headers: { 'X-Aisar-Runner-Key': RUNNER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: BUSINESS, taskId: TASK, leaseToken: 'l'.repeat(32), input: 'COORDINATOR_TASK: check unpaid invoices',
        toolGrant: grant(TASK), handoff: { maxDepth: 2, maxHandoffs: 5, preamble: 'You are working on part of a task for a colleague.' } }),
    });
    assert.equal(started.status, 202);
    let status;
    await waitFor(async () => {
      status = await (await fetch(`${runnerOrigin}/v1/tasks/${TASK}`, { headers: { 'X-Aisar-Runner-Key': RUNNER_KEY } })).json();
      return ['completed', 'failed'].includes(status.status);
    }, 120_000);
    assert.equal(status.status, 'completed');
    assert.match(status.output, /COMBINED: .*SPECIALIST_RESULT: 3 unpaid invoices/);
    const stream = await (await fetch(`${runnerOrigin}/v1/tasks/${TASK}/events`, { headers: { 'X-Aisar-Runner-Key': RUNNER_KEY } })).text();
    assert.match(stream, /"type":"handoff","stage":"finished","specialist":"records"/);
    assert.doesNotMatch(stream, /count unpaid invoices/);
    await close(runner);
  } finally {
    for (const child of children) child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run it against the new Hermes tag** from Task 2's worktree. Install that worktree's venv first, as in Task 1 Step 1.

Run: `cd runner && HANDOFF_E2E_HERMES=<hermes-worktree> node --test test/handoff-hermes.e2e.test.mjs`
Expected: PASS. Without the variable, `node --test` reports the test as skipped.

- [ ] **Step 4: Commit.**

```bash
git add runner/test/fixtures/scripted-model.py runner/test/handoff-hermes.e2e.test.mjs
git commit -m "test(runner): an opt-in end-to-end hand-off against a real Hermes" \
  -m "Skipped unless HANDOFF_E2E_HERMES names a Hermes checkout. A scripted model makes Chief of Staff call ask_specialist; the runner runs records on its own profile, the answer comes back and the brief never reaches the stream." \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Docs, then the release (owner-gated)

**Files:**
- Modify:
  - `CLAUDE.md`
  - `docs/todo.md`
  - `docs/plans/2026-09-26-specialist-handoff.md` (As built)
  - `worker/src/runtime/hermes-pin.ts`
  - `worker/wrangler.toml` (the switch, at step 7)

- [ ] **Step 1: Document it.** Add a paragraph to `CLAUDE.md` under "Where work runs", after the specialist-routing paragraph:

```markdown
Specialists can hand part of a task to each other
(`docs/plans/2026-09-26-specialist-handoff.md`, plan beside it). The caller's
Hermes turn calls `ask_specialist`; the tool asks the runner on loopback with
the Hermes key (`POST /v1/handoff`, answered before the runner-key check),
and `runner/src/handoff.mjs` runs the specialist at `/p/<profile>/v1/runs`
while the caller waits, relaying its tools and approvals marked `agent`. The
limits hold in the runner: two levels, five hand-offs, one at a time, and
`min(time left − 60 s, 390 s)` — under Hermes's 420 s guard on batched tool
calls. The brief never leaves the sprite: `ask_specialist`'s own step has no
preview. The switch is `HANDOFF_BUSINESS_IDS` (empty means nobody); a business
on it gets `handoff: { enabled: true }` in its config document, which the
tool's availability check reads. Hermes caches that check for 30 s, so the
runner also refuses any task that carried no limits. Steps from a specialist
are `⟦Name⟧ <tool line>` (`agentStep` / `splitAgentStep`); runs record
`agent.handoff`; "Who's working on this" lists them.
```

In `docs/todo.md`, add under open items:
  - The first live hand-off on Kitakod with an approval in the middle (Task 13 step 8).
  - Specialist usage is kept in runner memory only; a runner restart mid-task undercounts it.
  - Files a specialist writes land only if it uses the task's outputs folder, which the preamble points it at.
  - The approval window is still 60 s (gap 4).

In the spec, add an "As built" section that lists this plan's seven rulings.

Commit these three files with `docs: specialist hand-offs as built`.

- [ ] **Step 2: Push the branch and ship the app.** Ask the owner before each outward step in this task.
  1. `git fetch origin && git rebase origin/main`, then run the full suites: `cd runner && npm test`; `cd worker && pnpm test && pnpm typecheck`; `cd app && pnpm vitest run && pnpm typecheck`.
  2. Push: `git push origin HEAD:main`, which is a fast-forward.
  3. Deploy the app first. Follow the memory note on deploying from a clean tree: build from a `git archive` of `HEAD`, confirm the live Pages source is an ancestor of `HEAD`, then `wrangler pages deploy`.

- [ ] **Step 3: Tag the Hermes fork.**
  1. In the fork worktree, put Task 2's commit on `release-lineage-2026.9.18`: `git checkout release-lineage-2026.9.18 && git merge --ff-only jentera-ask-specialist`.
  2. Pick a free tag of the form `vYYYY.M.D`. It must have **no suffix**, because a suffix breaks every sprite's bootstrap. Check `git tag -l 'v2026.9.*'`, and remember upstream owns some dates.
  3. Create it: `git tag -a v2026.9.<D> -m "v2026.9.<D> — Jentera: ask_specialist hands part of a task to another specialist"`.
  4. Push both: `git push fork release-lineage-2026.9.18 v2026.9.<D>`.

- [ ] **Step 4: Pin it.** In `worker/src/runtime/hermes-pin.ts`, set `HERMES_TAG` to the new tag and `HERMES_COMMIT` to its full sha. Run `cd worker && pnpm test test/runtime.test.ts && pnpm typecheck`. Then commit with `chore(runtime): pin Hermes v2026.9.<D> for ask_specialist` and push.

- [ ] **Step 5: Run the runtime release.**
  1. Run `worker/scripts/ship-runtime.sh -m "specialists hand work to each other (switch empty)" --dry-run`.
  2. Check that the printed `RUNTIME_BUNDLE_COMMIT` is the pin commit you just pushed.
  3. Run it again without `--dry-run`.
  4. Expected: the gate passes, the fleet converges, and `fleet-verify.sh` passes on every sprite.

  This also deploys the Worker with `HANDOFF_BUSINESS_IDS` still empty, so nothing changes for anyone. No bootstrap transfer field was added.

- [ ] **Step 6: Confirm nothing changed for anyone.**
  1. On any sprite, check `/v1/handoff/available`: `worker/scripts/fleet-exec.sh 'curl -s -H "Authorization: Bearer $HERMES_API_KEY" http://127.0.0.1:8080/v1/handoff/available'` should report `"available":false` everywhere.
  2. Check that the live Worker bundle contains `agent.handoff`, using the content/v2 check in the deploy memory.

- [ ] **Step 7: Switch it on for Kitakod.** This is the owner's call.
  1. Confirm Kitakod's business id with `./worker/scripts/stats.sh users`.
  2. Set `HANDOFF_BUSINESS_IDS = "<id>"` in `worker/wrangler.toml`.
  3. Commit `feat(worker): hand-offs on for Kitakod`, push, and `cd worker && pnpm run deploy`.
  4. The sprite picks up the new config document on its next wake.

- [ ] **Step 8: The live check.** In Kitakod's app, ask a deep task that crosses remits. For example: "Check which Bukku invoices are unpaid and draft a follow-up for the oldest one" (`/deep`). Verify:
  - "Who's working on this" reads "Chief of Staff + Finance and records" and lists that specialist's steps.
  - The reply credits Finance and records.
  - An approval from the specialist, if any, is titled with its name, and approving it lets the task finish.
  - The run's trace shows `agent.handoff` and never the brief.

  Record the result in `docs/todo.md`, moving the live-check item to Closed.
