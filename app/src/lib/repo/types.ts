import type { Approval, CountryCode, Lang, Policy } from '@/lib/types';

export type Theme = 'dark' | 'light';

export type FactSource = 'owner' | 'import' | 'agent' | 'connector';

/**
 * Something Jentera believes about this business, and its provenance.
 *
 * `source` and `confidence` are not decoration. A price the owner typed
 * and a price extracted from their website at 0.62 confidence must be
 * distinguishable, or the product will state a guess as fact to a
 * customer. `confirmed` is a separate axis again: who is willing to
 * stand behind the value, regardless of how it was obtained.
 */
export interface Fact {
  key: string;
  value: unknown;
  source: FactSource;
  sourceRef: string | null;
  confidence: number;
  confirmed: boolean;
  confirmedAt: string | null;
  version: number;
  createdAt: string;
}

/**
 * Everything the app persists for one business, loaded in one shot.
 *
 * Reads are synchronous at call sites because the provider holds this
 * object in state; only writes are async. That is what lets slice 1
 * swap in a network-backed implementation without touching consumers.
 */
export interface BusinessSnapshot {
  onboarded: boolean;
  setupDone: boolean;
  bizType: string;
  bizName: string;
  bizLoc: string;
  channels: string[] | null;
  /** Null means never set up, the same distinction `channels` draws.
      An empty array is a choice — the owner disconnected everything —
      and must not be re-seeded with defaults. */
  conns: string[] | null;
  country: CountryCode;
  lang: Lang;
  theme: Theme;
  approvals: Approval[];
  permissions: Record<string, Policy>;
  /** Keyed by playbook key. Indices are always strings. */
  workDone: Record<string, string[]>;
  /** Keyed by playbook key, then by pick. */
  learn: Record<string, Record<string, number>>;
  /** Live facts only. Superseded versions are fetched on demand. */
  facts: Fact[];
}

export interface IngestResult {
  runId: string;
  facts: number;
  keys: string[];
  /** Readable characters the page yielded. Tiny means a JavaScript
      shell was read rather than the site. */
  chars: number;
  /** Proposed public-page facts returned to onboarding so its review panel
      can reflect the source it actually read. They remain unconfirmed. */
  suggestions?: { key: string; value: string; confidence: number }[];
}

export type AskProgress = 'queued' | 'waking' | 'working' | 'retrying';
export type AskMode = 'ask' | 'work';

export interface AskOptions {
  mode?: AskMode;
  /** Stable conversation id so Hermes can keep context per chat, like Telegram. */
  sessionId?: string;
  onProgress?: (progress: AskProgress) => void;
}

export type WorkQuality = 'good' | 'poor';

export interface WorkSummary {
  id: string;
  runId: string | null;
  objective: string;
  outcome: string | null;
  status: string;
  function: string | null;
  channel: string | null;
  subject: string | null;
  minutesSaved: number | null;
  /** Owner's verdict, null until they rate it. Sent with activity. */
  outcomeQuality: WorkQuality | null;
  qualityAt: string | null;
  occurredAt: string;
}

export interface Connection {
  id: string;
  connector: string;
  method: string;
  status: 'connected' | 'expired' | 'revoked' | 'error';
  displayName: string | null;
  externalId: string | null;
  connectedAt: string;
  lastOkAt: string | null;
  lastError: string | null;
  /** Telegram is internal by default and becomes usable only after the
      signed-in owner claims one private chat through this deep link. */
  paired?: boolean;
  pairingUrl?: string | null;
}

export interface ConnectionHealth {
  url: string;
  pending: number;
  lastError: string | null;
  lastErrorAt: string | null;
  /** False when the far side is pointing somewhere else entirely,
      which looks identical to nothing happening. */
  pointsHere: boolean;
}

export interface TraceEvent {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface AskAnswer {
  text: string;
  /** Fact keys the answer drew on, so a wrong answer is traceable. */
  usedKeys: string[];
  /** False when nothing confirmed was available to reason from. */
  grounded: boolean;
}

export interface Activity {
  work: WorkSummary[];
  counters: {
    handled: number;
    needsYou: number;
    minutesSaved: number;
    thisWeek: number;
    /** Accounts genuinely connected, not the playbook's suggestions. */
    connections: number;
  };
}

export interface OnboardingCompletion {
  playbookKey: string;
  channels: string[];
  name?: string;
  locality?: string;
}

export type RuntimeState =
  | 'provisioning'
  | 'ready'
  | 'cold'
  | 'waking'
  | 'idle'
  | 'busy'
  | 'error'
  | 'upgrading'
  | 'migrating'
  | 'deleting';

export interface RuntimeSummary {
  status: RuntimeState;
  desiredRelease: string;
  observedRelease: string | null;
  lastReadyAt: string | null;
  lastError: string | null;
  observedRegion?: string | null;
  expectedRegion?: string | null;
  regionStatus?: 'optimal' | 'different' | 'unknown';
}

export interface RuntimeOverview {
  runtime: RuntimeSummary | null;
}

/** Thrown when a feature needs the server and there is no session. */
export class NeedsAccountError extends Error {
  constructor(what: string) {
    super(`${what} needs a Jentera account — the demo runs entirely in this browser.`);
    this.name = 'NeedsAccountError';
  }
}

export interface Repository {
  load(): Promise<BusinessSnapshot>;

  setBizType(key: string): Promise<void>;
  setBizProfile(p: { name?: string; loc?: string }): Promise<void>;
  /** Commit the owner's final answers and start their runtime as one
      server-side onboarding transition. */
  completeOnboarding(input: OnboardingCompletion): Promise<void>;
  setSetupDone(v: boolean): Promise<void>;
  setChannels(ch: string[]): Promise<void>;
  setConnections(conns: string[]): Promise<void>;
  setCountry(code: CountryCode): Promise<void>;
  setLang(lang: Lang): Promise<void>;
  setTheme(theme: Theme): Promise<void>;

  setPolicy(op: string, policy: Policy): Promise<void>;
  resetPolicies(): Promise<void>;

  queueApproval(a: Approval): Promise<void>;
  /** `text` replaces the draft when the owner edited it before
      approving. Sent with the decision, not saved separately, so there
      is no window where an approval points at a half-finished edit. */
  decideApproval(id: number, approved: boolean, text?: string): Promise<void>;

  markWorkDone(playbookKey: string, index: number): Promise<void>;
  recordLearn(playbookKey: string, pick: string): Promise<void>;

  /** Record or correct a fact. Supersedes rather than overwrites. */
  setFact(f: {
    key: string;
    value: unknown;
    source?: FactSource;
    sourceRef?: string | null;
    confidence?: number;
  }): Promise<void>;
  /** Vouch for the live value without changing its confidence. */
  confirmFact(key: string): Promise<void>;
  /** Confirm the imported facts the owner reviewed during onboarding. */
  confirmFacts(keys: string[]): Promise<void>;
  /** Retire the fact, keeping its history. */
  forgetFact(key: string): Promise<void>;
  /** Every version of one key, newest first. */
  factHistory(key: string): Promise<Fact[]>;

  /** Read a business's own website and propose facts from it. */
  ingest(url: string): Promise<IngestResult>;
  /** What Jentera has actually done, and the counts Home shows. */
  activity(): Promise<Activity>;
  /** Record the owner's verdict on a piece of work. */
  rateWork(workId: string, quality: WorkQuality): Promise<void>;
  /** How much technical detail this person wants. */
  detailLevel(): Promise<'beginner' | 'advanced'>;
  setDetailLevel(level: 'beginner' | 'advanced'): Promise<void>;
  /** The append-only trace of one run, newest last. */
  runTrace(runId: string): Promise<TraceEvent[]>;

  /** Answer a question from confirmed facts and real work records. */
  ask(question: string, options?: AskOptions): Promise<AskAnswer>;

  /** Accounts this business has connected. Never includes secrets. */
  connections(): Promise<Connection[]>;
  /** Connect a Telegram bot the owner created. */
  connectTelegram(token: string): Promise<Connection>;
  disconnect(id: string): Promise<void>;
  /** What the far side thinks the connection is doing. The answer to
      "I messaged the bot and nothing happened". */
  connectionHealth(id: string): Promise<ConnectionHealth>;

  /** Owner-safe runtime state; provider ids, URLs and credentials are never returned. */
  runtimeStatus(): Promise<RuntimeOverview>;
  /** Idempotently create or re-signal this business's provisioning task. */
  provisionRuntime(): Promise<void>;

  reset(): Promise<void>;
}
