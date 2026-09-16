/* ============================================================
   The Repository, served by the Worker.

   Same interface as LocalRepository, so no screen changes when this is
   swapped in — that is the property slice 0 existed to create.

   The difference LocalRepository never had: every call here can fail.
   The provider surfaces those; this file's job is to make them legible.
   ============================================================ */

import type { Approval, CountryCode, Lang, Policy } from '@/lib/types';
import { isRunId } from '@/lib/task';
import { isArtifact } from '@/lib/artifacts';
import { RemoteRoutinesApi } from '@/lib/routines/api';
import { nativeAuthorizationHeaders } from '@/lib/native';
import type {
  AccountDeletionRequested,
  BrowserCommand,
  BusinessBrowserState,
  Activity,
  Artifact,
  AskAnswer,
  ResumeAskOptions,
  PushSubscriptionJson,
  AskOptions,
  AskProgressEvent,
  BusinessSnapshot,
  Connection,
  ConnectionHealth,
  Fact,
  FactSource,
  Goal,
  GoalCheckpoint,
  GoalCheckpointStatus,
  GoalInput,
  GoalsOverview,
  GoalStatus,
  IngestResult,
  OnboardingCompletion,
  Repository,
  RunResult,
  RuntimeOverview,
  Specialist,
  Team,
  TeamInvitation,
  Theme,
  AgentMemory,
  ChatTranscript,
  Workspace,
  WorkspaceChat,
  Workspaces,
  TraceEvent,
  WorkQuality,
} from './types';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const VAULT_DEPOSIT_ORIGIN = (
  import.meta.env.VITE_VAULT_DEPOSIT_ORIGIN ??
  'https://aisar-vault-deposit.qhkmdev90.workers.dev'
).replace(/\/$/, '');

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
  features?: { routines?: { apiVersion?: number }; team?: { apiVersion?: number } };
  detailLevel?: string;
  /** Opaque account id from the session; scopes per-browser state such as
      Ask history so two accounts sharing a browser never see each other's. */
  userId?: string;
  /** The signed-in address. Shown back to the owner as the thing they must
      retype to delete the account — never sent anywhere else. */
  email?: string;
}

/** No business yet — first sign-in, before the local state is migrated. */
export class NoBusinessError extends Error {
  constructor() {
    super('No business found for this account.');
    this.name = 'NoBusinessError';
  }
}

class TemporaryConnectionError extends Error {}

/** Cookie on the web, bearer in the native shell. Keeping credentials on
    both paths preserves the browser flow while the Authorization header wins
    server-side if Android also has an old cookie in its shared jar. */
async function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(await nativeAuthorizationHeaders())) {
    headers.set(name, value);
  }
  return fetch(input, { ...init, credentials: 'include', headers });
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const multipart = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    res = await sessionFetch(`${BASE}${path}`, {
      ...init,
      // The session is an HttpOnly cookie; without this it is not sent
      // cross-origin and every request looks unauthenticated.
      credentials: 'include',
      headers: multipart ? init?.headers : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch rejects only on network failure, never on a 4xx/5xx.
    throw new TemporaryConnectionError('Could not reach Jentera. Check your connection.');
  }

  if (res.status === 401) throw Object.assign(new NotSignedInError(), { status: 401 });

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 404 && body.code === 'NO_BUSINESS') throw new NoBusinessError();
  if (!res.ok || body.ok === false) {
    const ErrorType = res.status === 408 || res.status === 429 || res.status >= 500 ? TemporaryConnectionError : Error;
    throw Object.assign(new ErrorType(String(body.err ?? `${res.status} ${res.statusText}`)), { status: res.status });
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
  readonly routines = new RemoteRoutinesApi();
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
      canManageKnowledge: snapshot.canManageKnowledge === true,
      specialists: (snapshot.specialists as Specialist[]) ?? [],
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
  businessBrowser(command?: BrowserCommand, signal?: AbortSignal): Promise<BusinessBrowserState> {
    return call('/api/browser', { ...(command ? { method: 'POST', body: JSON.stringify(command) } : {}), signal });
  }
  async watchBrowser(runId: string, onFrame: (frame: BusinessBrowserState) => void, signal: AbortSignal): Promise<void> {
    const response = await sessionFetch(`${BASE}/api/browser`, {
      method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview-stream', runId, controlId: crypto.randomUUID() }),
    });
    if (!response.ok) throw Object.assign(new Error('Preview connection failed'), { status: response.status });
    // Inactive tasks return JSON before a runtime connection is opened.
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const frame = await response.json() as BusinessBrowserState;
      if (frame.previewStatus !== 'inactive' && frame.previewStatus !== 'loading') throw new Error('Invalid preview response');
      onFrame(frame);
      return;
    }
    if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('Missing preview stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          if (end > 671000) throw new Error('Invalid preview frame');
          const frame = JSON.parse(buffer.slice(0, end)) as BusinessBrowserState;
          buffer = buffer.slice(end + 1);
          if (!signal.aborted) onFrame(frame);
        }
        if (buffer.length > 671000) throw new Error('Invalid preview frame');
      }
      if (buffer.trim()) throw new Error('Incomplete preview frame');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
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

  taskReviewSummary = (runId: string) => call<RunResult>(`/api/runs/${encodeURIComponent(runId)}/review-summary`);
  confirmFact = (key: string, version?: number) => post('/api/state/facts/confirm', { key, version });
  confirmFacts = (keys: string[]) => post('/api/state/facts/confirm-batch', { keys });
  forgetFact = (key: string, version?: number) => post('/api/state/facts/forget', { key, version });

  async factHistory(key: string): Promise<Fact[]> {
    const { history } = await call<{ history: Fact[] }>('/api/state/facts/history', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    return history;
  }

  createSpecialist = (input: Pick<Specialist, 'name' | 'description' | 'instructions'>) =>
    post('/api/state/specialists', input);

  updateSpecialist = (
    id: string,
    input: Pick<Specialist, 'name' | 'description' | 'instructions'>,
  ) => post(`/api/state/specialists/${encodeURIComponent(id)}`, input);

  disableSpecialist = (id: string) =>
    post(`/api/state/specialists/${encodeURIComponent(id)}`, { disable: true });

  async ingestFile(file: File): Promise<IngestResult & { source?: string }> {
    const res = await sessionFetch(`${BASE}/api/runs/ingest/file`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Aisar-File-Name': file.name,
      },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean; err?: string; runId?: string; facts?: number; keys?: string[]; chars?: number; source?: string;
      suggestions?: { key?: unknown; value?: unknown; confidence?: unknown }[];
    };
    if (res.status === 401) throw new NotSignedInError();
    if (!body.ok) throw new Error(body.err ?? 'Could not read that file.');
    return {
      runId: body.runId ?? '',
      facts: body.facts ?? 0,
      keys: body.keys ?? [],
      chars: body.chars ?? 0,
      source: body.source,
      suggestions: (body.suggestions ?? []).flatMap((suggestion) =>
        typeof suggestion.key === 'string' && typeof suggestion.value === 'string'
          ? [{ key: suggestion.key, value: suggestion.value, confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 0 }]
          : []),
    };
  }

  async ingest(url: string): Promise<IngestResult> {
    /* The server answers 200 with ok:false when the RUN happened but
       the reading failed — the run is on record either way, so `call`
       would throw on a result worth showing. Handled here instead. */
    const res = await sessionFetch(`${BASE}/api/runs/ingest`, {
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
    const requestId = options.requestId ?? crypto.randomUUID();
    const start = () => {
      const payload = {
        question,
        requestId,
        mode: options.mode ?? 'work',
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(options.goalId ? { goalId: options.goalId } : {}),
        ...(options.goalCheckpointId ? { goalCheckpointId: options.goalCheckpointId } : {}),
        ...(options.responseMode ? { responseMode: options.responseMode } : {}),
      };
      let path = '/api/runs/ask';
      let body: BodyInit = JSON.stringify(payload);
      if (options.attachment) {
        const form = new FormData();
        for (const [key, value] of Object.entries(payload)) form.set(key, String(value));
        form.set('file', options.attachment, options.attachment.name);
        path = '/api/runs/ask/file';
        body = form;
      }
      return call<AskAnswer & {
        pending?: boolean;
        status?: string;
        runId?: string;
      }>(path, { method: 'POST', body });
    };
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
    if (isRunId(begun.runId)) options.onRunCreated?.(begun.runId);
    if (!begun.pending) return begun;
    if (!isRunId(begun.runId)) throw new Error('Jentera returned no run identifier.');
    const answer = await (options.onProgress
      ? streamAsk(begun.runId, options.onProgress)
      : pollAsk(begun.runId));
    return { ...answer, runId: begun.runId };
  }

  async goals(): Promise<GoalsOverview> {
    return call<GoalsOverview>('/api/goals');
  }

  async createGoal(input: GoalInput): Promise<Goal> {
    const result = await call<{ goal: Goal }>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.goal;
  }

  async updateGoal(id: string, input: GoalInput & { status: GoalStatus }): Promise<void> {
    await call(`/api/goals/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async createGoalCheckpoint(goalId: string, title: string): Promise<GoalCheckpoint> {
    const result = await call<{ checkpoint: GoalCheckpoint }>(
      `/api/goals/${encodeURIComponent(goalId)}/checkpoints`,
      { method: 'POST', body: JSON.stringify({ title }) },
    );
    return result.checkpoint;
  }

  async updateGoalCheckpoint(goalId: string, checkpointId: string, input: {
    title: string;
    status: GoalCheckpointStatus;
  }): Promise<void> {
    await call(`/api/goals/${encodeURIComponent(goalId)}/checkpoints/${encodeURIComponent(checkpointId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async warmAgent(): Promise<void> {
    /* Fire-and-forget: a failure here costs one cold wake, nothing else. */
    await post('/api/runtime/wake', {}).catch(() => undefined);
  }

  async connections(): Promise<Connection[]> {
    const { connections } = await call<{ connections: Connection[] }>('/api/connections');
    return connections;
  }

  async connectTelegram(token: string): Promise<Connection> {
    /* The API may authorize a short-lived deposit, but it must never receive
       the bot token. The browser sends the material straight to the narrow
       vault edge and returns only a one-time receipt to the API. */
    const ticket = await call<{
      ticket: string;
      businessId: string;
      expiresAt: string;
      depositUrl: string;
    }>('/api/connections/telegram/deposit-ticket', {
      method: 'POST',
      body: '{}',
    });

    let target: URL;
    try {
      target = new URL(ticket.depositUrl);
    } catch {
      throw new TemporaryConnectionError('Secure Telegram deposit is unavailable.');
    }
    if (target.origin !== VAULT_DEPOSIT_ORIGIN || target.pathname !== '/v1/deposits/redeem') {
      throw new TemporaryConnectionError('Secure Telegram deposit is unavailable.');
    }

    let deposit: Response;
    try {
      deposit = await fetch(target, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: ticket.ticket,
          businessId: ticket.businessId,
          material: token,
        }),
      });
    } catch {
      throw new TemporaryConnectionError('Could not reach the secure credential vault.');
    }
    const deposited = (await deposit.json().catch(() => ({}))) as {
      ok?: boolean;
      receipt?: string;
      err?: string;
    };
    if (!deposit.ok || deposited.ok === false || !deposited.receipt) {
      const ErrorType = deposit.status === 408 || deposit.status === 429 || deposit.status >= 500
        ? TemporaryConnectionError
        : Error;
      throw new ErrorType(deposited.err ?? 'The secure vault could not save that bot token.');
    }

    const { connection } = await call<{ connection: Connection }>(
      '/api/connections/telegram/complete',
      { method: 'POST', body: JSON.stringify({ receipt: deposited.receipt }) },
    );
    return connection;
  }

  async tokenConnectors(): Promise<{ connector: string; label: string }[]> {
    const { connectors } = await call<{ connectors: { connector: string; label: string }[] }>(
      '/api/connections/token',
    );
    return connectors;
  }

  async connectToken(connector: string, token: string): Promise<Connection> {
    const { connection } = await call<{ connection: Connection }>('/api/connections/token', {
      method: 'POST',
      body: JSON.stringify({ connector, token }),
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

  async resumeAsk(runId: string, options?: ResumeAskOptions): Promise<AskAnswer> {
    if (!isRunId(runId)) throw new Error('Invalid task link.');
    return streamAsk(runId, options?.onProgress ?? (() => undefined));
  }

  /* Web push. These read the status themselves: a 503 means "not
     configured" and a 409 means "another account's device", both answers
     the caller acts on, where `call` would have thrown. */
  async pushPublicKey(): Promise<string | null> {
    const res = await sessionFetch(`${BASE}/api/push/vapid-public-key`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 503) return null;
    if (res.status === 401) throw new NotSignedInError();
    if (!res.ok) throw new Error('Could not load notification configuration.');
    const body = (await res.json().catch(() => ({}))) as { key?: unknown };
    return typeof body.key === 'string' ? body.key : null;
  }

  async savePushSubscription(subscription: PushSubscriptionJson): Promise<'saved' | 'conflict'> {
    const res = await sessionFetch(`${BASE}/api/push/subscription`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 409) return 'conflict';
    if (res.status === 401) throw new NotSignedInError();
    if (!res.ok) throw new Error('Could not turn on notifications for this device.');
    return 'saved';
  }

  deletePushSubscription = (endpoint: string) =>
    call<void>('/api/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

  /* Files the agent produced. The download is a plain link to the API:
     a top-level GET across sites still carries the Lax session cookie. */
  listArtifacts = async (options: { runId?: string; relatedRunId?: string; limit?: number } = {}): Promise<Artifact[]> => {
    const params = new URLSearchParams();
    if (options.runId) params.set('runId', options.runId);
    if (options.relatedRunId) params.set('relatedRunId', options.relatedRunId);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    const { artifacts } = await call<{ artifacts?: unknown }>(`/api/artifacts${query ? `?${query}` : ''}`);
    return Array.isArray(artifacts) ? artifacts.filter(isArtifact) : [];
  };

  artifactUrl = (id: string) => `${BASE}/api/artifacts/${encodeURIComponent(id)}`;

  fetchArtifact = async (id: string): Promise<Blob> => {
    const res = await sessionFetch(this.artifactUrl(id));
    if (res.status === 401) throw new NotSignedInError();
    if (!res.ok) throw new Error('This file could not be opened.');
    return res.blob();
  };

  async runCoordination(runId: string): Promise<import('./types').RunCoordination> {
    if (!isRunId(runId)) throw new Error('Invalid task link.');
    return call<import('./types').RunCoordination>(`/api/runs/${encodeURIComponent(runId)}/coordination`);
  }

  async runResult(runId: string): Promise<RunResult> {
    if (!isRunId(runId)) throw new Error('Invalid task link.');
    const result = await call<RunResult>(`/api/runs/${encodeURIComponent(runId)}`);
    if (result.runId !== runId || typeof result.status !== 'string' || typeof result.pending !== 'boolean') {
      throw new Error('Could not read this task’s status.');
    }
    return result;
  }

  confirmTaskReview = (runId: string) =>
    post(`/api/runs/${encodeURIComponent(runId)}/review`, { decision: 'confirm' });

  dismissTask = (runId: string) =>
    post(`/api/runs/${encodeURIComponent(runId)}/review`, { decision: 'dismiss' });

  team = () => call<Team>('/api/team');

  inviteTeamMember = async (email: string) =>
    (await call<{ invitation: TeamInvitation }>('/api/team/invitations', {
      method: 'POST', body: JSON.stringify({ email }),
    })).invitation;

  revokeTeamInvitation = (id: string) =>
    call<void>(`/api/team/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });

  removeTeamMember = (userId: string) =>
    call<void>(`/api/team/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

  acceptInvitation = (token: string) =>
    call<{ businessName: string }>('/api/team/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token }),
    });

  agentMemory = () => call<AgentMemory>('/api/agent/memory');

  forgetAgentMemory = (entry: { profile: string; file: 'MEMORY.md' | 'USER.md'; text: string }) =>
    call<void>('/api/agent/memory/forget', { method: 'POST', body: JSON.stringify(entry) });

  workspaces = () => call<Workspaces>('/api/workspaces');

  createWorkspace = async (name: string, memberIds: string[]) =>
    (await call<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST', body: JSON.stringify({ name, memberIds }),
    })).workspace;

  addWorkspaceMember = (workspaceId: string, userId: string) =>
    call<void>(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: 'POST', body: JSON.stringify({ userId }),
    });

  removeWorkspaceMember = (workspaceId: string, userId: string) =>
    call<void>(`/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

  workspaceChats = async (workspaceId: string) =>
    (await call<{ chats: WorkspaceChat[] }>(`/api/chats?workspaceId=${encodeURIComponent(workspaceId)}`)).chats;

  chat = async (chatId: string) => (await call<{ chat: ChatTranscript }>(`/api/chats/${encodeURIComponent(chatId)}`)).chat;

  rateWork = (workId: string, quality: WorkQuality) =>
    post('/api/runs/quality', { workId, quality });

  reset = () => post('/api/state/reset');

  async requestAccountDeletion(email: string): Promise<AccountDeletionRequested> {
    const body = await call<AccountDeletionRequested>('/api/me', {
      method: 'DELETE',
      body: JSON.stringify({ email }),
    });
    /* `noticeSent` is coerced rather than passed through: a worker on an
       older release omits it, and `undefined` would read as "the email
       failed" on a screen whose whole job is to say which happened. */
    return {
      graceDays: body.graceDays,
      routines: body.routines,
      noticeSent: body.noticeSent !== false,
    };
  }
}

async function pollAsk(runId: string, onProgress?: (event: AskProgressEvent) => void, deadline = Date.now() + 16 * 60 * 1_000, onPending?: () => void): Promise<AskAnswer> {
  const started = Date.now();
  let reportedHealthy = false;
  let first = true;
  let failures = 0;
  while (Date.now() < deadline) {
    if (!first) {
      const elapsed = Date.now() - started;
      await wait(failures ? Math.min(15000, 1500 * 2 ** Math.min(failures - 1, 4)) : elapsed < 30_000 ? 1_500 : 5_000);
    }
    first = false;
    let state: AskAnswer & {
      pending?: boolean;
      status?: string;
      err?: string;
    };
    try {
      state = await call<typeof state>(`/api/runs/${encodeURIComponent(runId)}`, { signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (!(error instanceof TemporaryConnectionError)) throw error;
      failures++;
      if (failures === 1) onProgress?.({ type: 'reconnecting' });
      continue;
    }
    if (failures || (!reportedHealthy && state.pending)) onProgress?.({ type: 'reconnecting', detail: 'recovered' });
    reportedHealthy = true;
    failures = 0;
    if (state.pending) onPending?.();
    if (!state.pending && state.status === 'completed') return state;
    if (!state.pending && state.status) {
      throw new Error(state.err ?? 'Jentera could not complete that answer.');
    }
  }
  throw new Error('Jentera is taking longer than expected. Check Activity for the result.');
}

async function streamAsk(
  runId: string,
  onProgress: (event: AskProgressEvent) => void,
): Promise<AskAnswer> {
  if (typeof WebSocket === 'undefined') return pollAsk(runId, onProgress);
  const deadline = Date.now() + 16 * 60 * 1_000;

  return new Promise<AskAnswer>((resolve, reject) => {
    let socket: WebSocket;
    let handedOff = false;
    let recoverySocket: WebSocket | undefined;
    let nextReconnectAt = 0;
    let reconnectAttempts = 0;
    let lastSeq = 0;
    let settled = false;
    const restoreLiveUpdates = () => {
      if (settled || recoverySocket || Date.now() < nextReconnectAt || reconnectAttempts >= 8) return;
      reconnectAttempts++;
      nextReconnectAt = Date.now() + Math.min(30_000, 1500 * 2 ** (reconnectAttempts - 1));
      try {
        const next = new WebSocket(websocketUrl(`/api/runs/${encodeURIComponent(runId)}/events`));
        recoverySocket = next;
        const handshake = globalThis.setTimeout(() => lost(), 10_000);
        const lost = () => {
          globalThis.clearTimeout(handshake);
          if (recoverySocket !== next) return;
          recoverySocket = undefined;
          try { next.close(); } catch { /* Already closed. */ }
        };
        next.onopen = () => globalThis.clearTimeout(handshake);
        next.onerror = lost;
        next.onclose = lost;
        next.onmessage = message => {
          if (settled || recoverySocket !== next) return;
          globalThis.clearTimeout(handshake);
          forwardProgress(message.data);
        };
      } catch { recoverySocket = undefined; }
    };
    const forwardProgress = (data: unknown) => {
      let event: { version?: unknown; seq?: unknown; type?: unknown; detail?: unknown; text?: unknown; approvalId?: unknown; approvalSource?: unknown; kind?: unknown };
      try { event = JSON.parse(String(data)); } catch { return; }
      if (!event || event.version !== 1 || typeof event.type !== 'string') return;
      // Lifecycle events replay on subscription; answer deltas are live-only.
      if (typeof event.seq === 'number' && event.seq > 0) {
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;
      }
      if (isProgressEventType(event.type)) onProgress({
        type: event.type,
        ...(typeof event.detail === 'string' ? { detail: event.detail } : {}),
        ...(typeof event.text === 'string' ? { text: event.text } : {}),
        ...(typeof event.approvalId === 'string' ? { approvalId: event.approvalId } : {}),
        ...(event.approvalSource === 'vault' || event.approvalSource === 'runtime'
          ? { approvalSource: event.approvalSource } : {}),
        ...(event.kind === 'stage' || event.kind === 'step' || event.kind === 'tool' ? { kind: event.kind } : {}),
      });
    };
    const finishFromDurableState = (recovering = true) => {
      if (handedOff) return;
      handedOff = true;
      if (recovering) onProgress({ type: 'reconnecting' });
      globalThis.clearTimeout(timeout);
      try {
        socket.close(1000, 'switching to durable result');
      } catch {
        /* The handshake may have failed before a socket opened. */
      }
      void pollAsk(runId, onProgress, deadline, recovering ? restoreLiveUpdates : undefined).then(resolve, reject).finally(() => {
        settled = true;
        const current = recoverySocket;
        recoverySocket = undefined;
        try { current?.close(); } catch { /* Already closed. */ }
      });
    };
    const timeout = globalThis.setTimeout(finishFromDurableState, 16 * 60 * 1_000);

    try {
      socket = new WebSocket(websocketUrl(`/api/runs/${encodeURIComponent(runId)}/events`));
    } catch {
      finishFromDurableState();
      return;
    }

    socket.onmessage = (message) => {
      if (handedOff) return;
      let event: {
        version?: unknown; seq?: unknown; type?: unknown; detail?: unknown; text?: unknown;
        approvalId?: unknown; approvalSource?: unknown; kind?: unknown;
      };
      try {
        event = JSON.parse(String(message.data)) as typeof event;
      } catch {
        return;
      }
      if (event.version !== 1 || typeof event.type !== 'string') return;
      if (typeof event.seq === 'number' && event.seq > 0) lastSeq = Math.max(lastSeq, event.seq);
      if (isProgressEventType(event.type)) {
        onProgress({
          type: event.type,
          ...(typeof event.detail === 'string' ? { detail: event.detail } : {}),
          ...(typeof event.text === 'string' ? { text: event.text } : {}),
          ...(typeof event.approvalId === 'string' ? { approvalId: event.approvalId } : {}),
          ...(event.approvalSource === 'vault' || event.approvalSource === 'runtime'
            ? { approvalSource: event.approvalSource } : {}),
          ...(event.kind === 'stage' || event.kind === 'step' || event.kind === 'tool' ? { kind: event.kind } : {}),
        });
      }
      if (['completed', 'failed', 'cancelled'].includes(event.type)) finishFromDurableState(false);
    };
    socket.onerror = () => finishFromDurableState();
    socket.onclose = () => finishFromDurableState();
  });
}

function websocketUrl(path: string): string {
  const fallback = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const url = new URL(`${BASE}${path}`, fallback);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isProgressEventType(value: string): value is AskProgressEvent['type'] {
  return ['queued', 'waking', 'working', 'retrying', 'needs_approval',
    'status', 'thinking', 'delta'].includes(value);
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
