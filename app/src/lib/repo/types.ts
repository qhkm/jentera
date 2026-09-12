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
  pending?: boolean;
  currentValue?: unknown;
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

export interface Specialist {
  id: string;
  /** Stable internal profile id. Owners edit the role, never this key. */
  profile: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

/**
 * Everything the app persists for one business, loaded in one shot.
 *
 * Reads are synchronous at call sites because the provider holds this
 * object in state; only writes are async. That is what lets slice 1
 * swap in a network-backed implementation without touching consumers.
 */
export interface BusinessSnapshot {
  canManageKnowledge?: boolean;
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
  /** Persistent roles defined by this business. The Chief of Staff is built in. */
  specialists: Specialist[];
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

export type AskProgress = 'queued' | 'waking' | 'working' | 'retrying' | 'needs_approval';

/** One event from the run stream: a lifecycle state, or the agent's own
    status line, a bounded slice of its reasoning, or answer text as it is
    produced. */
export type AskStatusKind = 'stage' | 'step' | 'tool';

export interface AskProgressEvent {
  type: AskProgress | 'status' | 'thinking' | 'delta' | 'reconnecting';
  detail?: string;
  text?: string;
  /** status only: a dispatch stage (a label), one of the agent's own steps,
      or a tool call (both kept as a list). */
  kind?: AskStatusKind;
  /** needs_approval: which approval to fetch. Nothing about the request
      travels through the stream — the card asks the API what it is. */
  approvalId?: string;
}
export type AskMode = 'ask' | 'work';

export type ResumeAskOptions = Pick<AskOptions, 'onProgress'>;

/** `PushSubscription.toJSON()`: the endpoint and the two browser keys. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface AskOptions {
  /** Stable across an explicit retry of the same first-job submission. */
  requestId?: string;
  mode?: AskMode;
  /** Stable conversation id so Hermes can keep context per chat, like Telegram. */
  sessionId?: string;
  /** Emitted once the server has accepted a real run, before its answer arrives. */
  onRunCreated?: (runId: string) => void;
  onProgress?: (event: AskProgressEvent) => void;
  /** Quick is the default, as on Telegram; deep opts into the research loop. */
  responseMode?: 'quick' | 'deep';
  /** Open this chat inside a workspace, so every member may read it. Only
      the first turn decides; later turns leave the chat where it is. */
  workspaceId?: string;
}

export type WorkKind = 'work' | 'conversation';
export type WorkQuality = 'good' | 'poor';

export interface WorkSummary {
  id: string;
  runId: string | null;
  /** Whether this person may open the run behind it. False for a
      colleague's private chat: the outcome is the business's to see, the
      conversation is not. Absent means yes; the server always sends it. */
  canOpen?: boolean;
  /** The address of the person who asked for it, when a person did. Shown
      on a team as the part before the @. */
  requestedBy?: string | null;
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
  /** work: Jentera did something (deep mode, a tool, an approval).
      conversation: a quick reply answered from what it knew. Optional only
      so fixtures predating the field still type; the server always sends it. */
  kind?: WorkKind;
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
  /** Business outcome, independent of whether the agent finished replying. */
  taskStatus?: string;
  runId?: string;
  text: string;
  /** Fact keys the answer drew on, so a wrong answer is traceable. */
  usedKeys: string[];
  /** False when nothing confirmed was available to reason from. */
  grounded: boolean;
  /** Present on durable answers: conversation or work. */
  kind?: WorkKind;
  /** What the agent did, as the chat showed it: its steps and tool calls.
      Read back from the run when the live list was missed. */
  steps?: string[];
  /** Files the agent produced for the owner, attached to the reply. */
  artifacts?: Artifact[];
}

export type BrowserCommand = { controlId: string } & (
  | { action: 'claim' | 'release' | 'frame' }
  | { action: 'navigate'; url: string }
  | { action: 'click'; x: number; y: number }
  | { action: 'text'; text: string }
  | { action: 'key'; key: string }
  | { action: 'scroll'; deltaY: number }
  | { action: 'tab'; index: number }
);
export interface BusinessBrowserState {
  enabled?: boolean;
  paused?: boolean;
  controlled?: boolean;
  expiresAt?: number;
  image?: string;
  width?: number;
  height?: number;
  tabs?: { index: number; origin: string; selected: boolean }[];
}

/** Read-only projection of the existing tenant-scoped run endpoint. */
export interface RunCoordination {
  assignment: { role: string | null; kind: 'specialist' | 'coordinator' } | null;
  events: { id: number; stage: 'requested' | 'returned' | 'failed'; at: string }[];
}

export interface RunResult {
  summaryOnly?: boolean;
  objective?: string;
  sessionId?: string;
  approvalId?: string;
  taskStatus?: string;
  runId: string;
  status: string;
  pending: boolean;
  text?: string;
  err?: string;
  /** Files the agent produced for the owner during this run. */
  artifacts?: Artifact[];
}

/** A file the agent handed the owner, stored under the business. */
export interface Artifact {
  id: string;
  runId: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
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
  canManage?: boolean;
  setupStatus?: string | null;
}

/** Thrown when a feature needs the server and there is no session. */
export class NeedsAccountError extends Error {
  constructor(what: string) {
    super(`${what} needs a Jentera account — the demo runs entirely in this browser.`);
    this.name = 'NeedsAccountError';
  }
}

export interface Repository {
  /** Remote only; callers must also require /api/me v1 discovery. */
  routines?: import('@/lib/routines/types').RoutinesApi;
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
  confirmFact(key: string, version?: number): Promise<void>;
  /** Confirm the imported facts the owner reviewed during onboarding. */
  confirmFacts(keys: string[]): Promise<void>;
  /** Retire the fact, keeping its history. */
  forgetFact(key: string, version?: number): Promise<void>;
  /** Every version of one key, newest first. */
  factHistory(key: string): Promise<Fact[]>;

  createSpecialist(input: Pick<Specialist, 'name' | 'description' | 'instructions'>): Promise<void>;
  updateSpecialist(
    id: string,
    input: Pick<Specialist, 'name' | 'description' | 'instructions'>,
  ): Promise<void>;
  disableSpecialist(id: string): Promise<void>;

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
  runCoordination?(runId: string): Promise<RunCoordination>;
  runTrace(runId: string): Promise<TraceEvent[]>;
  runResult(runId: string): Promise<RunResult>;
  taskReviewSummary?(runId: string): Promise<RunResult>;
  confirmTaskReview?(runId: string): Promise<void>;
  /** The people in this business and the invitations still open. Team plan
      only; the server says who may manage them. */
  team?(): Promise<Team>;
  inviteTeamMember?(email: string): Promise<TeamInvitation>;
  revokeTeamInvitation?(id: string): Promise<void>;
  /** Remove a staff member: their access ends at once; their work stays as history. */
  removeTeamMember?(userId: string): Promise<void>;
  /** Accept an invitation for the signed-in address; answers the business's name. */
  acceptInvitation?(token: string): Promise<{ businessName: string }>;
  /** Workspaces this person is in (the owner: all, with `member` saying which). */
  workspaces?(): Promise<Workspaces>;
  createWorkspace?(name: string, memberIds: string[]): Promise<Workspace>;
  addWorkspaceMember?(workspaceId: string, userId: string): Promise<void>;
  removeWorkspaceMember?(workspaceId: string, userId: string): Promise<void>;
  /** A workspace's chats, newest first, and one chat's turns for anyone who may read it. */
  workspaceChats?(workspaceId: string): Promise<WorkspaceChat[]>;
  chat?(chatId: string): Promise<ChatTranscript>;
  /** Close a task that is waiting on the owner without doing it: it reads
      as cancelled afterwards, never as handled. */
  dismissTask?(runId: string): Promise<void>;

  /** What the agent itself remembers, by specialist, and forgetting one entry.
      Owner only; `available` is false on a runtime that cannot answer yet. */
  agentMemory?(): Promise<AgentMemory>;
  forgetAgentMemory?(entry: { profile: string; file: 'MEMORY.md' | 'USER.md'; text: string }): Promise<void>;
  /** Learn from a document the owner uploads: the facts found land unconfirmed,
      with the file name as their source. The file itself is not kept. */
  ingestFile?(file: File): Promise<IngestResult & { source?: string }>;
  /** Answer a question from confirmed facts and real work records. */
  ask(question: string, options?: AskOptions): Promise<AskAnswer>;
  /** Reattach to a run this browser started before a reload took the
      page away: progress resumes and the answer lands as if it had not. */
  resumeAsk?(runId: string, options?: ResumeAskOptions): Promise<AskAnswer>;
  /** Wake the business's agent ahead of the first message; best effort. */
  warmAgent?(): Promise<void>;

  /** Web push, remote only. The server's VAPID public key, or null when
      push is not configured there. */
  pushPublicKey?(): Promise<string | null>;
  /** Hand this browser's subscription to the server. 'conflict' means the
      same browser is registered to another account; take a new one. */
  savePushSubscription?(subscription: PushSubscriptionJson): Promise<'saved' | 'conflict'>;
  deletePushSubscription?(endpoint: string): Promise<void>;

  /** Files the agent produced, newest first; remote only. */
  listArtifacts?(options?: { runId?: string; limit?: number }): Promise<Artifact[]>;
  /** Where a file downloads from; the session cookie travels with the click. */
  artifactUrl?(id: string): string;
  /** The file's bytes, for showing it in place. */
  fetchArtifact?(id: string): Promise<Blob>;

  /** Accounts this business has connected. Never includes secrets. */
  connections(): Promise<Connection[]>;
  /** Connect a Telegram bot the owner created. */
  connectTelegram(token: string): Promise<Connection>;
  /** Services that are connected by pasting a scoped token. Names only. */
  tokenConnectors(): Promise<{ connector: string; label: string }[]>;
  /** Connect one of them. The token is verified with the provider before
      it is stored, so a rejection arrives here rather than later. */
  connectToken(connector: string, token: string): Promise<Connection>;
  disconnect(id: string): Promise<void>;
  /** What the far side thinks the connection is doing. The answer to
      "I messaged the bot and nothing happened". */
  connectionHealth(id: string): Promise<ConnectionHealth>;

  /** Owner-safe runtime state; provider ids, URLs and credentials are never returned. */
  runtimeStatus(): Promise<RuntimeOverview>;
  businessBrowser(command?: BrowserCommand): Promise<BusinessBrowserState>;
  /** Idempotently create or re-signal this business's provisioning task. */
  provisionRuntime(): Promise<void>;

  reset(): Promise<void>;
}

/* ---- The team ---- */

export interface TeamMember {
  userId: string;
  email: string;
  role: 'owner' | 'staff';
  joinedAt: string;
  /** This is the signed-in person. */
  you: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: 'staff';
  createdAt: string;
  expiresAt: string;
}

export interface Team {
  members: TeamMember[];
  invitations: TeamInvitation[];
  /** Whether the signed-in person may invite and revoke. */
  canManage: boolean;
}

/* ---- Workspaces: shared chats ---- */

export interface WorkspaceMember {
  userId: string;
  email: string;
  you: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  /** Whether the signed-in person is in it and may read its chats. */
  member: boolean;
  members: WorkspaceMember[];
}

export interface Workspaces {
  workspaces: Workspace[];
  canManage: boolean;
}

export interface WorkspaceChat {
  id: string;
  title: string | null;
  createdBy: string;
  createdAt: string;
  lastAt: string;
  turns: number;
}

export interface ChatTurn {
  runId: string;
  question: string;
  status: string;
  requestedBy: string | null;
  createdAt: string;
  /** The answer, once the run completed; null while it runs or after it failed. */
  text: string | null;
  artifacts: Artifact[];
}

export interface ChatTranscript {
  id: string;
  title: string | null;
  workspaceId: string | null;
  createdBy: string;
  createdAt: string;
  lastAt: string;
  turns: ChatTurn[];
}

/* ---- The agent's own memory ---- */

export interface AgentMemoryEntry { index: number; text: string }
export interface AgentMemoryFile { file: 'MEMORY.md' | 'USER.md'; entries: AgentMemoryEntry[] }
export interface AgentMemoryProfile { profile: string; files: AgentMemoryFile[] }
export interface AgentMemory { available: boolean; profiles: AgentMemoryProfile[] }
