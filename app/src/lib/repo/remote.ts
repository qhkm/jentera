/* ============================================================
   The Repository, served by the Worker.

   Same interface as LocalRepository, so no screen changes when this is
   swapped in — that is the property slice 0 existed to create.

   The difference LocalRepository never had: every call here can fail.
   The provider surfaces those; this file's job is to make them legible.
   ============================================================ */

import type { Approval, CountryCode, Lang, Policy } from '@/lib/types';
import type {
  Activity,
  BusinessSnapshot,
  Fact,
  FactSource,
  AskAnswer,
  AskOptions,
  AskProgress,
  Connection,
  ConnectionHealth,
  IngestResult,
  Repository,
  TraceEvent,
  Theme,
  OnboardingCompletion,
  RuntimeOverview,
  WorkQuality,
} from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** The session expired or was never established. Distinct so the UI can
    offer sign-in rather than a generic "something went wrong". */
export class NotSignedInError extends Error {
  constructor() {
    super('Your session has expired. Sign in again to continue.');
    this.name = 'NotSignedInError';
  }
}

/** What /api/me answers with. Only the parts anything here reads. */
export interface MeResponse {
  detailLevel?: string;
}

/** No business yet — first sign-in, before the local state is migrated. */
export class NoBusinessError extends Error {
  constructor() {
    super('No business found for this account.');
    this.name = 'NoBusinessError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // The session is an HttpOnly cookie; without this it is not sent
      // cross-origin and every request looks unauthenticated.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch rejects only on network failure, never on a 4xx/5xx.
    throw new Error('Could not reach Jentera. Check your connection.');
  }

  if (res.status === 401) throw new NotSignedInError();

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 404 && body.code === 'NO_BUSINESS') throw new NoBusinessError();
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.err ?? `${res.status} ${res.statusText}`));
  }
  return body as T;
}

const post = (path: string, body?: unknown) =>
  call<void>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

/**
 * Stable 32-bit hash, so a server uuid can key the numeric-id UI.
 *
 * Identical to the one in lib/api.ts on purpose — the client's
 * Approval.id is a number, a leftover of Date.now() ids under
 * localStorage, and changing that type would touch every consumer.
 * remoteId carries the real id; this only has to be stable within one
 * snapshot for React keys and lookups.
 */
function hashId(uuid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface WireApproval {
  remoteId: string;
  conn: string;
  op: string;
  args: Record<string, unknown>;
  risk: Approval['risk'];
  status: string;
  ts: string;
  decided: string | null;
}

export class RemoteRepository implements Repository {
  /** numeric id → server uuid, rebuilt on every load. */
  private ids = new Map<number, string>();

  /* Answers the gate has already paid for.

     `choose()` fetches /api/me to decide whether this session is
     server-backed, and calls load() to detect a first sign-in. It threw
     both away, and the provider and the detail-level hook asked for
     them again a moment later — four requests on every load of the app
     where two would do.

     Each is consumed exactly once. A reload always goes to the network:
     a primed value that outlived startup would be a stale-data bug, and
     the two callers below run during the same startup that primes it. */
  private primed: { state?: BusinessSnapshot; me?: MeResponse } = {};

  prime(answers: { state?: BusinessSnapshot; me?: MeResponse }) {
    this.primed = { ...this.primed, ...answers };
  }

  async load(): Promise<BusinessSnapshot> {
    const already = this.primed.state;
    if (already) {
      this.primed.state = undefined;
      return already;
    }
    const { snapshot } = await call<{ snapshot: Record<string, unknown> }>('/api/state');
    const wire = (snapshot.approvals ?? []) as WireApproval[];

    this.ids.clear();
    const approvals: Approval[] = wire.map((a) => {
      const id = hashId(a.remoteId);
      this.ids.set(id, a.remoteId);
      return {
        id,
        remoteId: a.remoteId,
        conn: a.conn,
        op: a.op,
        args: a.args ?? {},
        risk: a.risk,
        ts: a.ts,
        status: a.status === 'pending' ? 'pending' : a.status === 'rejected' ? 'rejected' : 'approved',
        decided: a.decided ?? undefined,
      };
    });

    return {
      onboarded: Boolean(snapshot.onboarded),
      setupDone: Boolean(snapshot.setupDone),
      bizType: String(snapshot.bizType ?? ''),
      bizName: String(snapshot.bizName ?? ''),
      bizLoc: String(snapshot.bizLoc ?? ''),
      // Empty means "never chosen", not "chose nothing" — the same rule
      // LocalRepository applies. Normalised here rather than trusted from
      // the wire so the two cannot drift.
      channels: ((c) => (c && c.length ? c : null))(snapshot.channels as string[] | null),
      conns: (snapshot.conns as string[] | null) ?? null,
      country: (snapshot.country as CountryCode) ?? 'MY',
      lang: (snapshot.lang === 'bm' ? 'bm' : 'en') as Lang,
      theme: (snapshot.theme === 'light' ? 'light' : 'dark') as Theme,
      approvals,
      permissions: (snapshot.permissions as Record<string, Policy>) ?? {},
      workDone: (snapshot.workDone as Record<string, string[]>) ?? {},
      learn: (snapshot.learn as Record<string, Record<string, number>>) ?? {},
      facts: (snapshot.facts as Fact[]) ?? [],
    };
  }

  /** Create the business this account will own. Not on the interface —
      the cutover calls it once, before the first load can succeed. */
  async createBusiness(p: {
    name: string;
    playbookKey: string;
    country?: string;
    lang?: string;
    locality?: string;
  }): Promise<string> {
    const { businessId } = await call<{ businessId: string }>('/api/state/business', {
      method: 'POST',
      body: JSON.stringify(p),
    });
    return businessId;
  }

  setBizType = (key: string) => post('/api/state/biz-type', { key });
  setBizProfile = (p: { name?: string; loc?: string }) => post('/api/state/biz-profile', p);
  completeOnboarding = (input: OnboardingCompletion) =>
    post('/api/state/onboarding/complete', input);
  setSetupDone = (value: boolean) => post('/api/state/setup-done', { value });
  setChannels = (channels: string[]) => post('/api/state/channels', { channels });
  setConnections = (connections: string[]) => post('/api/state/connections', { connections });
  setCountry = (code: CountryCode) => post('/api/state/country', { code });
  setLang = (lang: Lang) => post('/api/state/lang', { lang });
  setTheme = (theme: Theme) => post('/api/state/theme', { theme });

  setPolicy = (op: string, policy: Policy) => post('/api/state/policy', { op, policy });
  resetPolicies = () => post('/api/state/policies/reset');

  async queueApproval(a: Approval): Promise<void> {
    const { remoteId } = await call<{ remoteId: string }>('/api/state/approvals', {
      method: 'POST',
      body: JSON.stringify({ conn: a.conn, op: a.op, args: a.args, risk: a.risk }),
    });
    this.ids.set(a.id, remoteId);
  }

  async decideApproval(id: number, approved: boolean, text?: string): Promise<void> {
    const remoteId = this.ids.get(id);
    if (!remoteId) {
      // The map is rebuilt on every load, so a miss means the caller is
      // acting on a snapshot older than the last refresh.
      throw new Error('That approval is no longer current. Reload and try again.');
    }
    await post(`/api/state/approvals/${encodeURIComponent(remoteId)}/decide`, { approved, text });
  }

  markWorkDone = (playbookKey: string, index: number) =>
    post('/api/state/work-done', { playbookKey, index: String(index) });

  recordLearn = (playbookKey: string, pick: string) =>
    post('/api/state/learn', { playbookKey, pick });

  setFact = (f: {
    key: string;
    value: unknown;
    source?: FactSource;
    sourceRef?: string | null;
    confidence?: number;
  }) => post('/api/state/facts', f);

  confirmFact = (key: string) => post('/api/state/facts/confirm', { key });
  confirmFacts = (keys: string[]) => post('/api/state/facts/confirm-batch', { keys });
  forgetFact = (key: string) => post('/api/state/facts/forget', { key });

  async factHistory(key: string): Promise<Fact[]> {
    const { history } = await call<{ history: Fact[] }>('/api/state/facts/history', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    return history;
  }

  async ingest(url: string): Promise<IngestResult> {
    /* The server answers 200 with ok:false when the RUN happened but
       the reading failed — the run is on record either way, so `call`
       would throw on a result worth showing. Handled here instead. */
    const res = await fetch(`${BASE}/api/runs/ingest`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      err?: string;
      runId?: string;
      facts?: number;
      keys?: string[];
      chars?: number;
      suggestions?: { key?: unknown; value?: unknown; confidence?: unknown }[];
    };
    if (res.status === 401) throw new NotSignedInError();
    if (!body.ok) throw new Error(body.err ?? 'Could not read that page.');
    return {
      runId: body.runId ?? '',
      facts: body.facts ?? 0,
      keys: body.keys ?? [],
      chars: body.chars ?? 0,
      suggestions: (body.suggestions ?? []).flatMap((suggestion) =>
        typeof suggestion.key === 'string' && typeof suggestion.value === 'string'
          ? [{
              key: suggestion.key,
              value: suggestion.value,
              confidence: Number(suggestion.confidence) || 0,
            }]
          : []),
    };
  }

  async ask(question: string, options: AskOptions = {}): Promise<AskAnswer> {
    const requestId = crypto.randomUUID();
    const start = () => call<AskAnswer & {
      pending?: boolean;
      status?: string;
      runId?: string;
    }>('/api/runs/ask', {
      method: 'POST',
      body: JSON.stringify({
        question,
        requestId,
        mode: options.mode ?? 'work',
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      }),
    });
    let begun;
    try {
      begun = await start();
    } catch (error) {
      /* The server commits the idempotent task before Queue delivery.
         Retrying this one explicit failure with the same requestId
         sends another wake-up without creating another run. */
      if (!(error instanceof Error) || !error.message.includes('could not queue')) throw error;
      begun = await start();
    }
    if (!begun.pending) return begun;
    if (!begun.runId) throw new Error('Jentera returned no run identifier.');
    return options.onProgress
      ? streamAsk(begun.runId, options.onProgress)
      : pollAsk(begun.runId);
  }

  async connections(): Promise<Connection[]> {
    const { connections } = await call<{ connections: Connection[] }>('/api/connections');
    return connections;
  }

  async connectTelegram(token: string): Promise<Connection> {
    const { connection } = await call<{ connection: Connection }>('/api/connections/telegram', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return connection;
  }

  async disconnect(id: string): Promise<void> {
    await call<void>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async connectionHealth(id: string): Promise<ConnectionHealth> {
    const r = await call<{ health: ConnectionHealth; pointsHere: boolean }>(
      `/api/connections/${encodeURIComponent(id)}/health`,
    );
    return { ...r.health, pointsHere: r.pointsHere };
  }

  async runtimeStatus(): Promise<RuntimeOverview> {
    return call<RuntimeOverview>('/api/runtime');
  }

  async provisionRuntime(): Promise<void> {
    await call('/api/runtime/provision', { method: 'POST', body: '{}' });
  }

  async detailLevel(): Promise<'beginner' | 'advanced'> {
    const me = this.primed.me ?? (await call<MeResponse>('/api/me'));
    this.primed.me = undefined;
    return me.detailLevel === 'advanced' ? 'advanced' : 'beginner';
  }

  setDetailLevel = (level: 'beginner' | 'advanced') => post('/api/me/detail-level', { level });

  async runTrace(runId: string): Promise<TraceEvent[]> {
    const { events } = await call<{ events: TraceEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/trace`,
    );
    return events;
  }

  async activity(): Promise<Activity> {
    return call<Activity>('/api/runs/activity');
  }

  rateWork = (workId: string, quality: WorkQuality) =>
    post('/api/runs/quality', { workId, quality });

  reset = () => post('/api/state/reset');
}

async function pollAsk(runId: string): Promise<AskAnswer> {
  const started = Date.now();
  const deadline = started + 16 * 60 * 1_000;
  let first = true;
  while (Date.now() < deadline) {
    if (!first) {
      const elapsed = Date.now() - started;
      await wait(elapsed < 30_000 ? 1_500 : 5_000);
    }
    first = false;
    const state = await call<AskAnswer & {
      pending?: boolean;
      status?: string;
      err?: string;
    }>(`/api/runs/${encodeURIComponent(runId)}`);
    if (!state.pending && state.status === 'completed') return state;
    if (!state.pending && state.status) {
      throw new Error(state.err ?? 'Jentera could not complete that answer.');
    }
  }
  throw new Error('Jentera is taking longer than expected. Check Activity for the result.');
}

async function streamAsk(
  runId: string,
  onProgress: (progress: AskProgress) => void,
): Promise<AskAnswer> {
  if (typeof WebSocket === 'undefined') return pollAsk(runId);

  return new Promise<AskAnswer>((resolve, reject) => {
    let socket: WebSocket;
    let handedOff = false;
    const finishFromDurableState = () => {
      if (handedOff) return;
      handedOff = true;
      globalThis.clearTimeout(timeout);
      try {
        socket.close(1000, 'switching to durable result');
      } catch {
        /* The handshake may have failed before a socket opened. */
      }
      void pollAsk(runId).then(resolve, reject);
    };
    const timeout = globalThis.setTimeout(finishFromDurableState, 16 * 60 * 1_000);

    try {
      socket = new WebSocket(websocketUrl(`/api/runs/${encodeURIComponent(runId)}/events`));
    } catch {
      finishFromDurableState();
      return;
    }

    socket.onmessage = (message) => {
      let event: { version?: unknown; type?: unknown };
      try {
        event = JSON.parse(String(message.data)) as { version?: unknown; type?: unknown };
      } catch {
        return;
      }
      if (event.version !== 1 || typeof event.type !== 'string') return;
      if (isAskProgress(event.type)) onProgress(event.type);
      if (['completed', 'failed', 'cancelled'].includes(event.type)) finishFromDurableState();
    };
    socket.onerror = finishFromDurableState;
    socket.onclose = finishFromDurableState;
  });
}

function websocketUrl(path: string): string {
  const fallback = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const url = new URL(`${BASE}${path}`, fallback);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isAskProgress(value: string): value is AskProgress {
  return ['queued', 'waking', 'working', 'retrying'].includes(value);
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
