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

/** Safe relay kinds: everything else `translate` might return stays off the stream. */
const RELAYED_TYPES = new Set(['tool.started', 'tool.completed', 'approval']);

export class HandoffEngine {
  constructor(deps) {
    this.deps = { now: () => Date.now(), ...deps };
    this.tasks = new Map();
    this.runs = new Map();
  }

  /** The task that just started. One task runs at a time, so any earlier one is forgotten.
   *  Forgetting it is not enough on its own: a still-running previous task's
   *  specialists would otherwise keep going with nothing left able to stop
   *  them. Send their stop first — fire-and-forget, since register is
   *  synchronous and only the calls need to be sent, not awaited. */
  register(taskId, { rootRunId, rootProfile, deadlineAt, model, handoff, outputsInstruction = '' }) {
    for (const task of this.tasks.values()) {
      task.stopped = true;
      for (const run of task.liveRuns.values()) void run.stopOnce();
      task.controller.abort();
    }
    this.tasks.clear();
    this.runs.clear();
    if (!handoff) return;
    /* The task's own controller: stopping the task aborts this, which cascades
       into every live run's combined signal below it, whatever its depth. */
    const controller = new AbortController();
    this.tasks.set(taskId, {
      taskId,
      deadlineAt,
      model,
      outputsInstruction,
      limits: { maxDepth: handoff.maxDepth, maxHandoffs: handoff.maxHandoffs },
      preamble: handoff.preamble,
      used: 0,
      usage: null,
      liveRuns: new Map(),
      stopped: false,
      controller,
    });
    this.runs.set(rootRunId, {
      taskId, depth: 0, chain: [rootProfile ?? 'default'], queue: Promise.resolve(),
      signal: controller.signal, deadline: deadlineAt,
    });
  }

  /** Tokens the task's specialists used, to add to its own. */
  usageOf(taskId) {
    return this.tasks.get(taskId)?.usage ?? null;
  }

  /** Stop every specialist working for this task, and refuse any that would follow. */
  async stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.stopped = true;
    /* Ask every run this task currently knows about directly, rather than
       trusting the cascade alone: a run's own listener is memoised, so this
       and the cascade below never send the same stop twice. */
    const stops = [...task.liveRuns.values()].map((run) => run.stopOnce());
    task.controller.abort();
    await Promise.allSettled(stops);
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
       where a specialist asks for help while its own caller waits on it.
       A turn that rejects must not poison the queue for the next one. */
    const turn = caller.queue.then(() => this.handOff(task, caller, specialist, brief.trim()));
    caller.queue = turn.then(() => undefined, () => undefined);
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
    /* A hand-off gets only what its own caller has left, not the whole task's
       remaining time — so a grandchild can never outlive its parent. */
    const budgetMs = handoffBudgetMs(caller.deadline, this.deps.now());
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
    /* Even a failed start is a stopped task's business first: the caller
       already knows why nothing is happening for it. */
    if (typeof body?.run_id !== 'string') return task.stopped ? fail('stopped') : fail('failed');

    const runId = body.run_id;
    /* This run's own budget timer, combined with whatever would already stop
       its caller: either aborting unblocks the stream read below and stops
       Hermes exactly once, whichever fired. */
    const own = new AbortController();
    const signal = AbortSignal.any([caller.signal, own.signal]);
    const deadline = this.deps.now() + budgetMs;
    this.runs.set(runId, { taskId: task.taskId, depth, chain: [...caller.chain, key], queue: Promise.resolve(), signal, deadline });

    let stopping = null;
    const stopOnce = () => {
      if (!stopping) {
        stopping = this.deps.hermes(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' }, key)
          .catch(() => undefined);
      }
      return stopping;
    };
    task.liveRuns.set(runId, { profile: key, stopOnce });
    const onAbort = () => { void stopOnce(); };
    signal.addEventListener('abort', onAbort, { once: true });
    mark('started');
    /* A stop that landed while the start's own POST was in flight leaves the
       combined signal already aborted the moment it is built above: an
       'abort' listener added to an already-aborted signal never fires, and
       aborting `own` now would not either, since nothing transitions.
       Sending the stop directly is the only way this run still gets one. */
    if (signal.aborted) void stopOnce();
    const timer = setTimeout(() => own.abort(), budgetMs);
    try {
      const outcome = await this.follow(task.taskId, runId, key, signal);
      if (outcome.usage) task.usage = addUsage(task.usage, outcome.usage);
      if (task.stopped) return fail('stopped');
      if (signal.aborted) return fail('time');
      if (outcome.status === 'completed' && typeof outcome.output === 'string' && outcome.output.trim()) {
        mark('finished');
        return { ok: true, specialist: key, name: entry.name, answer: outcome.output.slice(0, HANDOFF_ANSWER_MAX) };
      }
      return fail(BUDGET.test(String(outcome.error ?? '')) ? 'budget' : 'failed');
    } finally {
      clearTimeout(timer);
      /* Detach rather than rely on the combined signal becoming unreachable:
         a cascade that arrives after this run has already concluded on its
         own must never send a stray, late stop for it. */
      signal.removeEventListener('abort', onAbort);
      task.liveRuns.delete(runId);
      this.runs.delete(runId);
      /* This run's own pending approval, if it never got an answer, would
         otherwise sit at the head of the task's approval queue forever and
         block every later approval in the task. */
      this.deps.ended?.(task.taskId, runId);
    }
  }

  /** One direct look at Hermes's own record of a run, if it has reached an end. */
  async statusOnce(runId, profile) {
    const response = await this.deps.hermes(`/v1/runs/${encodeURIComponent(runId)}`, {}, profile).catch(() => null);
    const status = response?.ok ? await response.json().catch(() => null) : null;
    const state = typeof status?.status === 'string' ? status.status.toLowerCase() : '';
    return TERMINAL.has(state) ? { status: state, output: status.output, usage: status.usage, error: status.error } : null;
  }

  /** Follow a specialist's run to its end, relaying its tools and approvals. */
  async follow(taskId, runId, profile, signal) {
    const target = { runId, profile };
    if (!signal.aborted) {
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
              if (event.event === 'run.failed') return { status: 'failed', error: event.error, usage: event.usage };
              if (event.event === 'run.cancelled') return { status: 'cancelled', usage: event.usage };
              const safe = this.deps.translate(event, profile);
              if (safe && RELAYED_TYPES.has(safe.type)) this.deps.emit(taskId, { ...safe, agent: profile }, target);
            }
          }
        }
      } catch {
        /* Stream lost or aborted; a direct look at Hermes below settles it,
           at least once even when the run must not keep going. */
      }
    }
    /* No terminal event arrived over the stream. While the run is still
       meant to continue, ask Hermes directly until one appears; otherwise —
       stopped, timed out, or the stream simply ended — ask once more so a
       usage figure Hermes already has is not lost. */
    while (!signal.aborted) {
      const outcome = await this.statusOnce(runId, profile);
      if (outcome) return outcome;
      await pause(1_000, signal);
    }
    return (await this.statusOnce(runId, profile)) ?? { status: 'cancelled' };
  }
}
