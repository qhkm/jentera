/* ============================================================
   Business resolution — playbook + country + user overrides into
   the single object the UI renders from.

   The old engine memoised this in a module-level BIZ cache and
   hand-invalidated it on every mutation. Here resolution is a pure
   function of (key, country, overrides); React memoises it in
   useBusiness, so there is no cache to forget to clear.
   ============================================================ */

import { PLAYBOOKS } from './data/playbooks';
import { REC_MAP } from './data/recommendations';
import type { AgentRecommendation, Business, TeamMember } from './types';
import { getCountry, localizeDetect, localizeSite } from './country';
import { FALLBACK_KEY, extractLocation, extractName, inferPlaybook } from './infer';
import type { BusinessSnapshot } from '@/lib/repo/types';

export function isPlaybookKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAYBOOKS, key);
}

export function getBizType(snap: BusinessSnapshot): string {
  return isPlaybookKey(snap.bizType) ? snap.bizType : FALLBACK_KEY;
}

/** Resolve a playbook into the renderable business object. */
export function resolveBusiness(snap: BusinessSnapshot, key: string): Business {
  const k = isPlaybookKey(key) ? key : FALLBACK_KEY;
  const p = PLAYBOOKS[k];
  const country = getCountry(snap);

  const name = snap.bizName || p.name;
  const loc =
    snap.bizLoc || (country.code !== 'MY' && p.loc ? country.name : p.loc || country.name);

  return {
    icon: p.icon,
    name,
    type: p.type,
    sub: p.sub,
    site: localizeSite(snap, p),
    loc,
    booking: p.booking,
    systems: p.systems,
    potential: p.potential,
    opportunities: p.opportunities,
    ch: [...p.ch],
    detect: localizeDetect(snap, p),
    confirm: p.confirm,
    funcs: p.funcs,
    stats: p.stats,
    sug: p.sug,
    /* Every industry playbook historically put a customer responder first.
       The default Jentera identity is now the owner's internal agent; the rest
       industry-specific team remains available as later automation. */
    /* Audience is explicit in the resolved product model. The private owner
       assistant is first, while playbook specialists remain available as
       customer-facing agents that must be enabled deliberately later. */
    team: [
      internalBusinessAssistant(),
      ...p.team.map((member) => ({ ...member, audience: 'customer' as const })),
    ],
    work: p.work,
    conns: p.conns,
  };
}

function internalBusinessAssistant(): TeamMember {
  return {
    e: '🧭',
    n: 'Business Assistant',
    ch: 'Private workspace · Telegram',
    d: 'Works with you on operations, research, planning, writing, and day-to-day business tasks. Not customer-facing by default.',
    m: 'Private · ready for your instructions',
    audience: 'internal',
  };
}

/**
 * Rewrite the city in a playbook's confirmation sentence to the one the
 * user actually named.
 *
 * 14 of the 20 confirm strings hardcode the playbook's default city
 * ("…a salon/beauty business in Shah Alam. Is that correct?"). Someone
 * in Ipoh was being asked to confirm Shah Alam — on the one screen whose
 * entire job is proving Jentera understood them. The location was already
 * extracted correctly; only this sentence ignored it.
 */
export function confirmFor(snap: BusinessSnapshot, playbookKey: string, text: string): string {
  const p = PLAYBOOKS[isPlaybookKey(playbookKey) ? playbookKey : FALLBACK_KEY];
  const loc = extractLocation(snap, text);
  if (!loc) return p.confirm;

  const city = loc.split(',')[0].trim();
  if (!city) return p.confirm;

  // "... in <City>. Is that correct?" / "... di <Bandar>. Betul?"
  const rewritten = p.confirm.replace(
    /\b(in|di)\s+[^.]+?(\.\s*(?:Is that correct|Betul))/i,
    (_m, prep: string, tail: string) => `${prep} ${city}${tail}`,
  );
  return rewritten;
}

/** Free text in, the writes a caller should apply out. Performs none of them. */
export function planRegisterBusiness(
  snap: BusinessSnapshot,
  text: string,
): {
  key: string;
  score: number;
  bizName: string;
  bizLoc: string | null;
  learnPick: string;
} {
  const { key, score } = inferPlaybook(snap, text);
  return {
    key,
    score,
    bizName: extractName(text, PLAYBOOKS[key].name),
    bizLoc: extractLocation(snap, text) || null,
    learnPick: `inferred:${key}`,
  };
}

/* ---- Setup / connection state ---- */

export function isSetupDone(snap: BusinessSnapshot): boolean {
  return snap.setupDone;
}

export function isOnboarded(snap: BusinessSnapshot): boolean {
  return snap.onboarded;
}

/** Completing setup lifts the headline potential score. */
export function bumpPotential(snap: BusinessSnapshot, v: number): number {
  return snap.setupDone ? Math.min(96, v + 20) : v;
}

export function getChannels(snap: BusinessSnapshot): string[] | null {
  return snap.channels;
}

export function getConnections(snap: BusinessSnapshot): string[] {
  return snap.conns ?? [];
}

/** The playbook's default connections, or null when the owner already has some. */
export function planSeedConnections(snap: BusinessSnapshot, key: string): string[] | null {
  /* Null, not empty. An owner who disconnected everything has made a
     choice; reading that as "never seeded" put it all back on their
     next load. */
  if (snap.conns !== null) return null;
  return resolveBusiness(snap, key)
    .conns.filter((c) => c.on)
    .map((c) => c.n);
}

/** The connection list after toggling one name. Caller persists it. */
export function planToggleConnection(snap: BusinessSnapshot, name: string): string[] {
  const a = [...(snap.conns ?? [])];
  const i = a.indexOf(name);
  if (i >= 0) a.splice(i, 1);
  else a.push(name);
  return a;
}

export function isConnected(snap: BusinessSnapshot, name: string): boolean {
  return (snap.conns ?? []).includes(name);
}

/** An agent is live once its channel is connected (or accounting, for setup agents). */
export function isAgentReady(snap: BusinessSnapshot, t: { setup?: boolean; ch?: string }): boolean {
  if (t.setup) return isConnected(snap, 'Accounting');
  const ch = String(t.ch ?? '').toLowerCase();
  const keys = snap.conns ?? [];
  return keys.some((cn) => ch.includes(cn.split(' ')[0].toLowerCase())) || keys.length > 0;
}

/* ---- Work items ---- */

/**
 * The engine writes these indices as strings (`JSON.stringify(["0","2"])`);
 * an earlier version of this port wrote numbers. Read both, write strings,
 * so a user who approved work on the static site does not find it
 * un-approved after the cutover.
 */
export function isWorkDone(snap: BusinessSnapshot, key: string, i: number): boolean {
  return (snap.workDone[key] ?? []).some((v) => String(v) === String(i));
}

/* ---- Recommendations: opportunity functions become suggested agents ---- */

export function recommendations(b: Business): AgentRecommendation[] {
  return b.funcs
    .filter(([, , state]) => state === 'opportunity')
    .map(([label]) => REC_MAP[label])
    .filter((r): r is AgentRecommendation => Boolean(r));
}

/* ---- Self-improving (local demo) ---- */

export function popular(snap: BusinessSnapshot, key: string): { pick: string; n: number } | null {
  const obj = snap.learn[key] ?? {};
  let best: string | null = null;
  let bestN = 0;
  for (const [pick, n] of Object.entries(obj)) {
    if (n > bestN) {
      bestN = n;
      best = pick;
    }
  }
  return best !== null ? { pick: best, n: bestN } : null;
}

/* ---- Real readiness ---------------------------------------------- */

export interface Milestone {
  key: string;
  done: boolean;
}

/**
 * How far this business actually is, from things that are true.
 *
 * The sidebar used to show a percentage taken from the playbook —
 * "Jentera can handle 82%" — identical for every business of that type
 * and unmoved by anything the owner did. It read as a measurement and
 * was a brochure figure, which is the worst combination: precise,
 * prominent, and untethered.
 *
 * These three are checkable and move. They are also the actual arc of
 * the product: it has to know something, have a way to reach people,
 * and have done something.
 */
export function milestones(
  snap: BusinessSnapshot,
  handled: number,
  connections: number,
): Milestone[] {
  return [
    { key: 'knows', done: snap.facts.some((f) => f.confirmed) },
    /* The real connection count, not `snap.conns`. That list is seeded
       from the playbook — it named WhatsApp, Instagram, Google Calendar
       and Google Sheets for a business that had connected none of them,
       and a milestone reading it reported success for nothing. */
    { key: 'connected', done: connections > 0 },
    { key: 'working', done: handled > 0 },
  ];
}

/** Whole percent, so the bar and the number cannot disagree. */
export function readiness(
  snap: BusinessSnapshot,
  handled: number,
  connections: number,
): number {
  const m = milestones(snap, handled, connections);
  return Math.round((m.filter((x) => x.done).length / m.length) * 100);
}
