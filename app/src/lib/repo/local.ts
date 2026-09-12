/* ============================================================
   The one Repository implementation, over localStorage.

   Anonymous visitors keep this forever — it is the no-signup demo.
   Slice 1 adds RemoteRepository beside it; no consumer changes.
   ============================================================ */

import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import type { Approval, CountryCode, Lang, Policy } from '@/lib/types';
import type {
  Artifact,
  Activity,
  BusinessSnapshot,
  Fact,
  FactSource,
  AskAnswer,
  Connection,
  ConnectionHealth,
  IngestResult,
  Repository,
  TraceEvent,
  Theme,
  OnboardingCompletion,
  RuntimeOverview,
  RunResult,
  Specialist,
} from './types';
import { NeedsAccountError } from './types';

/** Collect every `prefix{suffix}` key into a map keyed by suffix. */
function collectPrefixed<T>(prefix: string, fallback: T): Record<string, T> {
  const out: Record<string, T> = {};
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(prefix)) continue;
      out[k.slice(prefix.length)] = store.getJSON<T>(k, fallback);
    }
  } catch {
    /* storage unavailable — an empty map is the correct answer */
  }
  return out;
}

/* The demo keeps retired versions, exactly as the server does. A
   correction that silently dropped its history here would make the two
   implementations disagree about the one property business memory
   exists to provide. */
interface StoredFact extends Fact {
  live: boolean;
}

const STARTER_SPECIALISTS: Specialist[] = [
  { id: 'operations', profile: 'operations', name: 'Operations', description: 'Processes, planning, stock, suppliers and follow-through.', instructions: '', enabled: true },
  { id: 'customers', profile: 'customers', name: 'Customer communications', description: 'Enquiries, replies, bookings and service recovery.', instructions: '', enabled: true },
  { id: 'growth', profile: 'growth', name: 'Growth and marketing', description: 'Research, campaigns, content, sales and retention.', instructions: '', enabled: true },
  { id: 'records', profile: 'records', name: 'Finance and records', description: 'Invoices, expenses, cash flow, documents and summaries.', instructions: '', enabled: true },
];

function localSpecialists(): Specialist[] {
  return store.getJSON<Specialist[]>(KEYS.specialists, STARTER_SPECIALISTS)
    .filter((specialist) => specialist.enabled);
}

function specialistInput(input: Pick<Specialist, 'name' | 'description' | 'instructions'>) {
  const clean = {
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
  };
  if (!clean.name || clean.name.length > 60) throw new Error('Specialist name must be 1 to 60 characters.');
  if (!clean.description || clean.description.length > 500) throw new Error('Specialist remit must be 1 to 500 characters.');
  if (clean.instructions.length > 4000) throw new Error('Specialist instructions must be at most 4000 characters.');
  return clean;
}

function allVersions(): StoredFact[] {
  return store.getJSON<StoredFact[]>(KEYS.facts, []);
}

export class LocalRepository implements Repository {
  async load(): Promise<BusinessSnapshot> {
    const channels = store.getJSON<string[]>(KEYS.channels, []);
    const conns = store.getJSON<unknown>(KEYS.conns, null);
    const theme = store.get(KEYS.theme, '');
    const workDoneRaw = collectPrefixed<unknown[]>(KEYS.workDone, []);
    const workDone: Record<string, string[]> = {};
    for (const [key, list] of Object.entries(workDoneRaw)) {
      workDone[key] = list.map(String);
    }

    return {
      onboarded: store.get(KEYS.onboarded, '') === '1',
      setupDone: store.get(KEYS.setupDone, '') === '1',
      bizType: store.get(KEYS.bizType, ''),
      bizName: store.get(KEYS.bizName, ''),
      bizLoc: store.get(KEYS.bizLoc, ''),
      channels: channels.length ? channels : null,
      conns: Array.isArray(conns) ? (conns as string[]) : null,
      country: store.get(KEYS.country, 'MY') as CountryCode,
      lang: (store.get(KEYS.lang, 'en') === 'bm' ? 'bm' : 'en') as Lang,
      theme: theme === 'light' ? 'light' : 'dark',
      approvals: store.getJSON<Approval[]>(KEYS.approvals, []),
      permissions: store.getJSON<Record<string, Policy>>(KEYS.permissions, {}),
      canManageKnowledge: true,
      facts: [...new Map(allVersions().filter((f) => f.live || f.pending)
        .sort((a, b) => a.version - b.version).map((f) => [f.key, f])).values()]
        .sort((a, b) => a.key.localeCompare(b.key)),
      workDone,
      learn: collectPrefixed<Record<string, number>>(KEYS.learn, {}),
      specialists: localSpecialists(),
    };
  }

  async setBizType(key: string): Promise<void> {
    store.set(KEYS.bizType, key);
  }

  async setBizProfile(p: { name?: string; loc?: string }): Promise<void> {
    if (p.name !== undefined) store.set(KEYS.bizName, p.name);
    if (p.loc !== undefined) store.set(KEYS.bizLoc, p.loc);
  }

  async setOnboarded(v: boolean): Promise<void> {
    if (v) store.set(KEYS.onboarded, '1');
    else store.remove(KEYS.onboarded);
  }

  async completeOnboarding(input: OnboardingCompletion): Promise<void> {
    await this.setBizType(input.playbookKey);
    await this.setChannels(input.channels);
    await this.setBizProfile({ name: input.name, loc: input.locality });
    await this.setOnboarded(true);
  }

  async setSetupDone(v: boolean): Promise<void> {
    if (v) store.set(KEYS.setupDone, '1');
    else store.remove(KEYS.setupDone);
  }

  async setChannels(ch: string[]): Promise<void> {
    store.setJSON(KEYS.channels, ch);
  }

  async setConnections(conns: string[]): Promise<void> {
    store.setJSON(KEYS.conns, conns);
  }

  async setCountry(code: CountryCode): Promise<void> {
    store.set(KEYS.country, code);
  }

  async setLang(lang: Lang): Promise<void> {
    store.set(KEYS.lang, lang);
  }

  async setTheme(theme: Theme): Promise<void> {
    store.set(KEYS.theme, theme);
  }

  async setPolicy(op: string, policy: Policy): Promise<void> {
    const stored = store.getJSON<Record<string, Policy>>(KEYS.permissions, {});
    store.setJSON(KEYS.permissions, { ...stored, [op]: policy });
  }

  async resetPolicies(): Promise<void> {
    store.setJSON(KEYS.permissions, {});
  }

  async queueApproval(a: Approval): Promise<void> {
    const q = store.getJSON<Approval[]>(KEYS.approvals, []);
    store.setJSON(KEYS.approvals, [...q, a]);
  }

  async decideApproval(id: number, approved: boolean): Promise<void> {
    const q = store.getJSON<Approval[]>(KEYS.approvals, []);

    /* Reject a second decide rather than silently re-setting the status.
       The server enforces this with a conditional UPDATE — it is what
       stops an approved message being sent to a customer twice — and the
       two implementations have to agree, or a screen written against the
       forgiving one breaks against the strict one. */
    const target = q.find((a) => a.id === id);
    if (!target || target.status !== 'pending') {
      throw new Error('That approval is no longer pending.');
    }

    store.setJSON(
      KEYS.approvals,
      q.map((a) =>
        a.id === id
          ? {
              ...a,
              status: approved ? ('approved' as const) : ('rejected' as const),
              decided: new Date().toISOString(),
            }
          : a,
      ),
    );
  }

  /** The engine wrote these as strings; keep writing strings. */
  async markWorkDone(playbookKey: string, index: number): Promise<void> {
    const raw = store.getJSON<unknown[]>(KEYS.workDone + playbookKey, []);
    if (raw.some((v) => String(v) === String(index))) return;
    store.setJSON(KEYS.workDone + playbookKey, [...raw.map(String), String(index)]);
  }

  async recordLearn(playbookKey: string, pick: string): Promise<void> {
    const obj = store.getJSON<Record<string, number>>(KEYS.learn + playbookKey, {});
    obj[pick] = (obj[pick] ?? 0) + 1;
    store.setJSON(KEYS.learn + playbookKey, obj);
  }

  async setFact(f: {
    key: string;
    value: unknown;
    source?: FactSource;
    sourceRef?: string | null;
    confidence?: number;
  }): Promise<void> {
    const rows = allVersions();
    const source = f.source ?? 'owner';
    const current = rows.find((r) => r.key === f.key && r.live && r.confirmed);
    const pending = source !== 'owner' && Boolean(current);
    // Version counts over the whole history, not over the live row:
    // a key that was forgotten has no live row, and restarting at 1
    // would collide with the 1 already stored.
    const version = rows.reduce((n, r) => (r.key === f.key ? Math.max(n, r.version) : n), 0) + 1;
    const now = new Date().toISOString();

    store.setJSON(KEYS.facts, [
      ...rows.map((r) => (r.key === f.key && (r.pending || (r.live && !pending))
        ? { ...r, live: false, pending: false } : r)),
      {
        key: f.key,
        value: f.value,
        source,
        sourceRef: f.sourceRef ?? null,
        confidence: f.confidence ?? 1,
        // The owner stating a value is also vouching for it; any other
        // source has to be confirmed separately.
        confirmed: source === 'owner',
        confirmedAt: source === 'owner' ? now : null,
        version,
        createdAt: now,
        live: !pending,
        ...(pending ? { pending: true, currentValue: current?.value } : {}),
      },
    ]);
  }

  async confirmFact(key: string, version?: number): Promise<void> {
    const rows = allVersions();
    const candidate = rows.filter((r) => r.key === key && (r.live || r.pending))
      .sort((a, b) => b.version - a.version)[0];
    if (!candidate || (version !== undefined && version !== candidate.version)
      || (candidate.pending && version === undefined)) throw new Error('This fact changed. Refresh and review it again.');
    store.setJSON(
      KEYS.facts,
      rows.map((r) =>
        r.key === key && r.version === candidate.version
          ? { ...r, live: true, pending: false, confirmed: true, confirmedAt: new Date().toISOString() }
          : r.key === key && r.live ? { ...r, live: false } : r,
      ),
    );
  }

  async confirmFacts(keys: string[]): Promise<void> {
    for (const key of [...new Set(keys)]) await this.confirmFact(key);
  }

  async forgetFact(key: string, version?: number): Promise<void> {
    store.setJSON(
      KEYS.facts,
      allVersions().map((r) => (r.key === key && (r.live || r.pending)
        && (version === undefined || r.version === version) ? { ...r, live: false, pending: false } : r)),
    );
  }

  async factHistory(key: string): Promise<Fact[]> {
    return allVersions()
      .filter((r) => r.key === key)
      .sort((a, b) => b.version - a.version);
  }

  async createSpecialist(input: Pick<Specialist, 'name' | 'description' | 'instructions'>): Promise<void> {
    const specialists = localSpecialists();
    if (specialists.length >= 8) throw new Error('A business can have at most 8 active specialists.');
    const id = crypto.randomUUID();
    store.setJSON(KEYS.specialists, [
      ...specialists,
      { ...specialistInput(input), id, profile: `sp-${id.replace(/-/g, '').slice(0, 20)}`, enabled: true },
    ]);
  }

  async updateSpecialist(
    id: string,
    input: Pick<Specialist, 'name' | 'description' | 'instructions'>,
  ): Promise<void> {
    const specialists = localSpecialists();
    if (!specialists.some((specialist) => specialist.id === id)) throw new Error('Specialist not found.');
    const clean = specialistInput(input);
    store.setJSON(KEYS.specialists, specialists.map((specialist) =>
      specialist.id === id ? { ...specialist, ...clean } : specialist));
  }

  async disableSpecialist(id: string): Promise<void> {
    const specialists = localSpecialists();
    if (!specialists.some((specialist) => specialist.id === id)) throw new Error('Specialist not found.');
    store.setJSON(KEYS.specialists, specialists.filter((specialist) => specialist.id !== id));
  }

  /* The demo has no server, so it cannot fetch anything. Saying so
     plainly is better than a silent no-op that looks like a failure of
     the feature rather than of the demo. */
  async ingest(): Promise<IngestResult> {
    throw new NeedsAccountError('Reading your website');
  }

  async activity(): Promise<Activity> {
    // Nothing has really happened in the demo; the screens fall back
    // to their playbook illustrations when this is empty.
    return {
      work: [],
      counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 },
    };
  }

  async rateWork(): Promise<void> {
    // The demo has no real work records, so there is nothing to rate.
    throw new NeedsAccountError('Rating Jentera\'s work');
  }

  async businessBrowser(): Promise<import('./types').BusinessBrowserState> {
    throw new Error('Sign in to use your business browser.');
  }

  async runtimeStatus(): Promise<RuntimeOverview> {
    return { runtime: null };
  }

  async provisionRuntime(): Promise<void> {
    throw new NeedsAccountError('Creating a private Jentera runtime');
  }

  async ask(_question?: string, _options?: import('./types').AskOptions): Promise<AskAnswer> {
    throw new NeedsAccountError('Asking Jentera about your business');
  }

  async connections(): Promise<Connection[]> {
    return [];
  }

  /* Nothing to connect without a backend: the demo has no provider to
     verify a token against, and inventing a connected state here would be
     the kind of lie the playbook figures already taught us not to tell. */
  async tokenConnectors(): Promise<{ connector: string; label: string }[]> {
    return [];
  }

  async connectToken(): Promise<Connection> {
    throw new Error('Connecting a service needs an account.');
  }

  async connectTelegram(): Promise<Connection> {
    throw new NeedsAccountError('Connecting Telegram');
  }

  async disconnect(): Promise<void> {
    throw new NeedsAccountError('Disconnecting an account');
  }

  async connectionHealth(): Promise<ConnectionHealth> {
    throw new NeedsAccountError('Checking a connection');
  }

  /* The demo is the beginner view by definition — there is no server,
     so there is no trace to show and nothing technical to reveal. */
  async detailLevel(): Promise<'beginner' | 'advanced'> {
    return 'beginner';
  }

  /* Parameter kept despite being unused: matching the interface means
     a caller — or a test — can substitute this for the real thing
     without TypeScript objecting to a signature the contract does
     declare. */
  async setDetailLevel(_level: 'beginner' | 'advanced'): Promise<void> {
    throw new NeedsAccountError('Changing how much detail you see');
  }

  async runTrace(): Promise<TraceEvent[]> {
    return [];
  }

  /* The demo has no agent and produces no files; the views render empty. */
  async listArtifacts(): Promise<Artifact[]> {
    return [];
  }

  artifactUrl(_id: string): string {
    return '#';
  }

  async fetchArtifact(_id: string): Promise<Blob> {
    throw new Error('This file could not be opened.');
  }

  async runResult(): Promise<RunResult> {
    throw new NeedsAccountError('Viewing task details');
  }

  async reset(): Promise<void> {
    store.resetAll();
  }
}
