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

  reset(): Promise<void>;
}
