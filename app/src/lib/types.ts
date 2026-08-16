/* ============================================================
   Shapes recovered from biz-engine.js. The abbreviated keys are
   preserved deliberately — the playbook data is ported verbatim,
   and renaming ~1700 lines of it buys nothing. The comments carry
   the meaning the key names don't.
   ============================================================ */

export type CountryCode = 'MY' | 'ID' | 'SG' | 'TH' | 'VN' | 'PH';

/** Languages that actually have a translation table. */
export type Lang = 'en' | 'bm';

/**
 * A country's preferred locale — NOT the same set as `Lang`.
 * ID/TH/VN/PH declare 'id'/'th'/'vi'/'fil', none of which are
 * translated yet, so resolution falls back to English. Widen
 * `Lang` (and add the table) as translations land.
 */
export type LocaleCode = string;

export interface Country {
  code: CountryCode;
  name: string;
  lang: LocaleCode;
  currency: string;
  tld: string;
  defaultCh: string[];
  /** lowercase alias → canonical "City, CC" */
  cities: Record<string, string>;
}

/** How a connector is wired up. Customers never see an API key. */
export type ConnectorMethod = 'oauth' | 'link' | 'file' | 'bss';
export type ConnectorTier = 'T1' | 'T2' | 'T3' | 'T4';

export interface Connector {
  /** display name */
  n: string;
  /** emoji */
  e: string;
  tier: ConnectorTier;
  method: ConnectorMethod;
  /** human description of the auth flow */
  flow: string;
  /** what the agent is allowed to do once connected */
  scope: string[];
  countries: CountryCode[];
  meta?: boolean;
  fpga?: boolean;
  marketplace?: boolean;
  delivery?: boolean;
  pos?: boolean;
  courier?: boolean;
  regulated?: boolean;
  'e-invoice'?: boolean;
}

/** [label, colorClass, state] — state is 'covered' | 'live' | 'opportunity' */
export type PlaybookFunc = [string, string, string];

export interface Stat {
  /** eyebrow label */
  d: string;
  /** value */
  v: string;
  /** unit suffix */
  u: string;
  /** description */
  l: string;
  /** sub-note */
  s?: string;
  /** progress percentage */
  p?: number;
}

export interface Suggestion {
  t: string;
  d: string;
  tag: string;
  cta: string;
}

export interface TeamMember {
  e: string;
  n: string;
  /** channels this agent works across */
  ch: string;
  d: string;
  /** activity meta line */
  m: string;
  /** true when the agent is gated behind a connection */
  setup?: boolean;
}

export interface WorkItem {
  e: string;
  n: string;
  /** timestamp / source line */
  t: string;
  tag: string;
  /** tag color: '' | 'green' | 'red' | 'amber' */
  tc: string;
  d: string;
  /** confirmation copy shown after approval */
  cta?: string;
}

export interface PlaybookConnection {
  e: string;
  n: string;
  /** status line */
  s: string;
  d: string;
  on: boolean;
  cta?: string;
}

export interface Playbook {
  icon: string;
  keywords: string[];
  /** per-country extra keywords */
  kw?: Partial<Record<CountryCode, string[]>>;
  name: string;
  type: string;
  sub: string;
  site: string;
  booking: string;
  systems: string;
  loc?: string;
  potential: number;
  opportunities: number;
  ch: string[];
  detect: string;
  confirm: string;
  funcs: PlaybookFunc[];
  stats: Stat[];
  sug: Suggestion;
  team: TeamMember[];
  work: WorkItem[];
  conns: PlaybookConnection[];
}

/** A playbook resolved for the active country + user overrides. */
export interface Business {
  icon: string;
  name: string;
  type: string;
  sub: string;
  site: string;
  loc: string;
  booking: string;
  systems: string;
  potential: number;
  opportunities: number;
  ch: string[];
  detect: string;
  confirm: string;
  funcs: PlaybookFunc[];
  stats: Stat[];
  sug: Suggestion;
  team: TeamMember[];
  work: WorkItem[];
  conns: PlaybookConnection[];
}

export type Risk = 'low' | 'medium' | 'high';

export interface Approval {
  id: number;
  conn: string;
  op: string;
  args: Record<string, unknown>;
  risk: Risk;
  ts: string;
  status: 'pending' | 'approved' | 'rejected';
  decided?: string;
}

export interface AgentRecommendation {
  e: string;
  n: string;
  d: string;
  tag: string;
}
