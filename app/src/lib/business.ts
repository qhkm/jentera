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
import type { AgentRecommendation, Business } from './types';
import { getCountry, localizeDetect, localizeSite } from './country';
import { FALLBACK_KEY, extractLocation, extractName, inferPlaybook } from './infer';
import * as store from './storage';
import { KEYS } from './storage';

export function isPlaybookKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAYBOOKS, key);
}

export function getBizType(): string {
  const t = store.get(KEYS.bizType, '');
  return isPlaybookKey(t) ? t : FALLBACK_KEY;
}

export function setBizType(key: string): boolean {
  if (!isPlaybookKey(key)) return false;
  store.set(KEYS.bizType, key);
  return true;
}

/** Resolve a playbook into the renderable business object. */
export function resolveBusiness(key: string): Business {
  const k = isPlaybookKey(key) ? key : FALLBACK_KEY;
  const p = PLAYBOOKS[k];
  const country = getCountry();

  const name = store.get(KEYS.bizName, '') || p.name;
  const loc =
    store.get(KEYS.bizLoc, '') ||
    (country.code !== 'MY' && p.loc ? country.name : p.loc || country.name);

  return {
    icon: p.icon,
    name,
    type: p.type,
    sub: p.sub,
    site: localizeSite(p),
    loc,
    booking: p.booking,
    systems: p.systems,
    potential: p.potential,
    opportunities: p.opportunities,
    ch: [...p.ch],
    detect: localizeDetect(p),
    confirm: p.confirm,
    funcs: p.funcs,
    stats: p.stats,
    sug: p.sug,
    team: p.team,
    work: p.work,
    conns: p.conns,
  };
}

/** Free text in, persisted business out. The onboarding entry point. */
export function registerBusiness(text: string): { key: string; score: number; business: Business } {
  const { key, score } = inferPlaybook(text);

  store.set(KEYS.bizType, key);
  store.set(KEYS.bizName, extractName(text, PLAYBOOKS[key].name));

  const loc = extractLocation(text);
  if (loc) store.set(KEYS.bizLoc, loc);

  learn(key, `inferred:${key}`);

  return { key, score, business: resolveBusiness(key) };
}

/* ---- Setup / connection state ---- */

export function isSetupDone(): boolean {
  return store.get(KEYS.setupDone, '') === '1';
}

export function isOnboarded(): boolean {
  return store.get(KEYS.onboarded, '') === '1';
}

/** Completing setup lifts the headline potential score. */
export function bumpPotential(v: number): number {
  return isSetupDone() ? Math.min(96, v + 20) : v;
}

export function getChannels(): string[] | null {
  const a = store.getJSON<string[]>(KEYS.channels, []);
  return a.length ? a : null;
}

export function getConnections(): string[] {
  const v = store.getJSON<unknown>(KEYS.conns, null);
  return Array.isArray(v) ? (v as string[]) : [];
}

/** Seed connections from the playbook defaults, once. */
export function seedConnections(key: string): void {
  if (!store.isUnset(KEYS.conns)) return;
  const b = resolveBusiness(key);
  store.setJSON(
    KEYS.conns,
    b.conns.filter((c) => c.on).map((c) => c.n),
  );
}

export function toggleConnection(name: string): string[] {
  const a = getConnections();
  const i = a.indexOf(name);
  if (i >= 0) a.splice(i, 1);
  else a.push(name);
  store.setJSON(KEYS.conns, a);
  return a;
}

export function isConnected(name: string): boolean {
  return getConnections().includes(name);
}

/** An agent is live once its channel is connected (or accounting, for setup agents). */
export function isAgentReady(t: { setup?: boolean; ch?: string }): boolean {
  if (t.setup) return isConnected('Accounting');
  const ch = String(t.ch ?? '').toLowerCase();
  const keys = getConnections();
  return keys.some((cn) => ch.includes(cn.split(' ')[0].toLowerCase())) || keys.length > 0;
}

/* ---- Work items ---- */

export function isWorkDone(key: string, i: number): boolean {
  return store.getJSON<number[]>(KEYS.workDone + key, []).includes(i);
}

export function markWorkDone(key: string, i: number): void {
  const a = store.getJSON<number[]>(KEYS.workDone + key, []);
  if (!a.includes(i)) {
    a.push(i);
    store.setJSON(KEYS.workDone + key, a);
  }
}

/* ---- Recommendations: opportunity functions become suggested agents ---- */

export function recommendations(b: Business): AgentRecommendation[] {
  return b.funcs
    .filter(([, , state]) => state === 'opportunity')
    .map(([label]) => REC_MAP[label])
    .filter((r): r is AgentRecommendation => Boolean(r));
}

/* ---- Self-improving (local demo) ---- */

export function learn(key: string, pick: string): void {
  const obj = store.getJSON<Record<string, number>>(KEYS.learn + key, {});
  obj[pick] = (obj[pick] ?? 0) + 1;
  store.setJSON(KEYS.learn + key, obj);
}

export function popular(key: string): { pick: string; n: number } | null {
  const obj = store.getJSON<Record<string, number>>(KEYS.learn + key, {});
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
