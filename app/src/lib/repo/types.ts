import type { Approval, CountryCode, Lang, Policy } from '@/lib/types';

export type Theme = 'dark' | 'light';

export type FactSource = 'owner' | 'import' | 'agent' | 'connector';

/**
 * Something AISAR believes about this business, and its provenance.
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
  conns: string[];
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
}

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
  occurredAt: string;
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
  counters: { handled: number; needsYou: number; minutesSaved: number; thisWeek: number };
}

/** Thrown when a feature needs the server and there is no session. */
export class NeedsAccountError extends Error {
  constructor(what: string) {
    super(`${what} needs an AISAR account — the demo runs entirely in this browser.`);
    this.name = 'NeedsAccountError';
  }
}

export interface Repository {
  load(): Promise<BusinessSnapshot>;

  setBizType(key: string): Promise<void>;
  setBizProfile(p: { name?: string; loc?: string }): Promise<void>;
  setOnboarded(v: boolean): Promise<void>;
  setSetupDone(v: boolean): Promise<void>;
  setChannels(ch: string[]): Promise<void>;
  setConnections(conns: string[]): Promise<void>;
  setCountry(code: CountryCode): Promise<void>;
  setLang(lang: Lang): Promise<void>;
  setTheme(theme: Theme): Promise<void>;

  setPolicy(op: string, policy: Policy): Promise<void>;
  resetPolicies(): Promise<void>;

  queueApproval(a: Approval): Promise<void>;
  decideApproval(id: number, approved: boolean): Promise<void>;

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
  /** Retire the fact, keeping its history. */
  forgetFact(key: string): Promise<void>;
  /** Every version of one key, newest first. */
  factHistory(key: string): Promise<Fact[]>;

  /** Read a business's own website and propose facts from it. */
  ingest(url: string): Promise<IngestResult>;
  /** What AISAR has actually done, and the counts Home shows. */
  activity(): Promise<Activity>;
  /** Answer a question from confirmed facts and real work records. */
  ask(question: string): Promise<AskAnswer>;

  reset(): Promise<void>;
}
