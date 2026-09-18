import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_MARKER = '# Jentera: time API agent startup without retaining content.';
const INIT_MARKER = '# Jentera: time constructor checkpoints only inside a traced API run.';

// Exact anchors from the centrally pinned Hermes source. Marks are completed checkpoints:
// stageMs is time since the previous mark, elapsedMs is since API startup.
export const API_CHECKPOINTS = [
  ['        runtime_kwargs = _resolve_runtime_agent_kwargs()\n', 'api.imports'],
  ['        reasoning_config = GatewayRunner._load_reasoning_config()\n', 'api.runtime_credentials'],
  ['        session_override = self._session_model_override_for(\n', 'api.route_defaults'],
  ['        user_config = _load_gateway_config()\n', 'api.route_resolution'],
  ['        enabled_toolsets = sorted(_get_platform_tools(user_config, "api_server"))\n', 'api.gateway_config'],
  ['        configured_max_iterations = _current_max_iterations()\n', 'api.toolset_resolution'],
  ['        fallback_model = GatewayRunner._load_fallback_model()\n', 'api.iteration_config'],
  ['        agent = AIAgent(\n', 'api.agent_options'],
  ['        return agent\n', 'api.agent_constructed'],
];

export const INIT_CHECKPOINTS = [
  ['    _install_safe_stdio()\n', 'init.imports'],
  ['    # Eagerly warm the transport cache so import errors surface at init,\n', 'init.base_state'],
  ['    try:\n        from hermes_cli.model_normalize import (\n', 'init.transport'],
  ['    # Pre-warm OpenRouter model metadata cache in a background thread.\n', 'init.model_route'],
  ['    _provider_timeout = get_provider_request_timeout(agent.provider, agent.model)\n', 'init.pre_client_state'],
  ['            verify_ca_bundle_with_fallback()\n', 'init.client_options'],
  ['            agent.client = agent._create_openai_client(client_kwargs, reason="agent_init", shared=True)\n', 'init.certificates'],
  ['    # Provider fallback chain — ordered list of backup providers tried\n', 'init.client_ready'],
  ['    # Get available tools with filtering. Capture the registry generation this\n', 'init.fallback_state'],
  ['    # Show tool configuration and store valid tool names for validation\n', 'init.tool_definitions'],
  ['    # Session logging setup - auto-save conversation trajectories for debugging\n', 'init.tool_guidance'],
  ['    # Filesystem checkpoint manager (transparent — not a tool)\n', 'init.session_state'],
  ['    # Read explicit context_length override from model config\n', 'init.memory_and_compression_config'],
  ['    agent._config_context_length = _config_context_length\n', 'init.context_config'],
  ['    _bind_session_state = getattr(agent.context_compressor, "bind_session_state", None)\n', 'init.context_engine'],
  ['    # Snapshot primary runtime for per-turn restoration.  When fallback\n', 'init.final_setup'],
];

const STAGES = ['start', ...API_CHECKPOINTS.map(([, stage]) => stage),
  ...INIT_CHECKPOINTS.map(([, stage]) => stage), 'complete', 'failed'];

export const STARTUP_HELPER = `"""Content-free, monotonic startup diagnostics; never change agent behaviour."""
from contextlib import contextmanager
from contextvars import ContextVar
import json
import logging
import re
import time

_current = ContextVar("jentera_startup_trace", default=None)
_logger = logging.getLogger("jentera.startup")
_stages = frozenset(${JSON.stringify(STAGES)})

class _Trace:
    def __init__(self, run_id):
        self.run_id = run_id
        self.started = self.previous = time.monotonic_ns()

    def mark(self, stage):
        # Logging failures must never abort or replace an agent result/error.
        try:
            if stage not in _stages:
                return
            now = time.monotonic_ns()
            record = {
                "runtimeRunId": self.run_id,
                "stage": stage,
                "stageMs": round((now - self.previous) / 1_000_000, 1),
                "elapsedMs": round((now - self.started) / 1_000_000, 1),
            }
            self.previous = now
            _logger.info("[hermes-startup] %s", json.dumps(record, separators=(",", ":")))
        except Exception:
            pass

def startup_mark(stage):
    trace = _current.get()
    if trace is not None:
        trace.mark(stage)

@contextmanager
def trace_startup(run_id):
    # Only the server-generated opaque run ID crosses this log boundary.
    # Missing/invalid IDs disable logging, including non-/v1/runs callers.
    valid = isinstance(run_id, str) and re.fullmatch(r"run_[0-9a-f]{32}", run_id) is not None
    trace = _Trace(run_id) if valid else None
    token = _current.set(trace)
    try:
        startup_mark("start")
        yield
    except BaseException:
        startup_mark("failed")
        raise
    else:
        startup_mark("complete")
    finally:
        _current.reset(token)
`;

function replaceUnique(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`reviewed Hermes startup anchor drifted: ${JSON.stringify(anchor)}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function checkpoints(source, entries) {
  for (const [anchor, stage] of entries) {
    const indent = anchor.match(/^ */)[0];
    source = replaceUnique(source, anchor, `${indent}_startup_mark("${stage}")\n${anchor}`);
  }
  return source;
}

function apiPatch(source) {
  if (source.includes(API_MARKER)) return source;
  // Preserve every caller/signature/default; the wrapper consumes only our
  // private correlation keyword before forwarding the original arguments.
  source = replaceUnique(source, '    def _create_agent(\n', [
    `    ${API_MARKER}`,
    '    def _create_agent(self, *args, **kwargs):',
    '        from agent.jentera_startup import trace_startup',
    '        with trace_startup(kwargs.pop("_jentera_run_id", None)):',
    '            return self._jentera_create_agent_impl(*args, **kwargs)',
    '',
    '    def _jentera_create_agent_impl(',
    '',
  ].join('\n'));
  const start = source.indexOf('    def _jentera_create_agent_impl(');
  const returnAt = source.indexOf('        return agent\n', start);
  if (returnAt < start) throw new Error('reviewed Hermes startup method boundary drifted');
  const end = returnAt + '        return agent\n'.length;
  let method = source.slice(start, end);
  method = replaceUnique(method, '        from run_agent import AIAgent\n',
    '        from agent.jentera_startup import startup_mark as _startup_mark\n        from run_agent import AIAgent\n');
  method = checkpoints(method, API_CHECKPOINTS);
  source = source.slice(0, start) + method + source.slice(end);
  return replaceUnique(source, '                        max_iterations=requested_max_iterations,\n',
    '                        _jentera_run_id=run_id,\n                        max_iterations=requested_max_iterations,\n');
}

function initPatch(source) {
  if (source.includes(INIT_MARKER)) return source;
  // Import inside the function: no change to upstream module import order.
  source = replaceUnique(source, '    _install_safe_stdio()\n',
    `    ${INIT_MARKER}\n    from agent.jentera_startup import startup_mark as _startup_mark\n    _install_safe_stdio()\n`);
  return checkpoints(source, INIT_CHECKPOINTS);
}

export async function patchHermesStartupTiming(root, { verify = false } = {}) {
  const apiPath = join(root, 'gateway/platforms/api_server.py');
  const initPath = join(root, 'agent/agent_init.py');
  const helperPath = join(root, 'agent/jentera_startup.py');
  const api = await readFile(apiPath, 'utf8');
  const init = await readFile(initPath, 'utf8');
  const patchedApi = apiPatch(api);
  const patchedInit = initPatch(init);
  // Verify all marks, not merely a marker: partial/tampered patches fail.
  if (!patchedApi.includes('with trace_startup(kwargs.pop("_jentera_run_id", None)):') ||
      !patchedApi.includes('                        _jentera_run_id=run_id,\n') ||
      !patchedInit.includes(INIT_MARKER) ||
      API_CHECKPOINTS.some(([, stage]) => !patchedApi.includes(`_startup_mark("${stage}")`)) ||
      INIT_CHECKPOINTS.some(([, stage]) => !patchedInit.includes(`_startup_mark("${stage}")`))) {
    throw new Error('Hermes startup diagnostic patch is incomplete');
  }
  if (verify) {
    if (api !== patchedApi || init !== patchedInit || await readFile(helperPath, 'utf8') !== STARTUP_HELPER) {
      throw new Error('Hermes startup diagnostic patch is missing or changed');
    }
    return;
  }
  // Resolve/validate both files before writing either; no half-patch on drift.
  await writeFile(helperPath, STARTUP_HELPER, { mode: 0o644 });
  await writeFile(initPath, patchedInit, { mode: 0o644 });
  await writeFile(apiPath, patchedApi, { mode: 0o644 });
}
