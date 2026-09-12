/* ============================================================
   Jentera's narrow, per-business boundary in front of Hermes.

   Hermes stays on loopback. The Sprite URL routes only to this
   process, whose task endpoint requires both the private Sprite URL
   token (at Fly's edge) and a separate per-runtime runner key.
   ============================================================ */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBusinessBrowser, BrowserProblem } from './business-browser.mjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'stopped', 'expired']);
const BODY_LIMIT = 64 * 1024;
const STREAM_TEXT_LIMIT = 64 * 1024;
const STREAM_EVENT_LIMIT = 8 * 1024;
/* L2: a task may hold the runner only for a bounded interval. Mixed with
   Hermes's opaque run lifecycle, these caps turn any wedge (lost run, stuck
   session, gateway restart) into a quarantined failure instead of a busy
   lock that outlives the message that caused it. */
const TASK_AGE_LIMIT_MS = Object.freeze({ quick: 15 * 60 * 1000, deep: 90 * 60 * 1000 });
const MAX_RUN_DEADLINE_MS = 60 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;
const TERMINATION_RETRY_MS = 1_000;
const STREAM_THINK_LIMIT = 8 * 1024;
const STREAM_TTL_MS = 5 * 60 * 1000;
const HERMES_PATCH_ID = 'jentera-runtime-2026-09-07';
export const STARTER_SPECIALIST_PROFILES = Object.freeze([
  'operations',
  'customers',
  'growth',
  'records',
]);
const RUNNER_STARTED_AT = new Date().toISOString();
/* Computed while this module is being loaded, so an old process cannot begin
   reporting a new on-disk bundle after provisioning overwrites server.mjs. */
const RUNNER_SOURCE_SHA256 = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex');
/** Cap on concurrent SSE consumers of one task stream. Each subscriber
    holds a socket and a 1s heartbeat interval, so an unbounded set is a
    slow resource leak a hostile network peer could trigger for free. */
const MAX_STREAM_SUBSCRIBERS = 16;

/* ============================================================
   Always-on hold (paid plans). The worker includes an ISO
   `keepaliveUntil` on dispatches for `pro` businesses. While the
   clock is before that instant we hold the Sprite active through the
   Tasks API on the management socket, so the next message skips the
   cold-wake penalty. When the instant passes we delete the task and
   the Sprite is free to pause (stops billing).

   https://docs.sprites.dev/concepts/tasks
   ============================================================ */

const KEEPALIVE_TASK = 'jentera-always-on';
const KEEPALIVE_EXPIRE = '1h';
const KEEPALIVE_REFRESH_MS = 10 * 60 * 1000;
const SPRITE_API_SOCK_DEFAULT = '/.sprite/api.sock';

export function createSpriteKeepalive(sockPath = SPRITE_API_SOCK_DEFAULT) {
  return new SpriteKeepalive(sockPath);
}

export class SpriteKeepalive {
  constructor(sockPath) {
    this.sockPath = sockPath;
    this.holdUntilMs = 0;
    this.held = false;
    this.timer = null;
    this.socket = null; // null = unknown, true = present, false = absent
    this.lastError = null;
  }

  /** Extend the hold. ISO instant or undefined (ignored). Only ever
      moves the deadline forward; earlier arm calls are retained.
      Instants already in the past are ignored (the worker only sends
      future windows; a released Sprite stays released).
      Returns the tick promise (internally caught; safe to ignore). */
  arm(untilIso) {
    const ms = typeof untilIso === 'string' ? Date.parse(untilIso) : Number.NaN;
    if (Number.isNaN(ms) || ms <= Date.now()) return Promise.resolve();
    this.holdUntilMs = Math.max(this.holdUntilMs, ms);
    this.ensureLoop();
    return this.tick(); // hold starts immediately, not after the interval
  }

  status() {
    return {
      held: this.held,
      task: KEEPALIVE_TASK,
      until: this.held && this.holdUntilMs > Date.now()
        ? new Date(this.holdUntilMs).toISOString()
        : null,
      lastError: this.lastError,
    };
  }

  ensureLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), KEEPALIVE_REFRESH_MS);
    this.timer.unref?.();
  }

  stopLoop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    try {
      if (this.socket === null) {
        try {
          await access(this.sockPath);
          this.socket = true;
        } catch {
          this.socket = false;
          console.warn(
            `[keepalive] no Sprite management socket (${this.sockPath}); always-on unavailable`,
          );
        }
      }
      if (!this.socket) {
        this.stopLoop();
        return;
      }

      if (Date.now() >= this.holdUntilMs) {
        if (this.held) {
          const res = await spriteTasksApi(this.sockPath, 'DELETE', KEEPALIVE_TASK);
          if (res.ok || res.status === 404) {
            this.held = false;
            console.info('[keepalive] released; sprite free to pause');
          } else {
            this.lastError = `delete ${res.status}`;
            console.warn(`[keepalive] delete failed (${res.status})`);
          }
        } else {
          this.stopLoop();
        }
        return;
      }

      const created = await spriteTasksApi(this.sockPath, 'POST', undefined, {
        name: KEEPALIVE_TASK,
        expire: KEEPALIVE_EXPIRE,
      });
      if (created.ok) {
        if (!this.held) {
          this.held = true;
          console.info(`[keepalive] holding sprite active until ${new Date(this.holdUntilMs).toISOString()}`);
        }
        return;
      }
      if (created.status === 409) { // already held: refresh the expiry
        const refreshed = await spriteTasksApi(this.sockPath, 'PUT', KEEPALIVE_TASK, {
          expire: KEEPALIVE_EXPIRE,
        });
        if (refreshed.ok) {
          if (!this.held) {
            this.held = true;
            console.info(`[keepalive] holding sprite active until ${new Date(this.holdUntilMs).toISOString()}`);
          }
          return;
        }
        this.lastError = `refresh ${refreshed.status}`;
        console.warn(`[keepalive] refresh failed (${refreshed.status})`);
        return;
      }
      this.lastError = `create ${created.status}`;
      console.warn(`[keepalive] create failed (${created.status})`);
    } catch (error) {
      this.lastError = String(error);
      console.warn('[keepalive] tick failed', error);
    }
  }
}

/** One Tasks API call over the Sprite management socket. */
function spriteTasksApi(sockPath, method, name, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath: sockPath,
        host: 'sprite',
        path: name ? `/v1/tasks/${encodeURIComponent(name)}` : '/v1/tasks',
        method,
        headers: payload === null ? {} : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: data,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/* ============================================================
   Configuration the runtime is told, rather than born with.

   Everything Hermes is configured with is written into the sprite at
   bootstrap today, so changing one key costs a fleet release — which is
   what made a single `extract_backend` flip cost three releases and a
   fleet stall on 2026-09-10. This pulls the same settings from the
   control plane instead, so a change becomes a worker deploy that lands
   on the next wake.

   Four rules hold this together:

   - **Last known good, always.** A control plane that cannot be reached
     must never be able to stop a sprite working. Every failure path ends
     at the document already on disk, and a sprite with no document at all
     keeps exactly what the bootstrap gave it.
   - **Validate before believing.** The document arrives over the network
     and is written into files Hermes executes against, so every key and
     value is checked against a closed list here. Anything unexpected
     rejects the whole document rather than being merged in part.
   - **Apply only when idle.** Files are staged and renamed into place with
     the runner's single slot empty, so a document never changes under a
     run in flight.
   - **Say what was applied.** /readyz carries the applied version, so
     convergence is visible from the control plane without waking anyone.
   ============================================================ */

/** Hermes keys this runner understands. A document naming anything else is
    refused whole: a partial merge would leave a config nobody designed. */
const CONFIG_ALLOWED_HERMES = Object.freeze({
  web: new Set(['backend', 'search_backend', 'extract_backend']),
});
/** Extraction backends Hermes actually implements as plugins. */
const CONFIG_ALLOWED_EXTRACT = new Set(['firecrawl', 'tavily', 'exa', 'parallel']);
const CONFIG_ALLOWED_SEARCH = new Set(['ddgs', 'searxng', 'firecrawl', 'tavily', 'exa', 'parallel']);
/** Env names the document may set. Closed, because these are written into a
    file Hermes reads as credentials. */
/* A closed allowlist: the control plane may set these and nothing else,
   so widening what a sprite's environment can hold is a reviewed change
   rather than a value the control plane can decide on its own. */
const CONFIG_ALLOWED_ENV = new Set([
  'FIRECRAWL_API_URL',
  'FIRECRAWL_API_KEY',
  'CLOUDFLARE_API_TOKEN',
]);
const CONFIG_SCHEMA_SUPPORTED = 2;
const CONFIG_FETCH_TIMEOUT_MS = 10_000;
/* 1, 5, 15 minutes then hourly. A paused sprite simply retries on its next
   wake, so this only has to cover a control plane that is briefly away. */
const CONFIG_BACKOFF_MS = Object.freeze([60_000, 300_000, 900_000, 3_600_000]);

/**
 * Reject anything not obviously safe, and say why.
 *
 * Returns a reason string when the document must be refused, or null when it
 * may be applied. The reason reaches /readyz so a rejected document is
 * visible rather than silently ignored.
 */
export function configRejection(document) {
  if (!document || typeof document !== 'object') return 'document is not an object';
  if (document.schema !== CONFIG_SCHEMA_SUPPORTED) return `schema ${document.schema} unsupported`;
  if (typeof document.version !== 'string' || !/^[0-9a-f]{8,64}$/.test(document.version)) {
    return 'version is not a hash';
  }
  const hermes = document.hermes;
  if (!hermes || typeof hermes !== 'object') return 'hermes section missing';
  for (const [section, values] of Object.entries(hermes)) {
    const allowed = CONFIG_ALLOWED_HERMES[section];
    if (!allowed) return `hermes.${section} is not a key this runner applies`;
    if (!values || typeof values !== 'object') return `hermes.${section} is not an object`;
    for (const [key, value] of Object.entries(values)) {
      if (!allowed.has(key)) return `hermes.${section}.${key} is not allowed`;
      if (typeof value !== 'string') return `hermes.${section}.${key} is not a string`;
    }
  }
  const web = hermes.web ?? {};
  if (web.extract_backend && !CONFIG_ALLOWED_EXTRACT.has(web.extract_backend)) {
    return `extract backend ${web.extract_backend} is not implemented`;
  }
  for (const key of ['backend', 'search_backend']) {
    if (web[key] && !CONFIG_ALLOWED_SEARCH.has(web[key])) return `${key} ${web[key]} is not implemented`;
  }
  const env = document.hermesEnv ?? {};
  if (typeof env !== 'object' || Array.isArray(env)) return 'hermesEnv is not an object';
  for (const [name, value] of Object.entries(env)) {
    if (!CONFIG_ALLOWED_ENV.has(name)) return `hermesEnv.${name} is not allowed`;
    if (typeof value !== 'string' || value.length > 4096) return `hermesEnv.${name} is not a string`;
    /* These land in a dotenv file: a newline would let one value forge
       another line, which is how a config channel becomes a way to set
       arbitrary environment. */
    if (/[\r\n]/.test(value)) return `hermesEnv.${name} contains a newline`;
  }
  if (env.FIRECRAWL_API_URL && !/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::\d{1,5})?$/
      .test(env.FIRECRAWL_API_URL)) {
    return 'FIRECRAWL_API_URL is not a bare https origin';
  }
  /* Naming a backend with nothing to serve it would replace a working
     fallback with a hard failure — the same rule the sprite's Python
     configure step applies. */
  if (web.extract_backend === 'firecrawl' && !env.FIRECRAWL_API_URL) {
    return 'firecrawl named without an endpoint';
  }
  if (!Array.isArray(document.specialists) || document.specialists.length > 8) {
    return 'specialists must be an array of at most 8 roles';
  }
  const seenProfiles = new Set();
  for (const specialist of document.specialists) {
    if (!specialist || typeof specialist !== 'object' || Array.isArray(specialist)) {
      return 'specialist is not an object';
    }
    const extra = Object.keys(specialist)
      .filter((key) => !['profile', 'name', 'description', 'instructions'].includes(key));
    if (extra.length) return `specialist.${extra[0]} is not allowed`;
    if (typeof specialist.profile !== 'string' ||
        !/^[a-z][a-z0-9-]{0,47}$/.test(specialist.profile) ||
        seenProfiles.has(specialist.profile)) return 'specialist profile is invalid or duplicated';
    seenProfiles.add(specialist.profile);
    if (typeof specialist.name !== 'string' || !specialist.name.trim() || specialist.name.length > 60) {
      return 'specialist name must contain 1 to 60 characters';
    }
    if (typeof specialist.description !== 'string' || !specialist.description.trim() ||
        specialist.description.length > 500) {
      return 'specialist description must contain 1 to 500 characters';
    }
    if (typeof specialist.instructions !== 'string' || specialist.instructions.length > 4000) {
      return 'specialist instructions must be at most 4000 characters';
    }
  }
  return null;
}

function specialistSoul(specialist) {
  return `# Jentera — ${specialist.name}\n\n` +
    `You are a persistent specialist inside one business's private Jentera team.\n\n` +
    `Your business-defined remit: ${specialist.description}\n\n` +
    `${specialist.instructions ? `Business-owner instructions:\n${specialist.instructions}\n\n` : ''}` +
    `- Work only for this business and keep its information private.\n` +
    `- Build continuity from this profile's own memory, sessions, skills, and workspace.\n` +
    `- Return work through Jentera's Chief of Staff without exposing internal routing.\n` +
    `- Never take an irreversible external action without the approval required by Jentera.\n`;
}

/** A dotenv body for ~/.hermes/.env. Values are newline-free by validation. */
export function renderHermesEnv(hermesEnv, existing = '') {
  // Bootstrap owns model authentication. The config channel owns only the
  // closed connector allowlist; replacing its values must not erase model
  // credentials (nor preserve a disconnected connector's old grant).
  const bootstrap = existing.split(/\r?\n/)
    .filter((line) => /^(OPENROUTER_API_KEY|OPENROUTER_BASE_URL)=/.test(line));
  return `${[...bootstrap, ...Object.entries(hermesEnv ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${name}=${value}`)]
    .join('\n')}\n`;
}

/**
 * The live config state for one runner process.
 *
 * Deliberately a small state machine rather than a class hierarchy: what
 * /readyz reports and what gets applied are the same object, so the two
 * cannot describe different worlds.
 */
export function createConfigChannel(config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const writeFileImpl = deps.writeFile ?? writeFile;
  const renameImpl = deps.rename ?? rename;
  const readFileImpl = deps.readFile ?? readFile;
  const mkdirImpl = deps.mkdir ?? mkdir;
  const copyFileImpl = deps.copyFile ?? copyFile;
  const now = deps.now ?? (() => Date.now());

  let applied = null;         // the document currently in force
  let source = 'bootstrap';   // where it came from: bootstrap | lkg | control-plane
  let appliedAt = null;
  let pending = null;         // validated, staged, waiting for an idle slot
  let rejected = null;        // why the last document was refused
  let failures = 0;
  let staleSince = null;

  /** What /readyz says. Names match the plan so the worker can record it. */
  const state = () => ({
    schema: applied?.schema ?? null,
    version: applied?.version ?? null,
    appliedAt,
    source,
    ...(pending ? { pendingVersion: pending.version } : {}),
    ...(rejected ? { rejected } : {}),
    ...(staleSince ? { staleSince } : {}),
  });
  const profiles = () => (applied ? applied.specialists : STARTER_SPECIALIST_PROFILES
    .map((profile) => ({ profile })))
    .map((specialist) => specialist.profile)
    .filter((profile) => typeof profile === 'string');

  /** Restore the last applied document so a control plane outage is a no-op. */
  async function loadLastKnownGood() {
    if (!config.configLkgFile) return;
    try {
      const saved = JSON.parse(await readFileImpl(config.configLkgFile, 'utf8'));
      if (configRejection(saved.document)) return;
      applied = saved.document;
      appliedAt = saved.appliedAt ?? null;
      source = 'lkg';
    } catch {
      /* No file, or an unreadable one: the bootstrap's own config stands. */
    }
  }

  /** Write the document's files and record it as in force. */
  async function commit(document) {
    const envPath = config.hermesEnvFile;
    let envBody;
    if (envPath) {
      let existing = '';
      try { existing = await readFileImpl(envPath, 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT' && error.message !== 'ENOENT') throw error;
      }
      envBody = renderHermesEnv(document.hermesEnv, existing);
      await writeFileImpl(`${envPath}.next`, envBody, { mode: 0o600 });
      await renameImpl(`${envPath}.next`, envPath);
    }
    if (config.hermesProfilesDir && config.hermesConfigFile) {
      for (const specialist of document.specialists) {
        const profileDir = `${config.hermesProfilesDir}/${specialist.profile}`;
        for (const child of ['', 'memories', 'sessions', 'skills', 'skins', 'logs', 'plans', 'workspace', 'cron', 'home']) {
          await mkdirImpl(child ? `${profileDir}/${child}` : profileDir, { recursive: true });
        }
        await copyFileImpl(config.hermesConfigFile, `${profileDir}/config.yaml`);
        if (envPath) await writeFileImpl(`${profileDir}/.env`, envBody, { mode: 0o600 });
        await writeFileImpl(
          `${profileDir}/profile.yaml`,
          `description: ${JSON.stringify(`Jentera's persistent ${specialist.name} specialist.`)}\n` +
            `description_auto: false\n`,
        );
        await writeFileImpl(`${profileDir}/SOUL.md`, specialistSoul(specialist));
        await writeFileImpl(
          `${profileDir}/.no-bundled-skills`,
          'Managed Jentera specialist profile; install only reviewed role skills.\n',
        );
      }
    }
    applied = document;
    appliedAt = new Date(now()).toISOString();
    source = 'control-plane';
    pending = null;
    staleSince = null;
    if (config.configLkgFile) {
      await writeFileImpl(
        `${config.configLkgFile}.next`,
        `${JSON.stringify({ document, appliedAt }, null, 2)}\n`,
        { mode: 0o600 },
      );
      await renameImpl(`${config.configLkgFile}.next`, config.configLkgFile);
    }
  }

  /**
   * Apply a validated document, or hold it until the slot frees.
   *
   * A document must never change under a run in flight — Hermes reads
   * config at agent creation, so swapping it mid-run would give one task two
   * different configurations.
   */
  async function applyOrHold(document, isBusy) {
    if (applied && applied.version === document.version) {
      pending = null;
      return 'unchanged';
    }
    if (await isBusy()) {
      pending = document;
      return 'held';
    }
    await commit(document);
    return 'applied';
  }

  /** Apply whatever was held, once the slot is empty. */
  async function applyPending(isBusy) {
    if (!pending) return 'none';
    if (await isBusy()) return 'held';
    await commit(pending);
    return 'applied';
  }

  /**
   * Ask the control plane for the current document.
   *
   * Every failure ends at last known good; none of them can stop a sprite
   * serving. `desiredVersion` short-circuits the request when the control
   * plane has already told us, on the readiness call before a run, that
   * nothing has changed.
   */
  async function refresh(isBusy, desiredVersion = null) {
    if (!config.configUrl || !config.configKey) return 'not-configured';
    if (desiredVersion && applied && applied.version === desiredVersion && !pending) {
      return 'unchanged';
    }
    let document;
    try {
      const response = await fetchImpl(config.configUrl, {
        headers: {
          Authorization: `Bearer ${config.configKey}`,
          'X-Aisar-Config-Schema': String(CONFIG_SCHEMA_SUPPORTED),
        },
        signal: AbortSignal.timeout(CONFIG_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        failures += 1;
        staleSince = staleSince ?? new Date(now()).toISOString();
        return `http-${response.status}`;
      }
      document = await response.json();
    } catch {
      failures += 1;
      staleSince = staleSince ?? new Date(now()).toISOString();
      return 'unreachable';
    }
    const reason = configRejection(document);
    if (reason) {
      /* A refused document is a fact worth reporting: silently keeping LKG
         would hide a control plane sending something this runner cannot
         apply, which is exactly the drift the channel exists to surface. */
      rejected = reason;
      failures += 1;
      return 'rejected';
    }
    rejected = null;
    failures = 0;
    return applyOrHold(document, isBusy);
  }

  const backoffMs = () =>
    CONFIG_BACKOFF_MS[Math.min(failures, CONFIG_BACKOFF_MS.length - 1)];

  return { state, profiles, loadLastKnownGood, refresh, applyPending, backoffMs };
}

export function createRunner(input) {
  const config = validated(input);
  const state = new StateStore(config.stateFile);
  /* The control plane is never on the critical path: the channel starts from
     last known good and refreshes behind the request path, so a sprite whose
     control plane is away still serves with the config it already had. */
  const configChannel = input.configChannel ?? createConfigChannel(config);
  const streams = new SafeDeltaStreams(config);
  const keepalive = createSpriteKeepalive(process.env.SPRITE_API_SOCK);
  let admitting = false;
  let admittingTaskId = null;
  const businessBrowser = input.businessBrowser ?? (config.businessBrowserEnabled
    ? createBusinessBrowser({
      stateFile: '/var/lib/aisar/browser-control.json',
      profileDir: '/home/sprite/.jentera-browser',
      playwrightEntry: config.playwrightEntry,
    }) : null);
  const terminations = new RunTerminations(
    config,
    state,
    streams,
    (taskId) => admittingTaskId === taskId,
  );
  /* A document must not change under a run in flight: Hermes reads its config
     when the agent is created, so swapping mid-run would give one task two
     configurations. */
  const slotBusy = async () => admitting || Boolean(await businessBrowser?.isPaused()) || Boolean(await activeTask(config, state, terminations));

  /* Started in the background and never awaited: /readyz must not wait on the
     control plane, and a sprite whose control plane is away has to come up on
     last known good exactly as fast as one whose isn't. Retries back off and
     the timer is unref'd, so a paused sprite simply tries again on its next
     wake rather than holding the process alive to keep trying. */
  let configTimer = null;
  const refreshLoop = async () => {
    const outcome = await configChannel.refresh(slotBusy).catch(() => 'threw');
    if (['not-configured', 'applied', 'unchanged', 'held'].includes(outcome)) return;
    configTimer = setTimeout(() => { void refreshLoop(); }, configChannel.backoffMs());
    if (typeof configTimer.unref === 'function') configTimer.unref();
  };
  void (async () => {
    await configChannel.loadLastKnownGood().catch(() => undefined);
    await refreshLoop();
  })();
  let watchdog = null;
  void terminations.restore();
  const watchdogMs = Number.isFinite(config.watchdogMs) ? config.watchdogMs : WATCHDOG_INTERVAL_MS;
  if (watchdogMs > 0) {
    /* L2: while warm, re-run slot reconciliation every minute so a dead or
       expired task is quarantined even between requests. unref keeps test
       processes and idle runtimes free to exit. */
    watchdog = setInterval(() => {
      void activeTask(config, state, terminations)
        .then((active) => {
          if (active) {
            console.warn(`[watchdog] slot held by ${active.taskId} (started ${active.startedAt ?? 'unknown'})`);
          }
        })
        .catch((error) => {
          console.error(JSON.stringify({ event: 'runner.watchdog.error', message: String(error?.message ?? error) }));
        });
    }, watchdogMs);
    watchdog.unref?.();
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://runner');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, {
          ok: true,
          service: 'aisar-agent-runner',
          release: config.release,
          toolMode: config.toolMode,
          webSearchBackend: config.webSearchBackend,
          capabilities: config.capabilities,
          keepalive: keepalive.status(),
        });
      }

      if (!sameSecret(req.headers['x-aisar-runner-key'], config.runnerKey)) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }

      /* Defense in depth: the Fly edge token in the Sprite URL is also
         forwarded as `Authorization: Bearer` by the worker. When the
         runtime was provisioned with AISAR_EDGE_TOKEN, both factors are
         required — a leaked runner key alone must not admit anyone onto
         the private network. Runtimes provisioned before this existed
         carry no token and keep the single-factor check until they are
         re-provisioned. */
      if (
        config.edgeToken &&
        !sameSecret(authorizationBearer(req.headers.authorization), config.edgeToken)
      ) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }

      /* What the agent remembers, per profile: two small §-delimited files,
         readable as they are. Forgetting an entry rewrites the file without
         it, atomically, and only while no task is running — Hermes writes
         memory mid-run under its own lock, which this side cannot take. */
      if (url.pathname === '/v1/memory') {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
        return json(res, 200, { ok: true, profiles: await readAgentMemory(config) });
      }
      if (url.pathname === '/v1/memory/forget') {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
        let body;
        try { body = await readJson(req); } catch { return json(res, 400, { error: 'invalid_body' }); }
        const problem = memoryForgetProblem(body);
        if (problem) return json(res, 400, { error: problem });
        // Reserve the same slot as task admission before the first await.
        if (admitting) return json(res, 409, { error: 'runtime_busy' });
        admitting = true;
        try {
          if (await activeTask(config, state, terminations)) return json(res, 409, { error: 'runtime_busy' });
          const removed = await forgetAgentMemory(config, body);
          if (!removed) return json(res, 404, { error: 'not_found' });
          return json(res, 200, { ok: true });
        } finally {
          admitting = false;
        }
      }

      if (url.pathname === '/v1/browser') {
        res.setHeader('Cache-Control', 'no-store');
        if (!businessBrowser) return json(res, 503, { ok: false, error: 'browser_unavailable' });
        try {
          if (req.method === 'GET') return json(res, 200, await businessBrowser.status());
          if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
          const body = await readJson(req);
          if (body.businessId !== config.businessId) return json(res, 403, { error: 'wrong_business' });
          // Use the same admission guard as task start: neither side can
          // acquire the browser while the other is entering its async work.
          if (admitting) return json(res, 409, { error: 'runtime_busy' });
          admitting = true;
          try {
            const active = await activeTask(config, state, terminations);
            if (active) return json(res, 409, { error: 'runtime_busy' });
            return json(res, 200, await businessBrowser.command(body));
          }
          finally { admitting = false; }
        } catch (error) {
          // Playwright errors can contain typed text or private page URLs.
          // Never forward or log them from the owner-control surface.
          return json(res, error instanceof BrowserProblem ? error.status : 503,
            { error: error instanceof BrowserProblem ? error.message : 'browser_unavailable' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/readyz') {
        /* A customer's specialist edits travel through the config channel.
           Refresh on the authenticated pre-dispatch probe so a newly-created
           role is usable on its first job, not only after a process restart. */
        await configChannel.refresh(slotBusy).catch(() => undefined);
        const specialistProfiles = configChannel.profiles?.() ?? STARTER_SPECIALIST_PROFILES;
        const [detail, ...specialistDetails] = await Promise.all([
          hermes(config, '/health/detailed'),
          ...specialistProfiles.map((profile) =>
            hermes(config, '/health/detailed', {}, profile)),
        ]);
        const body = await responseJson(detail);
        const specialistBodies = await Promise.all(specialistDetails.map(responseJson));
        const specialistReadiness = Object.fromEntries(specialistProfiles.map(
          (profile, index) => [
            profile,
            specialistDetails[index].ok && readiness(specialistBodies[index]),
          ],
        ));
        const profilesReady = Object.values(specialistReadiness).every(Boolean);
        const ready = detail.ok && readiness(body) && profilesReady && config.runnerSourceAttested;
        /* Reconcile the slot on probe: a dead/expired task is quarantined
           even when no new task arrives to trigger it (health checks hit
           this endpoint periodically). */
        const active = await activeTask(config, state, terminations);
        /* The slot was just reconciled, so this is the natural moment to let a
           held document land: the probe runs periodically whether or not a
           task arrives. Never allowed to fail the probe — a config that will
           not apply is reported through `config`, not by refusing readiness. */
        await configChannel.applyPending(slotBusy).catch(() => undefined);
        return json(res, ready ? 200 : 503, {
          ok: ready,
          release: config.release,
          toolMode: config.toolMode,
          webSearchBackend: config.webSearchBackend,
          capabilities: config.capabilities,
          specialistProfiles: specialistReadiness,
          region: runtimeRegion(req),
          edgeAuthorizationForwarded: typeof req.headers.authorization === 'string',
          edgeTokenEnforced: Boolean(config.edgeToken),
          runner: {
            sourceSha256: RUNNER_SOURCE_SHA256,
            sourceAttested: config.runnerSourceAttested,
            pid: process.pid,
            startedAt: RUNNER_STARTED_AT,
          },
          /* Convergence, reported rather than pushed: the control plane reads
             this on the readiness call it already makes before every run, so
             it learns what each sprite applied without waking anything. */
          config: configChannel.state(),
          activeTask: active
            ? {
                taskId: active.taskId,
                status: active.status,
                hermesRunId: active.hermesRunId,
                startedAt: active.startedAt ?? null,
                ageSeconds: typeof active.startedAt === 'number'
                  ? Math.round((Date.now() - active.startedAt) / 1000)
                  : null,
                mode: active.responseMode === 'deep' ? 'deep' : 'quick',
              }
            : null,
          hermes: boundedReadiness(body),
          keepalive: keepalive.status(),
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const body = await readJson(req);
        const availableProfiles = configChannel.profiles?.() ?? STARTER_SPECIALIST_PROFILES;
        const problem = taskProblem(body, config, availableProfiles);
        if (problem) return json(res, 400, { ok: false, error: problem });

        keepalive.arm(body.keepaliveUntil); // paid-plan always-on hold

        const previous = await state.get(body.taskId);
        if (previous) {
          terminations.arm(previous);
          if (!TERMINAL.has(previous.status) && typeof previous.hermesRunId === 'string') {
            streams.start(previous.taskId, previous.hermesRunId, previous.profile);
          }
          return json(res, 200, {
            ok: true,
            duplicate: true,
            taskId: body.taskId,
            hermesRunId: previous.hermesRunId,
            status: previous.status,
          });
        }

        const active = await activeTask(config, state, terminations);
        const browserPaused = await businessBrowser?.isPaused();
        if (active || admitting || browserPaused) {
          return json(res, 409, {
            ok: false,
            error: 'runtime_busy',
            activeTaskId: active?.taskId,
            activeTaskStartedAt: typeof active?.startedAt === 'number' ? active.startedAt : null,
          });
        }
        admitting = true;
        admittingTaskId = body.taskId;
        try {
          // The agent's configured loopback CDP endpoint and the owner's
          // browser view must always refer to this same persistent profile.
          await businessBrowser?.ensure();
          const startedAt = Date.now();
          const responseMode = body.responseMode === 'quick' ? 'quick' : 'deep';
          /* Durable admission comes before the Hermes side effect. A crash or
             timeout can therefore leave, at worst, one identifiable
             `starting` record which holds the single-run slot; redelivery
             never starts a second run for the same task. */
          const admission = {
            taskId: body.taskId,
            businessId: body.businessId,
            hermesRunId: null,
            status: 'starting',
            responseMode,
            ...(body.profile ? { profile: body.profile } : {}),
            startedAt,
            ...(body.deadlineAt === undefined ? {} : { deadlineAt: body.deadlineAt }),
            leaseHash: hash(body.leaseToken),
            grantNonceHash: hash(grantClaims(body.toolGrant).nonce),
          };
          await state.put(body.taskId, admission);
          terminations.arm(admission);

          /* The task's own folder for files the owner should receive; the
             instruction points the model at it. A folder that cannot be made
             leaves the instruction out rather than promising what cannot land. */
          let outputsDir = null;
          try {
            outputsDir = outputsDirFor(config.outputsRoot ?? OUTPUTS_ROOT_DEFAULT, body.taskId);
            await mkdir(outputsDir, { recursive: true, mode: 0o700 });
          } catch {
            outputsDir = null;
          }
          const instructions = outputsDir
            ? `${body.instructions ? `${body.instructions}\n\n` : ''}${outputsInstruction(outputsDir)}`
            : body.instructions;

          let started;
          try {
            started = await hermes(config, '/v1/runs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                input: body.input,
                session_id: body.sessionId,
                instructions,
                model: body.model ?? (responseMode === 'quick'
                  ? config.modelName
                  : config.deepModelName),
                /* fcbd1076a9's _request_reasoning_config consumes exactly
                   this structured field. Keep it explicit so request intent
                   wins over config-side reasoning_overrides. */
                model_options: {
                  reasoning: responseMode === 'quick'
                    ? { enabled: false }
                    : { enabled: true, effort: 'high' },
                },
              }),
            }, body.profile);
          } catch (error) {
            /* The request outcome is ambiguous: retain the admission record
               and slot so a retry cannot create a second Hermes run. Its
               deadline/age reconciliation remains responsible for cleanup. */
            await state.put(body.taskId, {
              ...admission,
              status: 'admission_unknown',
              admissionError: boundedError(error),
            });
            return json(res, 502, { ok: false, error: 'Hermes start outcome is unknown' });
          }
          const result = await responseJson(started);
          if (!started.ok || typeof result?.run_id !== 'string') {
            const terminal = { status: 'failed', error: 'Hermes refused the run' };
            await state.put(body.taskId, { ...admission, status: 'failed', terminal });
            terminations.clear(body.taskId);
            return json(res, 502, { ok: false, error: 'Hermes refused the run' });
          }

          const latestAdmission = await state.get(body.taskId);
          const terminating = latestAdmission?.status === 'expiring' ||
            latestAdmission?.status === 'quarantined';
          const running = {
            ...admission,
            ...latestAdmission,
            hermesRunId: result.run_id,
            status: terminating
              ? latestAdmission.status
              : typeof result.status === 'string' ? result.status : 'started',
          };
          await state.put(body.taskId, running);
          streams.start(body.taskId, result.run_id, body.profile);
          if (terminating) void terminations.resume(running);
          else terminations.arm(running);
          return json(res, 202, {
            ok: true,
            taskId: body.taskId,
            hermesRunId: result.run_id,
            status: running.status,
          });
        } finally {
          admitting = false;
          admittingTaskId = null;
        }
      }

      const eventsPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/events$/i);
      if (eventsPath && req.method === 'GET') {
        const saved = await state.get(eventsPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        if (typeof saved.hermesRunId !== 'string') {
          return json(res, 409, { ok: false, error: 'task admission is incomplete' });
        }
        streams.start(saved.taskId, saved.hermesRunId, saved.profile);
        return streams.pipe(saved.taskId, req, res);
      }

      const approvalPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/approval$/i);
      if (approvalPath && req.method === 'POST') {
        const saved = await state.get(approvalPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        if (savedTerminalStatus(saved)) {
          return json(res, 409, { ok: false, error: 'task is terminal' });
        }
        if (typeof saved.hermesRunId !== 'string') {
          return json(res, 409, { ok: false, error: 'task admission is incomplete' });
        }
        const body = await readJson(req);
        const requestId = safeApprovalRequestId(body?.requestId);
        const decision = body?.decision === 'approve' || body?.decision === 'deny'
          ? body.decision
          : '';
        const reason = decision === 'deny' ? safeApprovalReason(body?.reason) : '';
        if (!requestId || !decision ||
            (body?.reason !== undefined && decision === 'deny' && !reason)) {
          return json(res, 400, {
            ok: false,
            error: 'requestId, decision, and optional deny reason are invalid',
          });
        }
        const resolution = await streams.resolveApproval(
          saved.taskId,
          saved.hermesRunId,
          requestId,
          decision,
          reason,
          saved.profile,
        );
        if (resolution.error) {
          return json(res, resolution.status, { ok: false, error: resolution.error });
        }
        return json(res, 200, {
          ok: true,
          taskId: saved.taskId,
          requestId,
          decision,
          status: 'running',
          ...(resolution.duplicate ? { duplicate: true } : {}),
        });
      }

      const taskPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})$/i);
      if (taskPath && req.method === 'GET') {
        const saved = await state.get(taskPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        const due = await terminations.expireIfDue(saved);
        if (due?.terminal) {
          return json(res, 200, { ok: true, taskId: saved.taskId, ...due.terminal });
        }
        const terminal = savedTerminalStatus(saved);
        if (terminal) return json(res, 200, { ok: true, taskId: saved.taskId, ...terminal });
        if (typeof saved.hermesRunId !== 'string') {
          return json(res, 200, { ok: true, taskId: saved.taskId, status: saved.status });
        }
        const status = await hermes(
          config,
          `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`,
          {},
          saved.profile,
        );
        const result = await responseJson(status);
        if (!status.ok) {
          /* L1: an in-flight task whose run vanished can never finish through
             Hermes. Quarantine it so the slot frees instead of returning 502
             forever (the worker would otherwise retry until attempts exhaust). */
          if (status.status === 404 || status.status === 410) {
            const quarantined = await terminations.terminate(
              saved.taskId,
              'failed',
              'run vanished (Hermes returned not_found)',
            );
            if (quarantined.terminal) {
              return json(res, 200, { ok: true, taskId: saved.taskId, ...quarantined.terminal });
            }
            return json(res, 503, { ok: false, error: 'Hermes stop is not yet confirmed' });
          }
          return json(res, 502, { ok: false, error: 'Hermes status failed' });
        }
        const observed = await persistObservedStatus(state, saved, result, { config });
        return json(res, 200, { ok: true, taskId: saved.taskId, ...observed });
      }

      const stopPath = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/stop$/i);
      if (stopPath && req.method === 'POST') {
        const saved = await state.get(stopPath[1]);
        if (!saved) return json(res, 404, { ok: false, error: 'task not found' });
        /* Stopping a terminal record is a no-op success; never ask Hermes
           about a run whose slot was already judged dead. */
        const frozen = savedTerminalStatus(saved);
        if (frozen) return json(res, 200, { ok: true, taskId: saved.taskId, ...frozen });
        if (typeof saved.hermesRunId !== 'string') {
          return json(res, 503, { ok: false, error: 'Hermes run identity is unavailable' });
        }
        const stopped = await hermes(
          config,
          `/v1/runs/${encodeURIComponent(saved.hermesRunId)}/stop`,
          { method: 'POST' },
          saved.profile,
        );
        const result = await responseJson(stopped);
        if (!stopped.ok) {
          /* L1: a run Hermes no longer knows can never be stopped through
             Hermes. Quarantine it so the slot frees and the caller sees a
             terminal snapshot instead of a forever-502. */
          if (stopped.status === 404 || stopped.status === 410) {
            const quarantined = await terminations.terminate(
              saved.taskId,
              'failed',
              'run vanished (Hermes returned not_found)',
            );
            if (quarantined.terminal) {
              return json(res, 200, { ok: true, taskId: saved.taskId, ...quarantined.terminal });
            }
            return json(res, 503, { ok: false, error: 'Hermes stop is not yet confirmed' });
          }
          return json(res, 502, { ok: false, error: 'Hermes stop failed' });
        }
        const stopStatus = typeof result?.status === 'string'
          ? result.status.toLowerCase()
          : '';
        if (stopStatus !== 'stopping' && !TERMINAL.has(stopStatus)) {
          return json(res, 502, { ok: false, error: 'Hermes returned an invalid stop outcome' });
        }
        const observed = await persistObservedStatus(state, saved, result, { config });
        return json(res, 200, { ok: true, taskId: saved.taskId, ...observed });
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500;
      console.error(JSON.stringify({ event: 'runner.error', message: String(error?.message ?? error) }));
      return json(res, status, { ok: false, error: status === 413 ? 'body too large' : 'runner error' });
    }
  });
  server.once('close', () => {
    if (watchdog) clearInterval(watchdog);
    terminations.close();
  });
  return server;
}

/** Capabilities this runner may attest. Only the reviewed set is accepted;
    a typo or unapproved id fails closed instead of being claimed. */
export const KNOWN_CAPABILITIES = ['computer_use'];

export function capabilitiesFromEnv(env = process.env) {
  // The bootstrap writes AISAR_CUA_ENABLED=1 into runtime.env only after the
  // X11 stack and `hermes computer-use doctor` succeeded on that same run, so
  // the attestation is a real claim about this process, not an intent signal.
  // Any value other than exactly "1" leaves the capability off.
  const capabilities = [];
  if (env.AISAR_CUA_ENABLED === '1') capabilities.push('computer_use');
  return capabilities;
}

export function configFromEnv(env = process.env) {
  return {
    businessBrowserEnabled: env.AISAR_BUSINESS_BROWSER === '1',
    playwrightEntry: env.PLAYWRIGHT_ENTRY,
    businessId: env.AISAR_BUSINESS_ID,
    runnerKey: env.AISAR_RUNNER_KEY,
    edgeToken: env.AISAR_EDGE_TOKEN,
    release: env.AISAR_RUNTIME_RELEASE,
    hermesKey: env.HERMES_API_KEY,
    hermesOrigin: env.HERMES_ORIGIN ?? 'http://127.0.0.1:8642',
    stateFile: env.AISAR_RUNNER_STATE ?? '/var/lib/aisar/runner-state.json',
    toolMode: env.AISAR_TOOL_MODE,
    webSearchBackend: env.AISAR_WEB_SEARCH_BACKEND,
    capabilities: capabilitiesFromEnv(env),
    modelName: env.AISAR_MODEL_NAME,
    deepModelName: env.AISAR_DEEP_MODEL_NAME,
    candidateModelNames: modelList(env.AISAR_CANDIDATE_MODEL_NAMES),
    runnerSourceSha256: env.AISAR_RUNNER_SOURCE_SHA256,
    /* The config channel. Absent, the runner keeps whatever the bootstrap
       wrote and reports source 'bootstrap' — which is every sprite until the
       release that starts sending AISAR_CONFIG_URL. The credential is the
       derived runtime key already present for the model proxy; reusing it is
       what lets this ship without a new bootstrap transfer field. */
    configUrl: env.AISAR_CONFIG_URL,
    configKey: env.AISAR_CONFIG_KEY ?? env.OPENROUTER_API_KEY,
    configLkgFile: env.AISAR_CONFIG_LKG ?? '/home/sprite/aisar/config.lkg.json',
    outputsRoot: env.AISAR_OUTPUTS_DIR ?? OUTPUTS_ROOT_DEFAULT,
    hermesEnvFile: env.AISAR_HERMES_DOTENV ?? '/home/sprite/.hermes/.env',
    hermesConfigFile: env.AISAR_HERMES_CONFIG ?? '/home/sprite/.hermes/config.yaml',
    hermesProfilesDir: env.AISAR_HERMES_PROFILES ?? '/home/sprite/.hermes/profiles',
    hermesMemoriesDir: env.AISAR_HERMES_MEMORIES ?? '/home/sprite/.hermes/memories',
    port: Number(env.PORT ?? 8080),
    watchdogMs: Number(env.AISAR_RUNNER_WATCHDOG_MS ?? WATCHDOG_INTERVAL_MS),
  };
}

function validated(config) {
  if (!uuid(config.businessId)) throw new Error('AISAR_BUSINESS_ID must be a UUID');
  if (typeof config.runnerKey !== 'string' || config.runnerKey.length < 32) {
    throw new Error('AISAR_RUNNER_KEY must be at least 32 characters');
  }
  if (typeof config.hermesKey !== 'string' || config.hermesKey.length < 8) {
    throw new Error('HERMES_API_KEY must be at least 8 characters');
  }
  if (typeof config.release !== 'string' || !config.release.trim()) {
    throw new Error('AISAR_RUNTIME_RELEASE is required');
  }
  if (config.toolMode !== 'full-tools') {
    throw new Error('AISAR_TOOL_MODE must be full-tools');
  }
  if (config.webSearchBackend !== 'ddgs') {
    throw new Error('AISAR_WEB_SEARCH_BACKEND must be ddgs');
  }
  if (
    !Array.isArray(config.capabilities) ||
    config.capabilities.some((id) => !KNOWN_CAPABILITIES.includes(id))
  ) {
    throw new Error('runner claims an unknown runtime capability');
  }
  if (!modelId(config.modelName) || !modelId(config.deepModelName)) {
    throw new Error('AISAR model routing is not configured');
  }
  if ((config.candidateModelNames ?? []).some((id) => !modelId(id))) {
    throw new Error('AISAR candidate model routes are invalid');
  }
  const expectedSource = config.runnerSourceSha256 ?? RUNNER_SOURCE_SHA256;
  if (!/^[0-9a-f]{64}$/.test(expectedSource)) {
    throw new Error('AISAR_RUNNER_SOURCE_SHA256 must be a SHA-256 digest');
  }
  if (expectedSource !== RUNNER_SOURCE_SHA256) {
    throw new Error('running runner source does not match the provisioned bundle');
  }
  return {
    ...config,
    runnerSourceAttested: true,
    hermesOrigin: String(config.hermesOrigin).replace(/\/$/, ''),
    stateFile: String(config.stateFile),
  };
}

async function activeTask(config, state, terminations, now = Date.now()) {
  for (const saved of await state.all()) {
    if (TERMINAL.has(saved.status) || savedTerminalStatus(saved)) continue;
    /* L2: a task may hold the runner only for a bounded interval. Hermes
       restarts, wedged sessions, and lost runs used to pin the runner busy
       forever; the age bound punts any such state to quarantine on the next
       check so a new task can always be admitted. */
    const mode = saved.responseMode === 'deep' ? 'deep' : 'quick';
    const ageLimit = TASK_AGE_LIMIT_MS[mode];
    if (saved.status === 'quarantined' || saved.status === 'expiring') {
      const pending = await terminations.resume(saved);
      if (!pending.terminal) return pending.record;
      continue;
    }
    if (typeof saved.deadlineAt === 'number' && now >= saved.deadlineAt) {
      const expired = await terminations.terminate(
        saved.taskId,
        'expired',
        'run deadline exceeded',
      );
      if (!expired.terminal) return expired.record;
      continue;
    }
    if (typeof saved.startedAt === 'number' && now - saved.startedAt > ageLimit) {
      const quarantined = await terminations.terminate(
        saved.taskId,
        'failed',
        `run exceeded the ${mode} age limit (${Math.round(ageLimit / 60000)}m)`,
      );
      if (!quarantined.terminal) return quarantined.record;
      continue;
    }
    if (typeof saved.hermesRunId !== 'string') return saved;
    const response = await hermes(
      config,
      `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`,
      {},
      saved.profile,
    );
    if (!response.ok) {
      /* L1: Hermes no longer knows the run (e.g. the gateway restarted and
         lost it). A dead run must not pin the runner busy — quarantine gives
         the same terminal grade a normal failure would, and frees the slot. */
      if (response.status === 404 || response.status === 410) {
        const quarantined = await terminations.terminate(
          saved.taskId,
          'failed',
          'run vanished (Hermes returned not_found)',
        );
        if (!quarantined.terminal) return quarantined.record;
        continue;
      }
      /* Transient Hermes failure: keep the slot held so a second run cannot
         overlap, but the age bound above still bounds how long this lasts. */
      return saved;
    }
    const current = await responseJson(response);
    if (typeof current?.status === 'string') {
      const observed = await persistObservedStatus(state, saved, current, { config });
      if (!TERMINAL.has(observed.status)) {
        return { ...saved, status: observed.status, startedAt: saved.startedAt ?? null };
      }
    } else {
      return saved;
    }
  }
  return null;
}

function taskProblem(body, config, specialistProfiles = STARTER_SPECIALIST_PROFILES) {
  if (!body || typeof body !== 'object') return 'invalid JSON object';
  if (body.businessId !== config.businessId) return 'business does not match runtime identity';
  if (!uuid(body.taskId)) return 'taskId must be a UUID';
  if (typeof body.leaseToken !== 'string' || body.leaseToken.length < 16) {
    return 'leaseToken is required';
  }
  if (typeof body.input !== 'string' || !body.input.trim() || body.input.length > 20_000) {
    return 'input must contain 1 to 20000 characters';
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return 'sessionId must be a string';
  }
  if (body.instructions !== undefined && typeof body.instructions !== 'string') {
    return 'instructions must be a string';
  }
  if (body.profile !== undefined && !specialistProfiles.includes(body.profile)) {
    return 'profile is not an available Jentera specialist';
  }
  if (body.responseMode !== undefined &&
      body.responseMode !== 'quick' && body.responseMode !== 'deep') {
    return 'responseMode must be quick or deep';
  }
  if (body.model !== undefined &&
      body.model !== config.modelName && body.model !== config.deepModelName &&
      !(config.candidateModelNames ?? []).includes(body.model)) {
    return 'model is not in the configured runtime routes';
  }
  if (body.keepaliveUntil !== undefined) {
    if (typeof body.keepaliveUntil !== 'string' ||
        !Number.isFinite(Date.parse(body.keepaliveUntil))) {
      return 'keepaliveUntil must be a valid ISO instant';
    }
  }
  if (body.deadlineAt !== undefined) {
    if (!Number.isSafeInteger(body.deadlineAt) || body.deadlineAt <= Date.now() ||
        body.deadlineAt - Date.now() > MAX_RUN_DEADLINE_MS) {
      return 'deadlineAt must be a future epoch-millisecond instant no more than 3600 seconds away';
    }
  }
  const grant = validateGrant(body.toolGrant, config, body.taskId);
  if (grant) return grant;
  return null;
}

function validateGrant(token, config, taskId, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 4096) return 'tool grant is required';
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    return 'tool grant is invalid';
  }
  const expected = createHmac('sha256', config.runnerKey).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return 'tool grant is invalid';
  }
  let claims;
  try {
    claims = grantClaims(token);
  } catch {
    return 'tool grant is invalid';
  }
  if (claims.version !== 1 || claims.businessId !== config.businessId ||
      claims.taskId !== taskId || !uuid(claims.taskId) ||
      !Array.isArray(claims.operations) || claims.operations.length !== 1 ||
      claims.operations[0] !== '*' ||
      !Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt) ||
      claims.issuedAt > now + 30 || claims.expiresAt <= now ||
      claims.expiresAt - claims.issuedAt > 300 ||
      typeof claims.nonce !== 'string' || !uuid(claims.nonce)) {
    return 'tool grant is invalid or expired';
  }
  return null;
}

function grantClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

function hermesProfilePath(path, profile) {
  return profile ? `/p/${profile}${path}` : path;
}

async function hermes(config, path, init = {}, profile) {
  return fetch(`${config.hermesOrigin}${hermesProfilePath(path, profile)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.hermesKey}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function hermesEvents(config, runId, profile) {
  return fetch(
    `${config.hermesOrigin}${hermesProfilePath(`/v1/runs/${encodeURIComponent(runId)}/events`, profile)}`,
    {
    headers: {
      Authorization: `Bearer ${config.hermesKey}`,
      Accept: 'text/event-stream',
    },
    signal: AbortSignal.timeout(15 * 60 * 1000),
    },
  );
}

function readiness(body) {
  const top = String(body?.status ?? '').toLowerCase();
  const nested = String(body?.readiness?.status ?? '').toLowerCase();
  const healthy = ['ok', 'ready', 'healthy'].includes(top) ||
    ['ok', 'ready', 'healthy'].includes(nested);
  return healthy && body?.jentera_patch === HERMES_PATCH_ID;
}

function boundedReadiness(body) {
  if (!body || typeof body !== 'object') return { status: 'unknown' };
  return {
    status: String(body.status ?? 'unknown').slice(0, 50),
    jenteraPatch: typeof body.jentera_patch === 'string'
      ? body.jentera_patch.slice(0, 100)
      : undefined,
    pid: Number.isSafeInteger(body.pid) && body.pid > 0 ? body.pid : undefined,
    readiness: body.readiness && typeof body.readiness === 'object'
      ? { status: String(body.readiness.status ?? 'unknown').slice(0, 50) }
      : undefined,
  };
}

function sameSecret(value, expected) {
  if (Array.isArray(value) || typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pull the `Bearer …` token out of an Authorization header, or ''. */
function authorizationBearer(value) {
  if (Array.isArray(value) || typeof value !== 'string') return '';
  const match = value.match(/^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i);
  return match ? match[1] : '';
}

function runtimeRegion(req) {
  const raw = process.env.FLY_REGION ?? req.headers['fly-region'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^[a-z0-9]{3}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function boundedError(error) {
  return String(error?.message ?? error ?? 'unknown error').slice(0, 500);
}

function uuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

/** Comma-separated model ids from the runtime environment; blanks dropped. */
function modelList(value) {
  return typeof value === 'string'
    ? value.split(',').map((id) => id.trim()).filter(Boolean)
    : [];
}

function modelId(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._:~-]+)?$/.test(value);
}

/* Agent memory: Hermes keeps MEMORY.md (its own notes) and USER.md (about
   the people it talks to) per profile, entries separated by "\n§\n". The
   default profile's files sit under hermesMemoriesDir; each specialist's
   under <hermesProfilesDir>/<profile>/memories. */
export const MEMORY_FILES = ['MEMORY.md', 'USER.md'];
const MEMORY_ENTRY_DELIMITER = '\n§\n';
const MEMORY_PROFILE = /^[a-z][a-z0-9-]{0,47}$/;

function memoryDir(config, profile) {
  return profile === 'default' ? config.hermesMemoriesDir : `${config.hermesProfilesDir}/${profile}/memories`;
}

function splitMemoryEntries(content) {
  return content.split(MEMORY_ENTRY_DELIMITER).map((entry) => entry.trim()).filter(Boolean);
}

async function readMemoryFile(path) {
  try {
    return splitMemoryEntries(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readAgentMemory(config) {
  const profiles = ['default'];
  try {
    for (const entry of await readdir(config.hermesProfilesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && MEMORY_PROFILE.test(entry.name)) profiles.push(entry.name);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const out = [];
  for (const profile of profiles) {
    const files = [];
    for (const file of MEMORY_FILES) {
      const entries = await readMemoryFile(`${memoryDir(config, profile)}/${file}`);
      files.push({ file, entries: entries.map((text, index) => ({ index, text })) });
    }
    if (files.some((f) => f.entries.length)) out.push({ profile, files });
  }
  return out;
}

export function memoryForgetProblem(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  if (typeof body.profile !== 'string' || (body.profile !== 'default' && !MEMORY_PROFILE.test(body.profile))) return 'invalid_profile';
  if (!MEMORY_FILES.includes(body.file)) return 'invalid_file';
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) return 'invalid_text';
  return null;
}

/** Remove one entry, matched exactly after trimming; the file is rewritten
    whole through a temp file and rename so a reader never sees half of it. */
const memoryWrites = new Map();

export async function forgetAgentMemory(config, body) {
  const path = `${memoryDir(config, body.profile)}/${body.file}`;
  const previous = memoryWrites.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const entries = await readMemoryFile(path);
    const target = body.text.trim();
    const kept = entries.filter((entry) => entry !== target);
    if (kept.length === entries.length) return false;
    const tmp = `${path}.jentera-${process.pid}.tmp`;
    await writeFile(tmp, kept.length ? `${kept.join(MEMORY_ENTRY_DELIMITER)}\n` : '', { mode: 0o600 });
    await rename(tmp, path);
    return true;
  });
  memoryWrites.set(path, operation);
  try { return await operation; }
  finally { if (memoryWrites.get(path) === operation) memoryWrites.delete(path); }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function responseJson(response) {
  return response.json().catch(() => null);
}

/** Hermes run status carries tool outputs the dashboard never renders.
    Surface only the fields the worker's status transition actually uses:
    `status`, `error`, `usage`, timestamp keys, the final answer `output`
    (bounded), and — for the durable reasoning block — Hermes's
    `last_reasoning` as a bounded `reasoning` string (the worker collapses
    it to 15 lines). Never a raw `...result` spread. */
function boundedTaskStatus(result) {
  if (!result || typeof result !== 'object') return { status: 'unknown' };
  const out = {};
  if (typeof result.status === 'string' && result.status) {
    out.status = result.status.slice(0, 50).toLowerCase();
  }
  if (typeof result.error === 'string' && result.error) {
    out.error = result.error.slice(0, 2_000);
  }
  if (result.usage && typeof result.usage === 'object') {
    const usage = {};
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
      const value = result.usage[key];
      if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
    }
    if (Object.keys(usage).length) out.usage = usage;
  }
  /* Final answer text: pass it through bounded (the worker slices to 4k).
     Hermes exposes it only once the run is terminal. */
  if (typeof result.output === 'string' && result.output) {
    out.output = result.output.slice(0, 64_000);
  }
  /* Final-message reasoning: Hermes computes `last_reasoning` at
     turn_finalizer.py:696 and the api_server ships it on the completed
     non-stream run status as `reasoning`. Bounded like output; the worker
     renders the `💭 **Reasoning:**` block for the durable answer. This is a
     deliberate terminal-status surface — the live SSE thinking lane stays
     the separate bounded slice. */
  if (typeof result.reasoning === 'string' && result.reasoning) {
    out.reasoning = result.reasoning.slice(0, 48_000);
  }
  /* Files delivered to the worker for this task, names and sizes only. */
  if (Array.isArray(result.artifacts)) {
    out.artifacts = result.artifacts.slice(0, 20).map((file) => ({
      name: String(file?.name ?? '').slice(0, 120),
      size: Number.isSafeInteger(file?.size) ? file.size : 0,
      contentType: String(file?.contentType ?? '').slice(0, 120),
    }));
  }
  for (const key of Object.keys(result)) {
    if (/^(created|started|finished|completed|updated)(_at)?$/i.test(key)) {
      const value = result[key];
      if (typeof value === 'string') out[key] = value.slice(0, 100);
      else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
  }
  return out;
}

/** Persist only the bounded terminal presentation. Hermes reaps completed run
    records independently of Jentera Queue redelivery; the task row is the
    durable bridge that keeps a finished answer recoverable after that 404. */
async function persistObservedStatus(state, saved, result, deps = {}) {
  /* A terminal record is frozen: once a run is completed, failed, or
     quarantined, a later Hermes 200 must never resurrect it as running
     (Hermes can keep answering for a run whose slot was already judged
     dead). Serve the frozen snapshot. */
  const already = savedTerminalStatus(saved);
  if (already) return already;
  let observed = boundedTaskStatus(result);
  const status = typeof observed.status === 'string' ? observed.status : 'unknown';
  if (TERMINAL.has(status) && deps.config) {
    /* Files the agent saved for the owner go to the worker now, so the
       first "completed" the control plane sees already carries them. Any
       failed reply can still have useful outputs. Cancelled/stopped work is
       not published automatically. */
    if (status === 'completed' || status === 'failed') {
      const delivered = await deliverOutputs(deps.config, saved.taskId, deps.fetch);
      if (delivered) {
        observed = {
          ...observed,
          artifacts: delivered.uploaded.map(({ name, size, contentType }) => ({ name, size, contentType })),
        };
      }
    } else {
      await discardOutputs(deps.config, saved.taskId);
    }
  }
  await state.put(saved.taskId, {
    ...saved,
    status,
    ...(TERMINAL.has(status) ? { terminal: observed } : {}),
  });
  return observed;
}

/** State is private and mode 0600, but still re-validate and re-bound it before
    putting persisted bytes back on the network. */
function savedTerminalStatus(saved) {
  const terminal = boundedTaskStatus(saved?.terminal);
  return typeof terminal.status === 'string' && TERMINAL.has(terminal.status)
    ? terminal
    : null;
}

function json(res, status, body) {
  if (res.headersSent) return;
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(encoded);
}

class StateStore {
  constructor(file) {
    this.file = file;
    this.writeChain = Promise.resolve();
  }

  async get(taskId) {
    await this.writeChain;
    return (await this.read()).tasks[taskId] ?? null;
  }

  async all() {
    await this.writeChain;
    return Object.values((await this.read()).tasks);
  }

  async put(taskId, value) {
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      data.tasks[taskId] = value;
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    return this.writeChain;
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      return parsed && typeof parsed.tasks === 'object' ? parsed : { version: 1, tasks: {} };
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, tasks: {} };
      throw error;
    }
  }
}

/** Owns deadline and quarantine stops. A task is not made terminal until
 * Hermes has either reported a terminal state or confirmed that the run is
 * gone. Failed or merely accepted stops stay persisted as expiring/
 * quarantined and are retried, so freeing the slot can never strand work. */
class RunTerminations {
  constructor(config, state, streams, admissionInFlight) {
    this.config = config;
    this.state = state;
    this.streams = streams;
    this.admissionInFlight = admissionInFlight;
    this.deadlines = new Map();
    this.retries = new Map();
    this.operations = new Map();
    this.closed = false;
  }

  async restore() {
    try {
      for (const saved of await this.state.all()) {
        if (savedTerminalStatus(saved)) continue;
        if (saved.status === 'quarantined' || saved.status === 'expiring') {
          void this.resume(saved);
        } else {
          this.arm(saved);
        }
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'runner.termination.restore.error',
        message: boundedError(error),
      }));
    }
  }

  arm(saved) {
    this.clearTimer(this.deadlines, saved?.taskId);
    if (this.closed || savedTerminalStatus(saved) ||
        !Number.isSafeInteger(saved?.deadlineAt)) return;
    const delay = Math.max(0, saved.deadlineAt - Date.now());
    const timer = setTimeout(() => {
      this.deadlines.delete(saved.taskId);
      void this.terminate(saved.taskId, 'expired', 'run deadline exceeded');
    }, delay);
    timer.unref?.();
    this.deadlines.set(saved.taskId, timer);
  }

  async expireIfDue(saved, now = Date.now()) {
    if (!Number.isSafeInteger(saved?.deadlineAt) || now < saved.deadlineAt ||
        savedTerminalStatus(saved)) return null;
    return this.terminate(saved.taskId, 'expired', 'run deadline exceeded');
  }

  resume(saved) {
    const terminalStatus = saved.terminationStatus === 'expired' ? 'expired' : 'failed';
    const reason = typeof saved.terminationReason === 'string'
      ? saved.terminationReason
      : terminalStatus === 'expired' ? 'run deadline exceeded' : 'run quarantined';
    return this.terminate(saved.taskId, terminalStatus, reason);
  }

  async terminate(taskId, terminalStatus, reason) {
    const existing = this.operations.get(taskId);
    if (existing) return existing;
    const operation = this.attempt(taskId, terminalStatus, reason)
      .finally(() => this.operations.delete(taskId));
    this.operations.set(taskId, operation);
    return operation;
  }

  async attempt(taskId, terminalStatus, reason) {
    const saved = await this.state.get(taskId);
    const frozen = savedTerminalStatus(saved);
    if (frozen) {
      this.clear(taskId);
      return { record: saved, terminal: frozen };
    }
    if (!saved) return { record: null, terminal: null };

    const pendingStatus = terminalStatus === 'expired' ? 'expiring' : 'quarantined';
    if (saved.status !== pendingStatus) {
      console.warn(`[${pendingStatus}] ${saved.taskId}: ${reason}`);
    }
    this.clearTimer(this.deadlines, taskId);

    if (typeof saved.hermesRunId !== 'string') {
      /* A pre-spawn admission cannot be addressed through /v1/runs. The
         authenticated readiness count is the only safe adoption signal: with
         max_concurrent_runs=1, zero proves no orphan remains; any positive or
         malformed count keeps the slot held and retrying. */
      if (!this.admissionInFlight(saved.taskId)) {
        try {
          const detail = await hermes(this.config, '/health/detailed', {}, saved.profile);
          const activeRuns = hermesActiveRunCount(await responseJson(detail));
          if (detail.ok && activeRuns === 0) {
            return this.finalize(saved, terminalStatus, reason, {});
          }
        } catch {
          /* Unknown health cannot prove the orphan stopped. */
        }
      }
      const pending = await this.persistPending(saved, pendingStatus, terminalStatus, reason,
        'Hermes run identity is unavailable');
      this.schedule(taskId, terminalStatus, reason);
      return { record: pending, terminal: null };
    }

    /* A run may have completed just before its deadline/age timer fired. On
       the first termination attempt, observe that terminal result before
       issuing stop so a completed answer is never relabelled as expired or
       quarantined. Once a persisted termination is pending, later terminal
       cancellation is intentionally finalized under the requested outcome. */
    if (saved.status !== pendingStatus) {
      try {
        const response = await hermes(
          this.config,
          `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`,
          {},
          saved.profile,
        );
        if (response.ok) {
          const current = boundedTaskStatus(await responseJson(response));
          if (typeof current.status === 'string' && TERMINAL.has(current.status)) {
            return this.adoptTerminal(saved, current);
          }
        }
      } catch {
        /* Failure to preflight cannot suppress a required stop. */
      }
    }

    let stopped;
    try {
      stopped = await hermes(
        this.config,
        `/v1/runs/${encodeURIComponent(saved.hermesRunId)}/stop`,
        { method: 'POST' },
        saved.profile,
      );
    } catch (error) {
      const pending = await this.persistPending(
        saved,
        pendingStatus,
        terminalStatus,
        reason,
        boundedError(error),
      );
      this.schedule(taskId, terminalStatus, reason);
      return { record: pending, terminal: null };
    }

    let observed = boundedTaskStatus(await responseJson(stopped));
    if (stopped.status === 404 || stopped.status === 410) {
      return this.finalize(saved, terminalStatus, reason, observed);
    }
    if (!stopped.ok) {
      const pending = await this.persistPending(
        saved,
        pendingStatus,
        terminalStatus,
        reason,
        `Hermes stop failed (${stopped.status})`,
      );
      this.schedule(taskId, terminalStatus, reason);
      return { record: pending, terminal: null };
    }
    if (typeof observed.status === 'string' && TERMINAL.has(observed.status)) {
      return this.finalize(saved, terminalStatus, reason, observed);
    }

    try {
      const response = await hermes(
        this.config,
        `/v1/runs/${encodeURIComponent(saved.hermesRunId)}`,
        {},
        saved.profile,
      );
      if (response.status === 404 || response.status === 410) {
        return this.finalize(saved, terminalStatus, reason, observed);
      }
      if (response.ok) {
        observed = boundedTaskStatus(await responseJson(response));
        if (typeof observed.status === 'string' && TERMINAL.has(observed.status)) {
          return this.finalize(saved, terminalStatus, reason, observed);
        }
      }
    } catch {
      /* The accepted stop remains pending and will be observed on retry. */
    }

    const pending = await this.persistPending(
      saved,
      pendingStatus,
      terminalStatus,
      reason,
      'Hermes stop is not yet terminal',
    );
    this.schedule(taskId, terminalStatus, reason);
    return { record: pending, terminal: null };
  }

  async persistPending(saved, status, terminalStatus, reason, stopError) {
    const pending = {
      ...saved,
      status,
      terminationStatus: terminalStatus,
      terminationReason: reason,
      stopError,
      updated_at: Math.floor(Date.now() / 1000),
    };
    await this.state.put(saved.taskId, pending);
    return pending;
  }

  async finalize(saved, terminalStatus, reason, observed) {
    const terminal = {
      ...boundedTaskStatus(observed),
      status: terminalStatus,
      error: reason,
    };
    const record = {
      ...saved,
      status: terminalStatus,
      terminal,
      updated_at: Math.floor(Date.now() / 1000),
    };
    delete record.stopError;
    await this.state.put(saved.taskId, record);
    this.clear(saved.taskId);
    this.streams.finishTask(saved.taskId);
    return { record, terminal };
  }

  async adoptTerminal(saved, terminal) {
    const record = { ...saved, status: terminal.status, terminal };
    await this.state.put(saved.taskId, record);
    this.clear(saved.taskId);
    this.streams.finishTask(saved.taskId);
    return { record, terminal };
  }

  schedule(taskId, terminalStatus, reason) {
    this.clearTimer(this.retries, taskId);
    if (this.closed) return;
    const timer = setTimeout(() => {
      this.retries.delete(taskId);
      void this.terminate(taskId, terminalStatus, reason);
    }, TERMINATION_RETRY_MS);
    timer.unref?.();
    this.retries.set(taskId, timer);
  }

  clear(taskId) {
    this.clearTimer(this.deadlines, taskId);
    this.clearTimer(this.retries, taskId);
  }

  clearTimer(map, taskId) {
    const timer = map.get(taskId);
    if (timer) clearTimeout(timer);
    map.delete(taskId);
  }

  close() {
    this.closed = true;
    for (const timer of [...this.deadlines.values(), ...this.retries.values()]) {
      clearTimeout(timer);
    }
    this.deadlines.clear();
    this.retries.clear();
  }
}

/**
 * The sole subscriber to Hermes's destructive run-event queue.
 *
 * Assistant text deltas, Hermes's bounded tool lifecycle presentation events,
 * the bounded reasoning lane, and a narrow approval prompt are copied into
 * process memory. Approval commands/patterns, tool results, full arguments,
 * terminal transcripts, and every unknown event are dropped here. Nothing in
 * this class touches the state file.
 */
class SafeDeltaStreams {
  constructor(config) {
    this.config = config;
    this.streams = new Map();
  }

  start(taskId, runId, profile) {
    const existing = this.streams.get(taskId);
    if (existing) return existing;
    const stream = {
      taskId,
      runId,
      profile,
      nextSeq: 1,
      bytes: 0,
      thinkBytes: 0,
      history: [],
      subscribers: new Set(),
      scrubber: new StreamingThinkScrubber(),
      pendingApprovals: [],
      resolvedApprovals: new Map(),
      approvalResolution: null,
      done: false,
    };
    this.streams.set(taskId, stream);
    void this.pump(stream);
    return stream;
  }

  pipe(taskId, req, res) {
    const stream = this.streams.get(taskId);
    if (!stream) return json(res, 404, { ok: false, error: 'stream not found' });
    if (stream.subscribers.size >= MAX_STREAM_SUBSCRIBERS) {
      return json(res, 429, { ok: false, error: 'too many stream subscribers' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    for (const event of stream.history) writeSse(res, event);
    if (stream.done) {
      writeSse(res, { type: 'done' });
      res.end();
      return;
    }

    stream.subscribers.add(res);
    const heartbeat = setInterval(() => writeSse(res, { type: 'heartbeat' }), 1_000);
    heartbeat.unref?.();
    const close = () => {
      clearInterval(heartbeat);
      stream.subscribers.delete(res);
    };
    req.once('close', close);
    res.once('close', close);
  }

  async pump(stream) {
    try {
      const response = await hermesEvents(this.config, stream.runId, stream.profile);
      if (!response.ok || !response.body) return;
      let pending = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        const frames = pending.split(/\r?\n\r?\n/);
        pending = frames.pop() ?? '';
        for (const frame of frames) this.acceptFrame(stream, frame);
      }
      pending += decoder.decode();
      if (pending.trim()) this.acceptFrame(stream, pending);
    } catch {
      /* Final status polling remains authoritative. Stream loss degrades the
         preview, never task completion, and no provider error is logged. */
    } finally {
      this.finish(stream);
    }
  }

  acceptFrame(stream, frame) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event?.event === 'message.delta' && typeof event.delta === 'string' &&
        event.delta.length > 0) {
      const bounded = truncateUtf8(event.delta, STREAM_TEXT_LIMIT - stream.bytes);
      /* Inline think blocks are scrubbed and discarded — only Hermes's native
         reasoning.available lane crosses as `thinking` (bounded, sanitised).
         Draining here keeps the capture buffer from growing across blocks. */
      stream.scrubber.drainThinking();
      this.emitDelta(stream, stream.scrubber.push(bounded));
      return;
    }
    if (event?.event === 'reasoning.available' && typeof event.text === 'string') {
      this.emitThinking(stream, event.text);
      return;
    }
    if (event?.event === 'context.compressing') {
      this.emitEvent(stream, { type: 'context.compressing', seq: stream.nextSeq++ });
      return;
    }
    if (event?.event === 'iteration.started' &&
        Number.isSafeInteger(event.iteration) &&
        Number.isSafeInteger(event.max_iterations) &&
        event.iteration >= 1 && event.iteration <= event.max_iterations &&
        event.max_iterations <= 10_000) {
      this.emitEvent(stream, {
        type: 'iteration',
        seq: stream.nextSeq++,
        current: event.iteration,
        total: event.max_iterations,
      });
      return;
    }
    if (event?.event === 'approval.request') {
      const requestId = safeApprovalRequestId(event.request_id);
      const message = safeToolPreview(event.description);
      if (!requestId || !message || stream.pendingApprovals.some(
        (approval) => approval.requestId === requestId,
      ) || stream.resolvedApprovals.has(requestId)) return;
      const approval = {
        type: 'approval',
        seq: stream.nextSeq++,
        requestId,
        tool: approvalToolName(event),
        message,
      };
      stream.pendingApprovals.push(approval);
      this.emitEvent(stream, approval);
      return;
    }
    if (event?.event === 'tool.started') {
      const tool = safeToolName(event.tool);
      if (!tool) return;
      // Shell/process input may contain a bare OAuth code with no key name
      // to redact. Never publish those arguments into SSE or durable traces.
      const preview = /^(?:terminal|process|execute_code|shell|bash)$/i.test(tool)
        ? '[Command arguments hidden]' : safeToolPreview(event.preview);
      this.emitEvent(stream, {
        type: 'tool.started',
        seq: stream.nextSeq++,
        tool,
        ...(preview ? { preview } : {}),
      });
      return;
    }
    if (event?.event === 'tool.completed') {
      const tool = safeToolName(event.tool);
      if (!tool) return;
      this.emitEvent(stream, {
        type: 'tool.completed',
        seq: stream.nextSeq++,
        tool,
        duration: Number.isFinite(event.duration)
          ? Math.max(0, Math.min(900, Number(event.duration)))
          : 0,
        error: event.error === true,
      });
    }
  }

  emitDelta(stream, value) {
    if (!value || stream.bytes >= STREAM_TEXT_LIMIT ||
        stream.history.length >= STREAM_EVENT_LIMIT) return;
    const delta = truncateUtf8(value, STREAM_TEXT_LIMIT - stream.bytes);
    if (!delta) return;
    this.emitEvent(stream, { type: 'delta', seq: stream.nextSeq++, delta });
  }

  /** Forwards Hermes's bounded reasoning lane as a separate `thinking` event
   *  with its own byte budget, so model CoT never spends the answer lane's
   *  budget. Reasoning text is sanitised and credential-redacted like tool
   *  previews. The worker renders it live in the bubble; it never crosses
   *  into the durable task status or output. */
  emitThinking(stream, value) {
    if (!value || stream.thinkBytes >= STREAM_THINK_LIMIT ||
        stream.history.length >= STREAM_EVENT_LIMIT) return;
    const text = safeToolPreview(value);
    if (!text) return;
    const safe = { type: 'thinking', seq: stream.nextSeq++, text };
    const size = Buffer.byteLength(JSON.stringify(safe));
    if (stream.thinkBytes + size > STREAM_THINK_LIMIT) return;
    stream.thinkBytes += size;
    stream.history.push(safe);
    for (const subscriber of stream.subscribers) writeSse(subscriber, safe);
  }

  emitEvent(stream, safe) {
    if (stream.history.length >= STREAM_EVENT_LIMIT) return;
    const size = Buffer.byteLength(JSON.stringify(safe));
    if (stream.bytes + size > STREAM_TEXT_LIMIT) return;
    stream.bytes += size;
    stream.history.push(safe);
    for (const subscriber of stream.subscribers) writeSse(subscriber, safe);
  }

  /** Bind the native Hermes request identity end to end. The in-flight
   * operation and resolved map make same-process response-loss retries
   * idempotent; Hermes also treats a repeated resolved request_id as a no-op. */
  async resolveApproval(taskId, runId, requestId, decision, reason = '', profile) {
    const stream = this.start(taskId, runId, profile);
    const resolved = stream.resolvedApprovals.get(requestId);
    if (resolved) {
      return resolved === decision
        ? { duplicate: true }
        : { status: 409, error: 'approval already resolved differently' };
    }
    const pending = stream.pendingApprovals[0];
    if (!pending || pending.requestId !== requestId) {
      return { status: 409, error: 'approval is not the pending request' };
    }
    if (stream.approvalResolution) {
      if (stream.approvalResolution.requestId !== requestId ||
          stream.approvalResolution.decision !== decision) {
        return { status: 409, error: 'another approval decision is in progress' };
      }
      const result = await stream.approvalResolution.promise;
      return result.error ? result : { ...result, duplicate: true };
    }
    const operation = (async () => {
      const response = await hermes(
        this.config,
        `/v1/runs/${encodeURIComponent(runId)}/approval`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            choice: decision === 'approve' ? 'once' : 'deny',
            request_id: requestId,
            ...(decision === 'deny' && reason ? { reason } : {}),
          }),
        },
        stream.profile,
      );
      if (!response.ok) {
        return {
          status: response.status === 404 ? 409 : 502,
          error: `Hermes approval failed (${response.status})`,
        };
      }
      stream.pendingApprovals.shift();
      stream.history = stream.history.filter(
        (event) => event.type !== 'approval' || event.requestId !== requestId,
      );
      stream.resolvedApprovals.set(requestId, decision);
      while (stream.resolvedApprovals.size > 32) {
        stream.resolvedApprovals.delete(stream.resolvedApprovals.keys().next().value);
      }
      return { duplicate: false };
    })();
    stream.approvalResolution = { requestId, decision, promise: operation };
    try {
      return await operation;
    } finally {
      stream.approvalResolution = null;
    }
  }

  finish(stream) {
    if (stream.done) return;
    /* Order matters: finish() flushes a stream-ending open block's tail into
       the scrubber's captured thinking (discarded, per the inline-never-cross
       contract), then the answer tail itself. */
    const tail = stream.scrubber.finish();
    stream.scrubber.drainThinking();
    this.emitDelta(stream, tail);
    stream.done = true;
    for (const subscriber of stream.subscribers) {
      writeSse(subscriber, { type: 'done' });
      subscriber.end();
    }
    stream.subscribers.clear();
    const cleanup = setTimeout(() => this.streams.delete(stream.taskId), STREAM_TTL_MS);
    cleanup.unref?.();
  }

  finishTask(taskId) {
    const stream = this.streams.get(taskId);
    if (stream) this.finish(stream);
  }
}

/** Streaming equivalent of Hermes's own think-block filter. It holds partial
 * tags across model chunks and never lets inline reasoning cross the runner's
 * trust boundary, even when Hermes labels it as a message delta. Inline
 * think-block content is captured (not silently dropped) and drained on the
 * next message delta / stream finish — the stream path discards it (only
 * Hermes's native reasoning.available lane crosses as SSE `thinking`),
 * which keeps the answer lane clean and inline CoT private. Capture is
 * retained so scrub behaviour is observable/testable. */
export class StreamingThinkScrubber {
  /* Pipe-framed markers are the convention inline models are prompted with
     (│ thinking│ … │/thinking│, ASCII-pipe variant accepted); bare ` thinking`
     … ` response` markers cover Hermes's own scratchpad lines; the XML tags
     cover classic CoT probes. */
  static OPEN = [
    '<reasoning_scratchpad>', '<think>', '<mm:think>', '| thinking|', ' thinking',
    '<reasoning>', '<thinking>', '<thought>',
  ];

  static CLOSE = [
    '</reasoning_scratchpad>', '</think>', '</mm:think>', '|/thinking|', '|/thinking ',
    ' response', '</reasoning>', '</thinking>', '</thought>',
  ];

  constructor() {
    this.buffer = '';
    this.inThinkBlock = false;
    this.visible = '';
    this.thinking = '';
  }

  push(text) {
    let input = normalizeSoftPipes(`${this.buffer}${text}`);
    this.buffer = '';
    let output = '';

    while (input) {
      const lower = input.toLowerCase();
      if (this.inThinkBlock) {
        const close = earliestTag(lower, StreamingThinkScrubber.CLOSE);
        if (close) {
          this.thinking += input.slice(0, close.index);
          this.buffer = '';
          this.inThinkBlock = false;
          input = input.slice(close.index + close.length);
          continue;
        }
        const max = Math.max(...StreamingThinkScrubber.CLOSE.map((tag) => tag.length));
        const tail = Math.min(max, input.length);
        if (input.length > tail) this.thinking += input.slice(0, input.length - tail);
        this.buffer = input.slice(-tail);
        return output;
      }

      const open = this.earliestOpening(input, lower);
      if (open) {
        output += this.append(input.slice(0, open.index));
        this.inThinkBlock = true;
        input = input.slice(open.index + open.length);
        continue;
      }

      /* Hold partial orphan closing tags too. Model providers may remove an
         opening reasoning tag upstream while leaving a namespaced close such
         as `</mm:think>` in message.delta, split across arbitrary chunks. */
      const held = longestTagPrefix(
        lower,
        [...StreamingThinkScrubber.OPEN, ...StreamingThinkScrubber.CLOSE],
      );
      const safe = held ? input.slice(0, -held) : input;
      if (held) this.buffer = input.slice(-held);
      output += this.append(stripOrphanCloseTags(safe));
      return output;
    }
    return output;
  }

  /** Returns captured inline think-block content since the last drain. Bytes
   * already counted in the scrubber's private state; the caller forwards it
   * through the bounded thinking lane. */
  drainThinking() {
    const value = this.thinking;
    this.thinking = '';
    return value;
  }

  finish() {
    if (this.inThinkBlock) {
      /* Stream ended inside a block: flush the held tail so the last working
         isn't lost, then return nothing for the answer lane. */
      this.thinking += this.buffer;
      this.buffer = '';
      return '';
    }
    const output = this.append(stripOrphanCloseTags(this.buffer));
    this.buffer = '';
    return output;
  }

  append(text) {
    this.visible += text;
    return text;
  }

  earliestOpening(input, lower) {
    let best = null;
    for (const tag of StreamingThinkScrubber.OPEN) {
      let from = 0;
      while (from < lower.length) {
        const index = lower.indexOf(tag, from);
        if (index === -1) break;
        const preceding = input.slice(0, index);
        const lastNewline = preceding.lastIndexOf('\n');
        const boundary = index === 0
          ? this.visible.length === 0 || this.visible.endsWith('\n')
          : lastNewline === -1
            ? (this.visible.length === 0 || this.visible.endsWith('\n')) && prefixBlank(preceding)
            : prefixBlank(preceding.slice(lastNewline + 1));
        if (boundary && (!best || index < best.index)) {
          best = { index, length: tag.length };
          break;
        }
        from = index + 1;
      }
    }
    return best;
  }
}

function earliestTag(text, tags) {
  let best = null;
  for (const tag of tags) {
    const index = text.indexOf(tag);
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, length: tag.length };
    }
  }
  return best;
}

function longestTagPrefix(text, tags) {
  let held = 0;
  for (const tag of tags) {
    for (let length = 1; length < tag.length; length += 1) {
      if (text.endsWith(tag.slice(0, length))) held = Math.max(held, length);
    }
  }
  return held;
}

function stripOrphanCloseTags(text) {
  if (!text.includes('</')) return text;
  return text.replace(
    /<\/(?:[a-z][\w.-]*:)?(?:reasoning_scratchpad|think|reasoning|thinking|thought)>[ \t\r\n]*/gi,
    '',
  );
}

/** True when a line contains only soft-frame characters (│ or ASCII |) and
 * whitespace — lets pipe-framed markers be recognised even when a stray pipe
 * rides the same line. */
function prefixBlank(line) {
  return line.replace(/[│|]/g, '').trim() === '';
}

/** Maps soft box-drawing pipes to ASCII so one marker vocabulary matches
 * regardless of which the model emits. */
function normalizeSoftPipes(value) {
  return value.replace(/[│┃┆┊]/g, '|');
}

function writeSse(res, event) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function truncateUtf8(value, maxBytes) {
  const encoded = Buffer.from(value);
  if (encoded.length <= maxBytes) return value;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/, '');
}

function safeToolName(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(value)) return '';
  return value;
}

function safeToolPreview(value) {
  if (typeof value !== 'string') return '';
  return truncateUtf8(value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'), 1_000);
}

function safeApprovalRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value)
    ? value.toLowerCase()
    : '';
}

function safeApprovalReason(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return '';
  const reason = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return reason && Buffer.byteLength(reason) <= 1_000 ? reason : '';
}

/** Hermes's native approval event deliberately has no tool field. Its
 * execute-code gate is identified by pattern metadata; plugin rules include
 * their tool name after `plugin_rule:`. Only the name crosses this boundary. */
function approvalToolName(event) {
  const direct = safeToolName(event.tool);
  if (direct) return direct;
  const pattern = typeof event.pattern_key === 'string' ? event.pattern_key : '';
  const plugin = /^plugin_rule:([a-zA-Z0-9_.:-]{1,96})(?::|$)/.exec(pattern)?.[1];
  if (plugin) return plugin;
  if (pattern || typeof event.command === 'string') return 'execute_code';
  return 'tool';
}

function hermesActiveRunCount(body) {
  const count = body?.readiness?.checks?.background_queues?.active_api_runs;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/* ---------- task outputs: files the agent hands the owner ---------------
   Each task gets its own folder. The instruction appended to the Hermes run
   tells the model to save deliverables there; when Hermes reports the run
   complete, the runner uploads every file to the worker (which stores it
   under the tenant and attaches it to the run) and then clears the folder.
   The upload happens before the task is reported complete, so a finished
   run already knows its files. Nothing here can name a tenant: the worker
   resolves it from the runtime credential and the task id. */
export const OUTPUTS_ROOT_DEFAULT = '/home/sprite/aisar/outputs';
export const OUTPUT_LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
});
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_TYPES = Object.freeze({
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
  json: 'application/json', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', yaml: 'application/yaml',
  yml: 'application/yaml', ics: 'text/calendar', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});

export function outputsDirFor(root, taskId) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new Error('task id must be a uuid');
  return join(root, taskId);
}

export function outputsInstruction(dir) {
  return `Files for the owner: if the owner should receive a file (a report, a spreadsheet, a document, an image), save it in ${dir} with a plain file name (letters, digits, dot, dash, underscore; up to 20 files of 20 MB). Everything in that folder is attached to your reply when you finish, so do not paste the file's contents into the reply; say what the file is.`;
}

export function contentTypeFor(name) {
  const text = String(name);
  const dot = text.lastIndexOf('.');
  if (dot <= 0) return 'application/octet-stream';
  return CONTENT_TYPES[text.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Regular files with plain names, by name; nothing hidden, nested, linked,
    empty or oversize, and no more than the caps allow. */
export async function collectOutputs(dir, limits = OUTPUT_LIMITS) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && OUTPUT_NAME.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  let total = 0;
  for (const entry of candidates) {
    if (files.length >= limits.maxFiles) break;
    const path = join(dir, entry.name);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile()) continue;
    if (info.size === 0 || info.size > limits.maxFileBytes) continue;
    if (total + info.size > limits.maxTotalBytes) break;
    total += info.size;
    files.push({ name: entry.name, path, size: info.size, contentType: contentTypeFor(entry.name) });
  }
  return files;
}

/** One POST per file to the worker, with the runtime credential the config
    channel already uses. Bounded per file and overall so a slow upload can
    never hold the task slot for long; what did not land is reported. */
export async function uploadOutputs({
  configUrl, configKey, taskId, files, fetch: fetchImpl = fetch, timeoutMs = 15_000, budgetMs = 40_000,
}) {
  if (!configUrl || !configKey) return { uploaded: [], failed: [], skipped: 'not-configured' };
  const endpoint = new URL('/v1/runtime/artifacts', configUrl).href;
  const deadline = Date.now() + budgetMs;
  const uploaded = [];
  const failed = [];
  for (const file of files) {
    if (Date.now() > deadline) {
      failed.push({ name: file.name, error: 'upload budget exhausted' });
      continue;
    }
    try {
      const body = await readFile(file.path);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configKey}`,
          'X-Aisar-Task-Id': taskId,
          'X-Aisar-Artifact-Name': file.name,
          'Content-Type': file.contentType,
          'Content-Length': String(body.byteLength),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        failed.push({ name: file.name, error: `http-${response.status}` });
        continue;
      }
      const result = await response.json().catch(() => ({}));
      uploaded.push({
        name: file.name, size: file.size, contentType: file.contentType,
        id: typeof result?.artifact?.id === 'string' ? result.artifact.id : null,
      });
    } catch (error) {
      failed.push({ name: file.name, error: String(error?.message ?? error) });
    }
  }
  return { uploaded, failed };
}

async function discardOutputs(config, taskId) {
  try {
    await rm(outputsDirFor(config.outputsRoot ?? OUTPUTS_ROOT_DEFAULT, taskId), { recursive: true, force: true });
  } catch {
    /* A folder left behind is untidy, not a fault. */
  }
}

const deliveringOutputs = new Map();
/** Collect, upload and clear a completed task's folder, once, even if two
    status polls observe completion at the same time. */
function deliverOutputs(config, taskId, fetchImpl) {
  if (!deliveringOutputs.has(taskId)) {
    deliveringOutputs.set(taskId, (async () => {
      try {
        const dir = outputsDirFor(config.outputsRoot ?? OUTPUTS_ROOT_DEFAULT, taskId);
        const files = await collectOutputs(dir);
        if (files.length === 0) return null;
        const result = await uploadOutputs({
          configUrl: config.configUrl, configKey: config.configKey, taskId, files, fetch: fetchImpl,
        });
        for (const miss of result.failed ?? []) {
          console.error(`[outputs] task=${taskId} file=${miss.name} not delivered: ${miss.error}`);
        }
        // Keep the originals if delivery failed, so support can recover them.
        if (!result.skipped && !result.failed?.length) await discardOutputs(config, taskId);
        return {
          uploaded: result.uploaded ?? [],
          failed: (result.failed ?? []).map((miss) => miss.name),
        };
      } catch (error) {
        console.error(`[outputs] task=${taskId} ${String(error?.message ?? error)}`);
        return null;
      } finally {
        deliveringOutputs.delete(taskId);
      }
    })());
  }
  return deliveringOutputs.get(taskId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = configFromEnv();
  const server = createRunner(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(JSON.stringify({
      event: 'runner.ready',
      port: config.port,
      release: config.release,
      sourceSha256: RUNNER_SOURCE_SHA256,
    }));
  });
}
