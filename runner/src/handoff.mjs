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
/** The same bound the control plane puts on a turn's instructions. */
export const HANDOFF_BASE_MAX = 20_000;
export const HANDOFF_ANSWER_MAX = 16_000;
/** Under Hermes's 420 s guard on tool calls issued together. */
export const HANDOFF_MAX_MS = 390_000;
/** Kept back so the caller can still write its answer. */
export const HANDOFF_ANSWER_RESERVE_MS = 60_000;
/** Less time than this is not worth starting a specialist for. */
export const HANDOFF_MIN_MS = 15_000;
/** One read of Hermes while a hand-off is live or settling. Capped so no
    single read can carry the tool past its budget. */
export const HANDOFF_READ_MS = 5_000;
/** After an aborted hand-off, how long its usage may take to settle: the
    stop, then Hermes's own record until it shows the run has ended. Hermes
    writes a stopped run's usage only when its executor returns. */
export const HANDOFF_SETTLE_MS = 12_000;
const SETTLE_POLL_MS = 500;

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
  /* Absent is allowed and means no hand-offs (see register): a Worker from
     before the base, after a rollback, must not have every task refused.
     Present, it must be sound. */
  if (value.base !== undefined &&
      (typeof value.base !== 'string' || !value.base.trim() || value.base.length > HANDOFF_BASE_MAX)) {
    return `handoff.base must contain 1 to ${HANDOFF_BASE_MAX} characters`;
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

/** A specialist's own turn. The control plane writes the preamble and the
 *  base — the rules every Jentera agent works under, who is speaking, the
 *  business's confirmed facts and the clock — and this adds only who this
 *  specialist is, whom it may ask, and where files for the owner go. */
export function specialistInstructions({ preamble, base, specialist, guidance = '', outputsInstruction = '' }) {
  return [
    preamble,
    base,
    `You are the ${specialist.name} specialist. Your remit: ${specialist.description}`,
    specialist.instructions ? `Business-owner instructions: ${specialist.instructions}` : '',
    guidance,
    outputsInstruction,
  ].filter(Boolean).join('\n\n');
}

/** What a specialist at this depth may hand on, and to whom: the business's
 *  other specialists, less anyone already waiting in its chain, while the
 *  depth allows another level. */
export function specialistGuidance({ roster, chain, depth, limits }) {
  const others = depth < limits.maxDepth ? roster.filter((entry) => !chain.includes(entry.profile)) : [];
  if (!others.length) {
    return 'You cannot hand this part on to another specialist: do it yourself, and if you cannot ' +
      'finish, say which part is missing.';
  }
  const list = others.map((entry) => `- ${entry.profile}: ${entry.name} — ${entry.description}`).join('\n');
  return "If part of this clearly sits in another specialist's remit, you may hand it to them with the " +
    'ask_specialist tool: give their profile key and a brief of exactly what you need, one at a time, ' +
    `and wait for their answer. ${depth + 1 >= limits.maxDepth ? 'They cannot hand it on again, and ' : ''}` +
    `the whole task has at most ${limits.maxHandoffs} hand-offs. Specialists you may ask:\n${list}\n` +
    'Say in your reply which part they did, by name. Never present a missing part as done.';
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

/** `promise`'s value, or null as soon as `signal` aborts, whichever is first.
    `promise` must not reject. */
function untilAborted(promise, signal) {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
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
    /* No base, no hand-offs: a specialist started without it would work
       without Jentera's rules, the speaker or the business's facts. The
       task itself runs; its ask_specialist calls answer `unavailable`. */
    if (!handoff?.base) return;
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
      base: handoff.base,
      used: 0,
      usage: null,
      liveRuns: new Map(),
      /* Every hand-off's own work, until its run has ended and its usage is
         counted — which, after an abort, is after its caller has moved on. */
      settling: new Set(),
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

  /** Resolves once every hand-off of this task has finished settling its
   *  usage, or after `maxMs`, whichever is first. Whatever freezes the task's
   *  terminal record waits on this first: an aborted specialist's tokens
   *  arrive after its caller was answered, and the record is final. */
  async settled(taskId, maxMs = HANDOFF_SETTLE_MS + HANDOFF_READ_MS) {
    const task = this.tasks.get(taskId);
    if (!task?.settling.size) return;
    let timer;
    await Promise.race([
      Promise.allSettled([...task.settling]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, maxMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
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
    /* Every request that reaches the runner counts toward the task's five,
       refused or not (the spec's Limits): a model looping on refusals is
       otherwise bounded only by its own turn limit. */
    const used = task.used;
    task.used += 1;
    if (task.stopped) return refuse('stopped');
    const refusal = handoffRefusal({ caller, specialist: key, roster, used, limits: task.limits });
    if (refusal) return refuse(refusal);
    /* A hand-off gets only what its own caller has left, not the whole task's
       remaining time — so a grandchild can never outlive its parent. */
    const budgetMs = handoffBudgetMs(caller.deadline, this.deps.now());
    if (budgetMs < HANDOFF_MIN_MS) return refuse('time');

    /* The budget clock starts before the start POST, not after it: Hermes
       gives the whole tool call 420 s, and a slow start has to come out of
       this hand-off's time rather than be added to it. The run's own timer
       is combined with whatever would already stop its caller, so either
       ends the hand-off and stops Hermes exactly once. */
    const own = new AbortController();
    const signal = AbortSignal.any([caller.signal, own.signal]);
    const deadline = this.deps.now() + budgetMs;
    const timer = setTimeout(() => own.abort(), budgetMs);
    const ctx = { runId: null };
    const chain = [...caller.chain, key];
    const instructions = specialistInstructions({
      preamble: task.preamble,
      base: task.base,
      specialist: entry,
      guidance: specialistGuidance({ roster, chain, depth, limits: task.limits }),
      outputsInstruction: task.outputsInstruction,
    });
    const work = this.work(task, { key, brief, instructions, depth, chain, signal, deadline, mark, ctx });
    task.settling.add(work);
    void work.then(() => task.settling.delete(work));
    try {
      /* The caller is answered the moment the hand-off ends, whatever ended
         it. Only a finished run's own result is waited for; an aborted one
         goes on settling its usage in the background. */
      const outcome = await untilAborted(work, signal);
      if (task.stopped) return fail('stopped');
      if (!outcome || signal.aborted) return fail('time');
      if (!outcome.started) return fail('failed');
      if (outcome.status === 'completed' && typeof outcome.output === 'string' && outcome.output.trim()) {
        mark('finished');
        return { ok: true, specialist: key, name: entry.name, answer: outcome.output.slice(0, HANDOFF_ANSWER_MAX) };
      }
      return fail(BUDGET.test(String(outcome.error ?? '')) ? 'budget' : 'failed');
    } finally {
      clearTimeout(timer);
      /* Ended for its caller: nothing more may be asked in this run's name,
         and its still-unanswered approval must not sit at the head of the
         task's queue blocking every later one. Its work may still be
         settling; that repeats both, harmlessly. */
      if (ctx.runId) {
        this.runs.delete(ctx.runId);
        this.deps.ended?.(task.taskId, ctx.runId);
      }
    }
  }

  /** One hand-off's run from start to end: started, followed, and — when it
   *  was cut short — stopped and settled, so its usage is counted whatever
   *  ended it. Never rejects. */
  async work(task, { key, brief, instructions, depth, chain, signal, deadline, mark, ctx }) {
    let body = null;
    try {
      const started = await this.deps.hermes('/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: brief,
          instructions,
          ...(task.model ? { model: task.model } : {}),
          model_options: { reasoning: { enabled: true, effort: 'high' } },
        }),
      }, key);
      body = started?.ok ? await started.json().catch(() => null) : null;
    } catch {
      body = null;
    }
    if (typeof body?.run_id !== 'string') return { started: false };

    const runId = body.run_id;
    ctx.runId = runId;
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
    try {
      /* A stop or timeout that landed while the start's own POST was in
         flight leaves the signal already aborted: an 'abort' listener added
         now never fires, and the caller has already been answered. Stop it
         directly and only settle. */
      let outcome = null;
      if (!signal.aborted) {
        this.runs.set(runId, { taskId: task.taskId, depth, chain, queue: Promise.resolve(), signal, deadline });
        mark('started');
        outcome = await this.follow(task.taskId, runId, key, signal);
      }
      if (!outcome) outcome = await this.settle(runId, key, stopOnce);
      if (outcome?.usage) task.usage = addUsage(task.usage, outcome.usage);
      else if (outcome?.status !== 'completed') {
        /* Hermes writes no usage for a failed run, and a stopped one that
           outlives the settling window is not waited on further. */
        console.warn(JSON.stringify({ event: 'runner.handoff.usage_unmeasured', taskId: task.taskId, profile: key }));
      }
      return { started: true, ...(outcome ?? { status: 'cancelled' }) };
    } catch {
      return { started: true, status: 'failed' };
    } finally {
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

  /** After an abort: the stop, then Hermes's own record until it shows the
   *  run has ended, which is when it carries the run's usage. Bounded by
   *  HANDOFF_SETTLE_MS; null when the run had not ended by then. */
  async settle(runId, profile, stopOnce) {
    const window = new AbortController();
    const timer = setTimeout(() => window.abort(), HANDOFF_SETTLE_MS);
    timer.unref?.();
    try {
      await untilAborted(stopOnce().then(() => true), window.signal);
      while (!window.signal.aborted) {
        const outcome = await this.statusOnce(runId, profile, window.signal);
        if (outcome) return outcome;
        await pause(SETTLE_POLL_MS, window.signal);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One direct look at Hermes's own record of a run, if it has reached an end. */
  async statusOnce(runId, profile, signal) {
    const response = await this.deps.hermes(`/v1/runs/${encodeURIComponent(runId)}`,
      { signal, timeoutMs: HANDOFF_READ_MS }, profile).catch(() => null);
    const status = response?.ok ? await response.json().catch(() => null) : null;
    const state = typeof status?.status === 'string' ? status.status.toLowerCase() : '';
    return TERMINAL.has(state) ? { status: state, output: status.output, usage: status.usage, error: status.error } : null;
  }

  /** Follow a specialist's run to its end, relaying its tools and approvals.
   *  Null when the hand-off was cut short first: settling it is not the
   *  caller's wait. */
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
              if (signal.aborted) return null;
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
        /* Stream lost or aborted; a direct look at Hermes below settles it. */
      }
    }
    /* No terminal event arrived over the stream. While the run is still
       meant to continue, ask Hermes directly until one appears. Each read
       is capped and ends with the hand-off, so none can hold the caller. */
    while (!signal.aborted) {
      const outcome = await this.statusOnce(runId, profile, signal);
      if (outcome) return outcome;
      await pause(1_000, signal);
    }
    return null;
  }
}
