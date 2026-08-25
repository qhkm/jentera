/* ============================================================
   The one Repository implementation, over localStorage.

   Anonymous visitors keep this forever — it is the no-signup demo.
   Slice 1 adds RemoteRepository beside it; no consumer changes.
   ============================================================ */

import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import type { Approval, CountryCode, Lang } from '@/lib/types';
import type { Policy } from '@/lib/permissions';
import type { BusinessSnapshot, Repository, Theme } from './types';

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
      conns: Array.isArray(conns) ? (conns as string[]) : [],
      country: store.get(KEYS.country, 'MY') as CountryCode,
      lang: (store.get(KEYS.lang, 'en') === 'bm' ? 'bm' : 'en') as Lang,
      theme: theme === 'light' ? 'light' : 'dark',
      approvals: store.getJSON<Approval[]>(KEYS.approvals, []),
      permissions: store.getJSON<Record<string, Policy>>(KEYS.permissions, {}),
      workDone,
      learn: collectPrefixed<Record<string, number>>(KEYS.learn, {}),
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

  async reset(): Promise<void> {
    store.resetAll();
  }
}
