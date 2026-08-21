# Slice 0 — Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave the repository with exactly one implementation of AISAR, and with every piece of persisted state reached through a swappable `Repository` interface rather than direct `localStorage` calls.

**Architecture:** The React app in `app/` becomes the sole implementation. All persistence moves behind an async, domain-shaped `Repository` interface with one implementation (`LocalRepository`, backed by `localStorage`). A React provider hydrates a `BusinessSnapshot` once and exposes it synchronously, so reads stay synchronous at call sites while writes become async. Domain modules (`business.ts`, `permissions.ts`, `country.ts`, `tools.ts`) become pure functions taking a snapshot instead of reaching into storage themselves. Slice 1 then adds a `RemoteRepository` without touching any consumer.

**Tech Stack:** TypeScript, React 19, Vite 8, React Router 8, Tailwind 4, Vitest (added by this plan), pnpm.

**Spec:** `docs/superpowers/specs/2026-08-21-backend-integration-design.md` — see §3 slice 0, §5 (the `Repository` abstraction), and §10 (testing approach).

## Global Constraints

- **Working directory for all `pnpm` commands is `app/`.** Repository-root paths in this plan are relative to `/Users/dr.noranizaahmad/ios/aisar-site`.
- **Code style** (from `CLAUDE.md`): two-space indent, semicolons, single quotes, camelCase.
- **Commits:** Conventional Commit subjects, one visible behaviour per commit.
- **Import alias:** `@/` resolves to `app/src/`. Both `@/lib/x` and relative `./x` forms exist in the codebase today; use `@/lib/x` in new files.
- **No behaviour changes in Tasks 1–5.** These tasks are a refactor. The characterization tests written in Task 1 must pass unchanged at the end of Task 5. If a test needs editing to pass, that is a defect in the refactor, not in the test.
- **`localStorage` keys must not change.** Existing users' state has to survive. The full list is `app/src/lib/storage.ts` `KEYS`, **plus `aisar-theme`**, which is defined locally in `app/src/hooks/useTheme.ts` and is absent from `KEYS`. Task 2 brings it into `KEYS`; the string value stays `'aisar-theme'`.
- **Work-done indices are strings.** `biz-engine.js` wrote `JSON.stringify(["0","2"])`. `business.ts` reads either format and writes strings. That tolerance must survive this refactor verbatim — see `isWorkDone` / `markWorkDone`.
- **Do not touch `worker/`.** Its risk table is wrong (spec §7.2) but correcting it belongs to slice 3.
- **Deletion happens last (Task 7).** `biz-engine.js` stays available as the reference implementation while the refactor is in progress.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `app/vitest.config.ts` | Test runner config, jsdom environment, `@/` alias |
| `app/src/lib/repo/types.ts` | `BusinessSnapshot` and `Repository` interface. Types only, no logic |
| `app/src/lib/repo/local.ts` | `LocalRepository` — the one implementation, over `localStorage` |
| `app/src/lib/repo/context.tsx` | `RepositoryProvider`, `useRepository()`, `useSnapshot()` |
| `app/src/lib/repo/index.ts` | Barrel re-export so consumers write one import |
| `app/src/lib/__tests__/characterization.test.ts` | Locks in current behaviour before the refactor |
| `app/src/lib/repo/__tests__/local.test.ts` | `LocalRepository` behaviour, including key names |
| `scripts/add-playbook.mjs` (rewritten) | Generator retargeted from `biz-engine.js` to `app/src/lib/data/playbooks.ts` |

**Modified:** `app/package.json` · `app/src/lib/storage.ts` · `app/src/lib/business.ts` · `app/src/lib/permissions.ts` · `app/src/lib/country.ts` · `app/src/lib/tools.ts` · `app/src/hooks/useTheme.ts` · `app/src/hooks/useBusiness.ts` · `app/src/i18n/I18nProvider.tsx` · `app/src/routes/Onboard.tsx` · `app/src/routes/Setup.tsx` · `app/src/routes/views/MyBusinessView.tsx` · `app/src/routes/views/ActivityView.tsx` · `app/src/App.tsx` · `_headers` · `CLAUDE.md` · `AGENTS.md` · `app/README.md` · `design-system/DESIGN-SYSTEM.md`

**Deleted (Task 7 only):** `index.html` · `onboard.html` · `setup.html` · `app.html` · `biz-engine.js` · `scripts/parity-audit.mjs`

**Left alone, deliberately:** `spec-minimart.json` (input fixture for the generator, still used), `_next/` (opaque upstream artifacts), `worker/`, `design-system/ink-and-strength.html` (the design system's rendered spec, moved there from the repository root before this plan ran).

---

## Task 1: Test infrastructure and characterization tests

Nothing in `app/` is currently tested — there is no test runner and no `test` script. Refactoring untested code is how behaviour gets lost silently, so the safety net comes first. These tests describe what the code does **today**, correct or not.

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Create: `app/src/lib/__tests__/characterization.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm test` runs the suite. Later tasks rely on this command existing and on `characterization.test.ts` passing unchanged.

- [ ] **Step 1: Install the test runner**

```bash
cd app
pnpm add -D vitest jsdom
```

- [ ] **Step 2: Add the test scripts**

In `app/package.json`, add two entries to `"scripts"` (keep the existing ones):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create the Vitest config**

Create `app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Write the characterization tests**

Create `app/src/lib/__tests__/characterization.test.ts`:

```ts
/* Describes what the storage-backed domain modules do TODAY, before the
   Repository refactor. These assertions must still hold at the end of
   Task 5. If one starts failing, the refactor changed behaviour. */

import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import {
  getBizType,
  getConnections,
  isConnected,
  isWorkDone,
  learn,
  markWorkDone,
  popular,
  registerBusiness,
  resolveBusiness,
  seedConnections,
  setBizType,
  toggleConnection,
} from '@/lib/business';
import { getCountryCode, setCountry } from '@/lib/country';
import { defaultPolicy, getPolicies, isCustomised, policyFor, setPolicy } from '@/lib/permissions';
import { listApprovals, pendingApprovals, queueApproval, riskOf } from '@/lib/tools';

beforeEach(() => {
  localStorage.clear();
});

describe('business type', () => {
  it('falls back to generic when unset', () => {
    expect(getBizType()).toBe('generic');
  });

  it('rejects a key that is not a playbook', () => {
    expect(setBizType('not-a-real-playbook')).toBe(false);
    expect(getBizType()).toBe('generic');
  });

  it('accepts a real playbook key and persists it', () => {
    expect(setBizType('restaurant')).toBe(true);
    expect(store.get(KEYS.bizType, '')).toBe('restaurant');
    expect(getBizType()).toBe('restaurant');
  });
});

describe('business profile overrides', () => {
  it('prefers the stored name over the playbook default', () => {
    setBizType('restaurant');
    const fromPlaybook = resolveBusiness('restaurant').name;
    store.set(KEYS.bizName, 'Warung Pak Din');
    expect(resolveBusiness('restaurant').name).toBe('Warung Pak Din');
    expect(resolveBusiness('restaurant').name).not.toBe(fromPlaybook);
  });

  it('prefers the stored location over the playbook default', () => {
    store.set(KEYS.bizLoc, 'Ipoh, Perak');
    expect(resolveBusiness('restaurant').loc).toBe('Ipoh, Perak');
  });
});

describe('registerBusiness', () => {
  it('infers a playbook from free text and persists the type', () => {
    const { key } = registerBusiness('saya ada restoran nasi kandar di Penang');
    expect(key).toBe('restaurant');
    expect(store.get(KEYS.bizType, '')).toBe('restaurant');
  });

  it('records the inference as a learning signal', () => {
    const { key } = registerBusiness('saya ada restoran nasi kandar di Penang');
    expect(popular(key)).toEqual({ pick: `inferred:${key}`, n: 1 });
  });
});

describe('connections', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getConnections()).toEqual([]);
  });

  it('seeds from the playbook only once', () => {
    seedConnections('restaurant');
    const seeded = getConnections();
    expect(seeded.length).toBeGreaterThan(0);

    toggleConnection(seeded[0]);
    seedConnections('restaurant');
    expect(getConnections()).not.toContain(seeded[0]);
  });

  it('toggles a connection on and off', () => {
    expect(isConnected('WhatsApp')).toBe(false);
    toggleConnection('WhatsApp');
    expect(isConnected('WhatsApp')).toBe(true);
    toggleConnection('WhatsApp');
    expect(isConnected('WhatsApp')).toBe(false);
  });
});

describe('work-done indices', () => {
  it('reads indices the engine wrote as strings', () => {
    store.setJSON(KEYS.workDone + 'restaurant', ['0', '2']);
    expect(isWorkDone('restaurant', 0)).toBe(true);
    expect(isWorkDone('restaurant', 2)).toBe(true);
    expect(isWorkDone('restaurant', 1)).toBe(false);
  });

  it('reads indices an older port wrote as numbers', () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0, 2]);
    expect(isWorkDone('restaurant', 0)).toBe(true);
    expect(isWorkDone('restaurant', 1)).toBe(false);
  });

  it('always writes strings, and does not duplicate', () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0]);
    markWorkDone('restaurant', 1);
    markWorkDone('restaurant', 1);
    expect(store.getJSON(KEYS.workDone + 'restaurant', [])).toEqual(['0', '1']);
  });
});

describe('learning counters', () => {
  it('counts repeated picks and reports the most popular', () => {
    learn('restaurant', 'a');
    learn('restaurant', 'b');
    learn('restaurant', 'b');
    expect(popular('restaurant')).toEqual({ pick: 'b', n: 2 });
  });

  it('returns null when nothing has been learned', () => {
    expect(popular('restaurant')).toBeNull();
  });
});

describe('country', () => {
  it('defaults to MY', () => {
    expect(getCountryCode()).toBe('MY');
  });

  it('rejects an unknown code', () => {
    expect(setCountry('ZZ')).toBe(false);
    expect(getCountryCode()).toBe('MY');
  });

  it('accepts a known code and persists it', () => {
    expect(setCountry('SG')).toBe(true);
    expect(getCountryCode()).toBe('SG');
  });
});

describe('permissions', () => {
  it('blocks pay and refund by default', () => {
    expect(defaultPolicy('pay')).toBe('blocked');
    expect(defaultPolicy('refund')).toBe('blocked');
  });

  it('automates read and list by default', () => {
    expect(defaultPolicy('read')).toBe('automatic');
    expect(defaultPolicy('list')).toBe('automatic');
  });

  it('returns every operation from getPolicies', () => {
    expect(Object.keys(getPolicies()).sort()).toEqual(
      ['book', 'cancel', 'export', 'list', 'pay', 'read', 'refund', 'send', 'update'].sort(),
    );
  });

  it('remembers an override and reports it as customised', () => {
    expect(isCustomised('send')).toBe(false);
    setPolicy('send', 'automatic');
    expect(policyFor('send')).toBe('automatic');
    expect(isCustomised('send')).toBe(true);
  });

  it('does not report a no-op override as customised', () => {
    setPolicy('send', defaultPolicy('send'));
    expect(isCustomised('send')).toBe(false);
  });
});

describe('tool risk and the approval queue', () => {
  it('maps ops to the risk tiers the server mirrors', () => {
    expect(riskOf('send')).toBe('high');
    expect(riskOf('book')).toBe('medium');
    expect(riskOf('read')).toBe('low');
  });

  it('defaults an unknown op to medium', () => {
    expect(riskOf('teleport')).toBe('medium');
  });

  it('queues an approval as pending and lists it', () => {
    queueApproval('WhatsApp', 'send', { to: '+60123' }, 'high');
    expect(listApprovals()).toHaveLength(1);
    expect(pendingApprovals()).toHaveLength(1);
    expect(pendingApprovals()[0].status).toBe('pending');
  });
});
```

- [ ] **Step 5: Run the tests and confirm they pass against current code**

```bash
cd app && pnpm test
```

Expected: all tests PASS. These describe existing behaviour, so failures here mean an assertion is wrong about the current code — read the source and correct the assertion, do not change the source.

If `registerBusiness('saya ada restoran nasi kandar di Penang')` does not infer `restaurant`, run this to find a phrase that does, and use it in the test:

```bash
cd app && node -e "
const {execSync}=require('child_process');" 2>/dev/null
grep -n '"restaurant"' -A 12 src/lib/data/playbooks.ts | grep -i keywords
```

- [ ] **Step 6: Confirm the typecheck and build still pass**

```bash
cd app && pnpm typecheck && pnpm build
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml app/vitest.config.ts app/src/lib/__tests__/characterization.test.ts
git commit -m "test: characterize the storage-backed domain modules

No test runner existed, and slice 0 refactors every one of these
modules. These assertions describe current behaviour so the refactor
can be proven not to change it."
```

---

## Task 2: The Repository interface and LocalRepository

**Files:**
- Create: `app/src/lib/repo/types.ts`
- Create: `app/src/lib/repo/local.ts`
- Create: `app/src/lib/repo/index.ts`
- Create: `app/src/lib/repo/__tests__/local.test.ts`
- Modify: `app/src/lib/storage.ts` (add the `theme` key)

**Interfaces:**
- Consumes: `app/src/lib/storage.ts` (`get`, `set`, `remove`, `getJSON`, `setJSON`, `resetAll`, `KEYS`); types `Approval`, `CountryCode`, `Lang`, `Policy` from `@/lib/types`.

**Break the `Policy` type cycle first.** `Policy` is declared in `permissions.ts` today. If
`repo/types.ts` imports it from there while `permissions.ts` imports `BusinessSnapshot` back
(Task 4), the two modules reference each other. Both are `import type` so TypeScript erases
them and it compiles, but it is a trap for the next person. **Step 0 below moves the
declaration to `@/lib/types`,** which neither module imports from circularly.

- [ ] **Step 0: Move the Policy type to the shared types module**

Cut this line from `app/src/lib/permissions.ts`:

```ts
export type Policy = 'automatic' | 'approval' | 'blocked';
```

Add it to `app/src/lib/types.ts`, then re-export from `permissions.ts` so existing importers
keep working:

```ts
export type { Policy } from './types';
```
- Produces:
  - `interface BusinessSnapshot` with fields: `onboarded: boolean`, `setupDone: boolean`, `bizType: string`, `bizName: string`, `bizLoc: string`, `channels: string[] | null`, `conns: string[]`, `country: CountryCode`, `lang: Lang`, `theme: 'dark' | 'light'`, `approvals: Approval[]`, `permissions: Record<string, Policy>`, `workDone: Record<string, string[]>`, `learn: Record<string, Record<string, number>>`.
  - `interface Repository` with: `load(): Promise<BusinessSnapshot>`, `setBizType(key: string): Promise<void>`, `setBizProfile(p: { name?: string; loc?: string }): Promise<void>`, `setOnboarded(v: boolean): Promise<void>`, `setSetupDone(v: boolean): Promise<void>`, `setChannels(ch: string[]): Promise<void>`, `setConnections(conns: string[]): Promise<void>`, `setCountry(code: CountryCode): Promise<void>`, `setLang(lang: Lang): Promise<void>`, `setTheme(theme: 'dark' | 'light'): Promise<void>`, `setPolicy(op: string, policy: Policy): Promise<void>`, `resetPolicies(): Promise<void>`, `queueApproval(a: Approval): Promise<void>`, `decideApproval(id: number, approved: boolean): Promise<void>`, `markWorkDone(playbookKey: string, index: number): Promise<void>`, `recordLearn(playbookKey: string, pick: string): Promise<void>`, `reset(): Promise<void>`.
  - `class LocalRepository implements Repository`.
  - Barrel `@/lib/repo` re-exporting all of the above.

- [ ] **Step 1: Bring the theme key into KEYS**

In `app/src/lib/storage.ts`, add one entry to the `KEYS` object, after `lang`:

```ts
  /** Was defined locally in useTheme.ts and missing from this list. */
  theme: 'aisar-theme',
```

- [ ] **Step 2: Write the failing test for LocalRepository**

Create `app/src/lib/repo/__tests__/local.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/repo/local';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';

function repo() {
  return new LocalRepository();
}

beforeEach(() => {
  localStorage.clear();
});

describe('load', () => {
  it('returns safe defaults on a first visit', async () => {
    const snap = await repo().load();
    expect(snap.onboarded).toBe(false);
    expect(snap.setupDone).toBe(false);
    expect(snap.bizType).toBe('');
    expect(snap.channels).toBeNull();
    expect(snap.conns).toEqual([]);
    expect(snap.country).toBe('MY');
    expect(snap.lang).toBe('en');
    expect(snap.theme).toBe('dark');
    expect(snap.approvals).toEqual([]);
    expect(snap.permissions).toEqual({});
    expect(snap.workDone).toEqual({});
    expect(snap.learn).toEqual({});
  });

  it('reads state a previous session wrote', async () => {
    store.set(KEYS.onboarded, '1');
    store.set(KEYS.bizType, 'restaurant');
    store.set(KEYS.bizName, 'Warung Pak Din');
    store.setJSON(KEYS.channels, ['WhatsApp']);
    const snap = await repo().load();
    expect(snap.onboarded).toBe(true);
    expect(snap.bizType).toBe('restaurant');
    expect(snap.bizName).toBe('Warung Pak Din');
    expect(snap.channels).toEqual(['WhatsApp']);
  });

  it('collects per-playbook work-done and learn keys into maps', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', ['0', '2']);
    store.setJSON(KEYS.workDone + 'clinic', ['1']);
    store.setJSON(KEYS.learn + 'restaurant', { 'inferred:restaurant': 3 });
    const snap = await repo().load();
    expect(snap.workDone).toEqual({ restaurant: ['0', '2'], clinic: ['1'] });
    expect(snap.learn).toEqual({ restaurant: { 'inferred:restaurant': 3 } });
  });

  it('normalises numeric work-done indices to strings', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0, 2]);
    const snap = await repo().load();
    expect(snap.workDone.restaurant).toEqual(['0', '2']);
  });
});

describe('writes land on the exact legacy keys', () => {
  it('setBizType', async () => {
    await repo().setBizType('clinic');
    expect(localStorage.getItem('aisar-biz-type')).toBe('clinic');
  });

  it('setOnboarded writes the string 1, and removes it when false', async () => {
    const r = repo();
    await r.setOnboarded(true);
    expect(localStorage.getItem('aisar-onboarded-v1')).toBe('1');
    await r.setOnboarded(false);
    expect(localStorage.getItem('aisar-onboarded-v1')).toBeNull();
  });

  it('setTheme uses the key useTheme.ts used', async () => {
    await repo().setTheme('light');
    expect(localStorage.getItem('aisar-theme')).toBe('light');
  });

  it('setConnections writes JSON', async () => {
    await repo().setConnections(['WhatsApp', 'Instagram']);
    expect(JSON.parse(localStorage.getItem('aisar-conns') ?? 'null')).toEqual([
      'WhatsApp',
      'Instagram',
    ]);
  });

  it('markWorkDone writes strings and does not duplicate', async () => {
    const r = repo();
    await r.markWorkDone('restaurant', 1);
    await r.markWorkDone('restaurant', 1);
    expect(JSON.parse(localStorage.getItem('aisar-work-done:restaurant') ?? 'null')).toEqual(['1']);
  });

  it('recordLearn increments a counter', async () => {
    const r = repo();
    await r.recordLearn('restaurant', 'a');
    await r.recordLearn('restaurant', 'a');
    expect(JSON.parse(localStorage.getItem('aisar-learn:restaurant') ?? 'null')).toEqual({ a: 2 });
  });
});

describe('approvals', () => {
  it('queues and then decides one', async () => {
    const r = repo();
    await r.queueApproval({
      id: 7,
      conn: 'WhatsApp',
      op: 'send',
      args: {},
      risk: 'high',
      ts: '2026-08-21T00:00:00.000Z',
      status: 'pending',
    });
    let snap = await r.load();
    expect(snap.approvals).toHaveLength(1);

    await r.decideApproval(7, true);
    snap = await r.load();
    expect(snap.approvals[0].status).toBe('approved');
    expect(snap.approvals[0].decided).toBeTruthy();
  });

  it('leaves other approvals untouched when deciding one', async () => {
    const r = repo();
    const base = { conn: 'WhatsApp', op: 'send', args: {}, risk: 'high' as const, ts: 'x', status: 'pending' as const };
    await r.queueApproval({ ...base, id: 1 });
    await r.queueApproval({ ...base, id: 2 });
    await r.decideApproval(1, false);
    const snap = await r.load();
    expect(snap.approvals.find((a) => a.id === 1)?.status).toBe('rejected');
    expect(snap.approvals.find((a) => a.id === 2)?.status).toBe('pending');
  });
});

describe('reset', () => {
  it('clears every aisar- key and leaves others alone', async () => {
    store.set(KEYS.bizType, 'restaurant');
    localStorage.setItem('unrelated', 'keep me');
    await repo().reset();
    expect(localStorage.getItem('aisar-biz-type')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && pnpm test src/lib/repo
```

Expected: FAIL — `Failed to resolve import "@/lib/repo/local"`.

- [ ] **Step 4: Write the types**

Create `app/src/lib/repo/types.ts`:

```ts
import type { Approval, CountryCode, Lang } from '@/lib/types';
import type { Policy } from '@/lib/permissions';

export type Theme = 'dark' | 'light';

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

  reset(): Promise<void>;
}
```

- [ ] **Step 5: Write LocalRepository**

Create `app/src/lib/repo/local.ts`:

```ts
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
```

- [ ] **Step 6: Write the barrel**

Create `app/src/lib/repo/index.ts`:

```ts
export type { BusinessSnapshot, Repository, Theme } from './types';
export { LocalRepository } from './local';
export { RepositoryProvider, useRepository, useSnapshot } from './context';
```

This exports `./context`, which Task 3 creates. Until then the barrel will not typecheck — that is expected, and Step 7 skips the barrel.

- [ ] **Step 7: Run the tests**

```bash
cd app && pnpm test src/lib/repo
```

Expected: PASS. Do **not** run `pnpm typecheck` yet — the barrel references `./context`, which lands in Task 3.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/repo app/src/lib/storage.ts
git commit -m "feat: add the Repository interface and its localStorage implementation

Domain-shaped and async, so slice 1 can add a network-backed
implementation without touching any consumer. Also brings aisar-theme
into KEYS — it was defined privately in useTheme.ts and missing from
the documented storage surface."
```

---

## Task 3: The provider and hooks

**Files:**
- Create: `app/src/lib/repo/context.tsx`
- Create: `app/src/lib/repo/__tests__/context.test.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `Repository`, `BusinessSnapshot`, `LocalRepository` from Task 2.
- Produces:
  - `<RepositoryProvider repository?: Repository>` — defaults to a new `LocalRepository`. Renders nothing until the first `load()` resolves.
  - `useRepository(): Repository` — for writes.
  - `useSnapshot(): BusinessSnapshot` — synchronous read of current state.
  - `useMutate(): (fn: (r: Repository) => Promise<void>) => Promise<void>` — runs a write then refreshes the snapshot. Every write in Tasks 4 and 5 goes through this.

- [ ] **Step 1: Install the React testing library**

```bash
cd app
pnpm add -D @testing-library/react @testing-library/dom
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/repo/__tests__/context.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { RepositoryProvider, useMutate, useSnapshot } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';

function Probe() {
  const snap = useSnapshot();
  const mutate = useMutate();
  return (
    <div>
      <span data-testid="type">{snap.bizType || 'none'}</span>
      <button onClick={() => void mutate((r) => r.setBizType('clinic'))}>set</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('RepositoryProvider', () => {
  it('exposes the loaded snapshot', async () => {
    localStorage.setItem('aisar-biz-type', 'restaurant');
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('restaurant'));
  });

  it('refreshes the snapshot after a write', async () => {
    render(
      <RepositoryProvider repository={new LocalRepository()}>
        <Probe />
      </RepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('none'));

    await act(async () => {
      screen.getByText('set').click();
    });

    await waitFor(() => expect(screen.getByTestId('type').textContent).toBe('clinic'));
  });
});

describe('useSnapshot outside a provider', () => {
  it('throws a message that names the fix', () => {
    function Bare() {
      useSnapshot();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/RepositoryProvider/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && pnpm test src/lib/repo/__tests__/context
```

Expected: FAIL — `Failed to resolve import "@/lib/repo/context"`.

- [ ] **Step 4: Write the provider**

Create `app/src/lib/repo/context.tsx`:

```tsx
/* ============================================================
   Repository access for components.

   The snapshot is loaded once and held in state, so reads stay
   synchronous at every call site. Writes go through useMutate,
   which refreshes the snapshot afterwards.
   ============================================================ */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LocalRepository } from './local';
import type { BusinessSnapshot, Repository } from './types';

interface Ctx {
  repository: Repository;
  snapshot: BusinessSnapshot;
  refresh: () => Promise<void>;
}

const RepoContext = createContext<Ctx | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository?: Repository;
  children: ReactNode;
}) {
  const repo = useMemo(() => repository ?? new LocalRepository(), [repository]);
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setSnapshot(await repo.load());
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => (snapshot ? { repository: repo, snapshot, refresh } : null),
    [repo, snapshot, refresh],
  );

  /* Nothing renders until state exists. Every consumer may then assume
     a snapshot, which is what keeps reads synchronous. */
  if (!value) return null;

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

function useCtx(): Ctx {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useSnapshot/useRepository require a <RepositoryProvider> above them.');
  }
  return ctx;
}

export function useRepository(): Repository {
  return useCtx().repository;
}

export function useSnapshot(): BusinessSnapshot {
  return useCtx().snapshot;
}

/** Run a write, then refresh the snapshot so the UI reflects it. */
export function useMutate(): (fn: (r: Repository) => Promise<void>) => Promise<void> {
  const { repository, refresh } = useCtx();
  return useCallback(
    async (fn) => {
      await fn(repository);
      await refresh();
    },
    [repository, refresh],
  );
}
```

- [ ] **Step 5: Add useMutate to the barrel**

In `app/src/lib/repo/index.ts`, replace the context export line with:

```ts
export { RepositoryProvider, useMutate, useRepository, useSnapshot } from './context';
```

- [ ] **Step 6: Run the tests**

```bash
cd app && pnpm test
```

Expected: all PASS, including Task 1's characterization tests.

- [ ] **Step 7: Mount the provider**

In `app/src/App.tsx`, import `RepositoryProvider` from `@/lib/repo` and wrap the existing top-level element tree with it — outside the router, so every route sees a hydrated snapshot. Do not change any other JSX.

- [ ] **Step 8: Verify the app still runs**

```bash
cd app && pnpm typecheck && pnpm build
```

Expected: both succeed. Then `pnpm dev`, open `http://localhost:5173`, and confirm the landing page, `/onboard`, and `/app` all still render.

- [ ] **Step 9: Commit**

```bash
git add app/package.json app/pnpm-lock.yaml app/src/lib/repo app/src/App.tsx
git commit -m "feat: provide the repository through React context

Snapshot hydrates once and lives in state, so reads stay synchronous
and only writes become async. useMutate refreshes after each write."
```

---

## Task 4: Make the domain modules pure

Each module currently reads `localStorage` internally. Each becomes a set of pure functions taking the snapshot. The characterization tests from Task 1 are updated in this task — the *only* task where that is allowed — because the function signatures change. Their assertions must not.

**Files:**
- Modify: `app/src/lib/business.ts`, `app/src/lib/permissions.ts`, `app/src/lib/country.ts`, `app/src/lib/tools.ts`
- Modify: `app/src/lib/__tests__/characterization.test.ts`

**Interfaces:**
- Consumes: `BusinessSnapshot` from Task 2.
- Produces — every function below takes `snap: BusinessSnapshot` as its **first** parameter, and no function writes:
  - `business.ts`: `getBizType(snap)`, `resolveBusiness(snap, key)`, `getChannels(snap)`, `getConnections(snap)`, `isConnected(snap, name)`, `isAgentReady(snap, t)`, `isWorkDone(snap, key, i)`, `isOnboarded(snap)`, `isSetupDone(snap)`, `bumpPotential(snap, v)`, `popular(snap, key)`. Unchanged and still pure: `isPlaybookKey(key)`, `confirmFor(key, text)`, `recommendations(b)`.
  - `business.ts` gains two planners that return the writes a caller should apply, rather than performing them:
    - `planRegisterBusiness(text): { key: string; score: number; bizName: string; bizLoc: string | null; learnPick: string }`
    - `planSeedConnections(snap, key): string[] | null` — `null` when connections are already set.
    - `planToggleConnection(snap, name): string[]` — the connection list after toggling one name. Used by `MyBusinessView.tsx` in Task 5.
  - `permissions.ts`: `getPolicies(snap)`, `policyFor(snap, op)`, `isCustomised(snap, op)`. Unchanged: `defaultPolicy(op)`, `OPERATIONS`, `Policy`.
  - `country.ts`: `getCountryCode(snap)`, `getCountry(snap)`, `cityList(snap)`, `localizeSite(snap, p)`, `localizeDetect(snap, p)`, `localizeKeywords(snap, p)`, `localizeChannels(snap, ch)`. Unchanged: `isCountryCode(v)`, `DEFAULT_COUNTRY`. **`setCountry` is deleted** — callers use `repo.setCountry` and validate with `isCountryCode`.
  - `tools.ts`: `callTool(snap, req)` returns the same `ToolResult` union; when it would queue, the caller performs the write. `listApprovals(snap)`, `pendingApprovals(snap)`. **`queueApproval` and `decideApproval` are deleted** from this module — they live on the repository now. Unchanged: `findConnector(nameOrKey)`, `riskOf(op)`.

- [ ] **Step 1: Convert `permissions.ts`**

Delete the `store`/`KEYS` imports and `setPolicy`/`resetPolicies`. Change the three readers to take the snapshot:

```ts
export function getPolicies(snap: BusinessSnapshot): Record<string, Policy> {
  const out: Record<string, Policy> = {};
  for (const op of OPERATIONS) out[op] = snap.permissions[op] ?? DEFAULTS[op];
  return out;
}

export function policyFor(snap: BusinessSnapshot, op: string): Policy {
  return snap.permissions[op] ?? defaultPolicy(op);
}

export function isCustomised(snap: BusinessSnapshot, op: string): boolean {
  return op in snap.permissions && snap.permissions[op] !== defaultPolicy(op);
}
```

Add `import type { BusinessSnapshot } from '@/lib/repo/types';` at the top. Import from `repo/types`, not the barrel, to avoid a cycle.

- [ ] **Step 2: Convert `country.ts`**

Replace `store.get(KEYS.country, DEFAULT_COUNTRY)` with the snapshot, and thread it through every localiser:

```ts
export function getCountryCode(snap: BusinessSnapshot): CountryCode {
  return isCountryCode(snap.country) ? snap.country : DEFAULT_COUNTRY;
}

export function getCountry(snap: BusinessSnapshot): Country {
  return COUNTRIES[getCountryCode(snap)];
}
```

`cityList`, `localizeSite`, `localizeDetect`, `localizeKeywords`, and `localizeChannels` each gain `snap` as their first parameter and call `getCountry(snap)` / `getCountryCode(snap)` internally. Their bodies are otherwise unchanged. Delete `setCountry` and the `store`/`KEYS` imports.

- [ ] **Step 3: Convert `business.ts` readers**

Thread `snap` through. The bodies change only where they read storage:

```ts
export function getBizType(snap: BusinessSnapshot): string {
  return isPlaybookKey(snap.bizType) ? snap.bizType : FALLBACK_KEY;
}

export function resolveBusiness(snap: BusinessSnapshot, key: string): Business {
  const k = isPlaybookKey(key) ? key : FALLBACK_KEY;
  const p = PLAYBOOKS[k];
  const country = getCountry(snap);

  const name = snap.bizName || p.name;
  const loc =
    snap.bizLoc || (country.code !== 'MY' && p.loc ? country.name : p.loc || country.name);

  return {
    icon: p.icon, name, type: p.type, sub: p.sub,
    site: localizeSite(snap, p),
    loc, booking: p.booking, systems: p.systems, potential: p.potential,
    opportunities: p.opportunities, ch: [...p.ch],
    detect: localizeDetect(snap, p),
    confirm: p.confirm, funcs: p.funcs, stats: p.stats, sug: p.sug,
    team: p.team, work: p.work, conns: p.conns,
  };
}

export function isSetupDone(snap: BusinessSnapshot): boolean {
  return snap.setupDone;
}

export function isOnboarded(snap: BusinessSnapshot): boolean {
  return snap.onboarded;
}

export function bumpPotential(snap: BusinessSnapshot, v: number): number {
  return snap.setupDone ? Math.min(96, v + 20) : v;
}

export function getChannels(snap: BusinessSnapshot): string[] | null {
  return snap.channels;
}

export function getConnections(snap: BusinessSnapshot): string[] {
  return snap.conns;
}

export function isConnected(snap: BusinessSnapshot, name: string): boolean {
  return snap.conns.includes(name);
}

export function isAgentReady(snap: BusinessSnapshot, t: { setup?: boolean; ch?: string }): boolean {
  if (t.setup) return isConnected(snap, 'Accounting');
  const ch = String(t.ch ?? '').toLowerCase();
  const keys = snap.conns;
  return keys.some((cn) => ch.includes(cn.split(' ')[0].toLowerCase())) || keys.length > 0;
}

export function isWorkDone(snap: BusinessSnapshot, key: string, i: number): boolean {
  return (snap.workDone[key] ?? []).some((v) => String(v) === String(i));
}

export function popular(snap: BusinessSnapshot, key: string): { pick: string; n: number } | null {
  const obj = snap.learn[key] ?? {};
  let best: string | null = null;
  let bestN = 0;
  for (const [pick, n] of Object.entries(obj)) {
    if (n > bestN) { bestN = n; best = pick; }
  }
  return best !== null ? { pick: best, n: bestN } : null;
}
```

- [ ] **Step 4: Replace the writers in `business.ts` with planners**

Delete `setBizType`, `registerBusiness`, `seedConnections`, `toggleConnection`, `markWorkDone`, and `learn`. Add:

```ts
/** Free text in, the writes a caller should apply out. Performs none of them. */
export function planRegisterBusiness(text: string): {
  key: string;
  score: number;
  bizName: string;
  bizLoc: string | null;
  learnPick: string;
} {
  const { key, score } = inferPlaybook(text);
  return {
    key,
    score,
    bizName: extractName(text, PLAYBOOKS[key].name),
    bizLoc: extractLocation(text),
    learnPick: `inferred:${key}`,
  };
}

/** The playbook's default connections, or null when the owner already has some. */
export function planSeedConnections(snap: BusinessSnapshot, key: string): string[] | null {
  if (snap.conns.length > 0) return null;
  return resolveBusiness(snap, key)
    .conns.filter((c) => c.on)
    .map((c) => c.n);
}

/** The connection list after toggling one name. Caller persists it. */
export function planToggleConnection(snap: BusinessSnapshot, name: string): string[] {
  const a = [...snap.conns];
  const i = a.indexOf(name);
  if (i >= 0) a.splice(i, 1);
  else a.push(name);
  return a;
}
```

`seedConnections` previously used `store.isUnset(KEYS.conns)` — never-written, distinct from empty. The snapshot flattens that to an empty array, so `planSeedConnections` keys off `conns.length > 0` instead. The observable difference is that a user who deliberately turned off *every* connection gets them re-seeded. Accept it: the alternative is carrying an `isUnset` flag through the snapshot and into the eventual server schema for one edge case, and slice 1 replaces this seeding with server-side defaults anyway. Note it in the commit message.

- [ ] **Step 5: Convert `tools.ts`**

`callTool` takes the snapshot and no longer writes. Replace the queueing branch:

```ts
export function callTool(snap: BusinessSnapshot, req: ToolRequest): ToolResult {
  const cx = findConnector(req.conn);
  if (!cx) return { ok: false, err: `unknown connector: ${req.conn}` };

  if (!isConnected(snap, cx.n)) {
    return { ok: false, need: 'connect', conn: cx.n, msg: `Connect ${cx.n} first, in Connections.` };
  }

  const risk = riskOf(req.op);
  const args = req.args ?? {};
  const policy = policyFor(snap, req.op);

  if (policy === 'blocked') {
    return {
      ok: false, blocked: true, op: req.op,
      msg: `"${req.op}" is blocked in your permissions. Enable it in My Business to allow this.`,
    };
  }

  if (req.dryRun ?? policy === 'approval') {
    return {
      ok: true, dryRun: true,
      would: `${cx.n} → ${req.op} ${JSON.stringify(args)}`,
      risk,
      queued: {
        id: Date.now(),
        conn: cx.n,
        op: req.op,
        args,
        risk,
        ts: new Date().toISOString(),
        status: 'pending',
      },
    };
  }

  return { ok: true, mock: true, msg: `${cx.n} → ${req.op} OK (mock — no backend executor yet).` };
}

export function listApprovals(snap: BusinessSnapshot): Approval[] {
  return snap.approvals;
}

export function pendingApprovals(snap: BusinessSnapshot): Approval[] {
  return snap.approvals.filter((a) => a.status === 'pending');
}
```

`queued` is now a described approval, not a persisted one. The caller passes it to `repo.queueApproval`. Delete `queueApproval` and `decideApproval` from this file, plus the `store`/`KEYS` imports.

- [ ] **Step 6: Update the characterization tests to the new signatures**

Every assertion stays. Only the calls change: build a snapshot, pass it in, and for the former writers assert on the planner's return value. Add this helper at the top of `characterization.test.ts` and use it throughout:

```ts
import { LocalRepository } from '@/lib/repo/local';
import type { BusinessSnapshot } from '@/lib/repo/types';

const repo = new LocalRepository();
const snap = (): Promise<BusinessSnapshot> => repo.load();
```

For example, the work-done test becomes:

```ts
it('reads indices the engine wrote as strings', async () => {
  store.setJSON(KEYS.workDone + 'restaurant', ['0', '2']);
  const s = await snap();
  expect(isWorkDone(s, 'restaurant', 0)).toBe(true);
  expect(isWorkDone(s, 'restaurant', 2)).toBe(true);
  expect(isWorkDone(s, 'restaurant', 1)).toBe(false);
});
```

and the `registerBusiness` tests become assertions on `planRegisterBusiness`:

```ts
it('infers a playbook from free text', () => {
  const plan = planRegisterBusiness('saya ada restoran nasi kandar di Penang');
  expect(plan.key).toBe('restaurant');
  expect(plan.learnPick).toBe('inferred:restaurant');
});
```

The `setBizType` validation tests move to asserting `isPlaybookKey('not-a-real-playbook') === false`, since validation is now the caller's job.

- [ ] **Step 7: Run the tests**

```bash
cd app && pnpm test
```

Expected: PASS. The app will not typecheck yet — the call sites still use the old signatures. That is Task 5.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib
git commit -m "refactor: make the domain modules pure functions over a snapshot

business, permissions, country and tools no longer read localStorage.
Each takes a BusinessSnapshot and returns a value; writers become
planners that describe the write for a caller to apply.

One behaviour change, deliberate: seeding connections keyed off
'never written' before and keys off 'empty' now, so an owner who
turned every connection off gets the playbook defaults back. Carrying
an isUnset flag into the server schema for that edge case is not
worth it, and slice 1 replaces this seeding with server defaults."
```

---

## Task 5: Convert the call sites

**Files:**
- Modify: `app/src/hooks/useTheme.ts`, `app/src/hooks/useBusiness.ts`, `app/src/i18n/I18nProvider.tsx`, `app/src/routes/Onboard.tsx`, `app/src/routes/Setup.tsx`, `app/src/routes/views/MyBusinessView.tsx`, `app/src/routes/views/ActivityView.tsx`

**Interfaces:**
- Consumes: `useSnapshot()`, `useMutate()` from Task 3; the pure functions from Task 4.
- Produces: no module outside `app/src/lib/repo/` imports `@/lib/storage` or touches `localStorage`. Task 6 does not depend on this; Task 7's grep gate does.

- [ ] **Step 1: Convert `useTheme.ts`**

```ts
import { useCallback, useEffect } from 'react';
import { useMutate, useSnapshot } from '@/lib/repo';
import type { Theme } from '@/lib/repo';

export type { Theme };

export function useTheme() {
  const { theme } = useSnapshot();
  const mutate = useMutate();

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => void mutate((r) => r.setTheme(next)),
    [mutate],
  );

  const toggleTheme = useCallback(
    () => void mutate((r) => r.setTheme(theme === 'dark' ? 'light' : 'dark')),
    [mutate, theme],
  );

  return { theme, setTheme, toggleTheme };
}
```

- [ ] **Step 2: Convert the remaining six files**

Apply the same three substitutions in each:

| Old | New |
|---|---|
| `store.get(KEYS.x, d)` / `store.getJSON(KEYS.x, d)` | read the field off `useSnapshot()` |
| `store.set(KEYS.x, v)` / `store.setJSON(KEYS.x, v)` | `void mutate((r) => r.setX(v))` |
| `fn(args)` on a converted domain function | `fn(snap, args)` |

Then delete the now-unused `import * as store` and `import { KEYS }` lines from each file.

Specific notes:
- **`I18nProvider.tsx`** reads and writes `KEYS.lang`. Read `snapshot.lang`; write via `r.setLang`. It sits *inside* `RepositoryProvider`, so `useSnapshot()` is available.
- **`Onboard.tsx`** is the heaviest. It calls the former `registerBusiness` and `seedConnections`. Replace with `planRegisterBusiness(text)` followed by one `mutate` that applies every write in order: `setBizType`, `setBizProfile`, `recordLearn`, then `setConnections(planSeedConnections(...) ?? snap.conns)`. Keep them inside a single `mutate` call so the snapshot refreshes once, not five times.
- **`Setup.tsx`** writes `KEYS.setupDone` → `r.setSetupDone(true)`.
- **`MyBusinessView.tsx`** uses connections and permissions. `toggleConnection(name)` becomes `void mutate((r) => r.setConnections(planToggleConnection(snap, name)))`; `setPolicy(op, p)` becomes `void mutate((r) => r.setPolicy(op, p))`.
- **`ActivityView.tsx`** calls the deleted `decideApproval` from `tools.ts`. Use `void mutate((r) => r.decideApproval(id, approved))`. Leave the existing `decideApprovalRemote` branch from `@/lib/api` exactly as it is — slice 1 replaces it.
- **`useBusiness.ts`** calls `resolveBusiness`, `getBizType`, and friends. Thread `useSnapshot()` in. Leave the `isRemote()` / `listApprovalsRemote` branch alone.

- [ ] **Step 3: Verify no storage access remains outside the repo module**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
grep -rn "localStorage" app/src | grep -v "app/src/lib/repo/" | grep -v "__tests__" | grep -v "app/src/lib/storage.ts"
grep -rn "lib/storage\|from './storage'" app/src | grep -v "app/src/lib/repo/" | grep -v "__tests__"
```

Expected: both print nothing. `app/src/lib/api.ts` line 5 mentions `localStorage` inside a comment and will not match the first grep; if it does, the grep is wrong, not the code.

- [ ] **Step 4: Typecheck, test, build**

```bash
cd app && pnpm typecheck && pnpm test && pnpm build
```

Expected: all three succeed.

- [ ] **Step 5: Manually verify the flows still work**

```bash
cd app && pnpm dev
```

In the browser at `http://localhost:5173`, with devtools open on Application → Local Storage, confirm each of these:

1. Landing page renders; `/app` redirects to `/onboard` on a cleared store.
2. Complete onboarding with free text describing a restaurant. `aisar-biz-type` becomes `restaurant`; `aisar-biz-name` and `aisar-conns` are written.
3. `/setup` completes and writes `aisar-setup-done-v1` = `1`.
4. Dashboard renders; the light/dark toggle writes `aisar-theme`.
5. Language toggle writes `aisar-lang`.
6. My Business → toggle a connection; `aisar-conns` updates.
7. My Business → change a permission; `aisar-permissions` updates.
8. Trigger an action that queues an approval; it appears in Activity, and approving it updates `aisar-approvals`.
9. Reload the page. Every one of the above survives.

- [ ] **Step 6: Commit**

```bash
git add app/src
git commit -m "refactor: route every call site through the repository

No component or hook touches localStorage now. Reads come from the
hydrated snapshot, writes go through useMutate. Slice 1 swaps in
RemoteRepository without any of these files changing."
```

---

## Task 6: Port the playbook generator to the React data files

`scripts/add-playbook.mjs` writes into `biz-engine.js`, `app.html`, and `onboard.html`. Task 7 deletes all three. The extraction from the engine into `app/src/lib/data/` was a one-off with no script in the repo, so without this task, deleting the engine ends the ability to add an industry — the property `CLAUDE.md` describes as the core of the design.

**Files:**
- Modify: `scripts/add-playbook.mjs`
- Test: manual, using the existing `spec-minimart.json`

**Interfaces:**
- Consumes: `spec-minimart.json` shape (`key`, `keywords`, and the playbook fields).
- Produces: `node scripts/add-playbook.mjs --file spec.json` inserts into `app/src/lib/data/playbooks.ts` before the `"generic"` entry, and no longer touches any HTML file.

- [ ] **Step 1: Record the current playbook count**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
node -e "
const s=require('fs').readFileSync('app/src/lib/data/playbooks.ts','utf8');
console.log('entries:', (s.match(/^  \"[a-z_]+\": \{/gm)||[]).length);
"
```

Note the number. Step 6 checks it went up by exactly one.

- [ ] **Step 2: Retarget the injection**

In `scripts/add-playbook.mjs`:

- Change `enginePath` (line ~209) from `path.join(repo, 'biz-engine.js')` to `path.join(repo, 'app', 'src', 'lib', 'data', 'playbooks.ts')`.
- The anchor changes. The engine used a JS object literal; `playbooks.ts` uses **JSON-style double-quoted keys and two-space indent**. The new entry is inserted before the line matching `/^  "generic": \{/m` and must be serialised as `JSON.stringify(entry, null, 2)` re-indented by two spaces, with the key quoted: `  "${key}": { … },`.
- Delete the `injectUI` function entirely (lines ~165–195) and both `jsCheckHtml` calls (lines ~243–245). The demo chip in `app.html` and the type pill in `onboard.html` have no destination any more.
- Replace the syntax check: instead of `new Function(...)` over extracted JS, run `npx tsc --noEmit` against the app.

- [ ] **Step 3: Replace the validation step**

The script asserts that every keyword infers back to the new key. That check must now run against the TypeScript data. Replace the engine-eval approach with a spawn of the app's own inference:

```js
/* Verify every keyword infers back to the new playbook, using the app's
   own inferPlaybook rather than a second copy of the logic. */
function verifyKeywords(key, keywords) {
  const probe = `
    import { inferPlaybook } from './app/src/lib/infer.ts';
    const bad = ${JSON.stringify(keywords)}.filter((k) => inferPlaybook(k).key !== ${JSON.stringify(key)});
    if (bad.length) { console.error('keywords did not infer back: ' + bad.join(', ')); process.exit(1); }
    console.log('all keywords infer to ${key}');
  `;
  fs.writeFileSync('.verify-playbook.mts', probe);
  try {
    execSync('npx vite-node .verify-playbook.mts', { cwd: repo, stdio: 'inherit' });
  } finally {
    fs.unlinkSync(path.join(repo, '.verify-playbook.mts'));
  }
}
```

Add `import { execSync } from 'node:child_process';` at the top. `vite-node` ships with Vitest, installed in Task 1, so run it from `app/` or via `npx --prefix app`.

- [ ] **Step 4: Update the script's own help text**

Any string mentioning `biz-engine.js`, `app.html`, or `onboard.html` becomes `app/src/lib/data/playbooks.ts`. The messages are in Malay; keep them in Malay to match the file.

- [ ] **Step 5: Run the generator against the existing fixture**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
git stash list > /dev/null   # noop, just confirming a clean tree first
git status --short
node scripts/add-playbook.mjs --file spec-minimart.json
```

Expected: it reports the playbook added and every keyword inferring back. If `minimart` already exists in `playbooks.ts`, the script should say so and exit non-zero — that is correct behaviour, and you should test with a modified copy of the fixture using a new key instead.

- [ ] **Step 6: Verify the result**

```bash
cd app && pnpm typecheck && pnpm test
cd .. && node -e "
const s=require('fs').readFileSync('app/src/lib/data/playbooks.ts','utf8');
console.log('entries:', (s.match(/^  \"[a-z_]+\": \{/gm)||[]).length);
"
```

Expected: typecheck and tests pass, and the entry count is exactly one higher than Step 1.

- [ ] **Step 7: Revert the test insertion**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
git checkout app/src/lib/data/playbooks.ts
```

- [ ] **Step 8: Commit**

```bash
git add scripts/add-playbook.mjs
git commit -m "build: retarget the playbook generator at the React data files

biz-engine.js is about to be deleted and the extraction into
app/src/lib/data was a one-off with no script in the repo, so without
this the ability to add an industry would go with it. The HTML
injection is dropped — app.html and onboard.html have no destination
any more — and keyword verification now runs against the app's own
inferPlaybook rather than a second copy of the logic."
```

---

## Task 7: Retire the static implementation

Last, so the reference implementation stayed available throughout.

**Files:**
- Delete: `index.html`, `onboard.html`, `setup.html`, `app.html`, `biz-engine.js`, `scripts/parity-audit.mjs`
- Modify: `_headers`, `CLAUDE.md`, `AGENTS.md`, `app/README.md`, `design-system/DESIGN-SYSTEM.md`

**Interfaces:**
- Consumes: Task 6's retargeted generator.
- Produces: one implementation in the repository.

- [ ] **Step 1: Confirm nothing still needs them**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
grep -rln "biz-engine\|onboard\.html\|app\.html\|setup\.html\|parity-audit" \
  --include="*.md" --include="*.sh" --include="*.mjs" --include="*.json" --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v "^./_next" | grep -v "^./docs/superpowers"
```

Expected, after Task 6: `CLAUDE.md`, `AGENTS.md`, `app/README.md`, `design-system/DESIGN-SYSTEM.md`, and `deploy.sh`. **`scripts/add-playbook.mjs` must not appear.** If it does, Task 6 is incomplete — stop and finish it.

`deploy.sh` appears only because its verify loop probes the paths `/onboard`, `/setup`, and `/app`. Those are React routes now and the probe stays correct. Leave `deploy.sh` alone.

- [ ] **Step 2: Delete the files**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
git rm index.html onboard.html setup.html app.html biz-engine.js scripts/parity-audit.mjs
```

- [ ] **Step 3: Rewrite `_headers`**

The current file names `/app.html`, `/index.html`, and `/biz-engine.js`, none of which exist now. Vite emits content-hashed assets, so those get a long immutable cache and the SPA shell must not be cached. Replace the whole file with:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/*
  Cache-Control: no-cache, no-store, must-revalidate
```

Order matters — Cloudflare Pages applies the first matching rule, so `/assets/*` has to come first. The immutable rule on `/assets/*` is what `deploy.sh`'s `stale-edge` diagnostic refers to; leaving that comment in `deploy.sh` accurate is why the rule keeps the same shape.

- [ ] **Step 4: Update `CLAUDE.md`**

Delete the entire `## Two implementations, mid-consolidation` section, including the deletion notice added on 2026-08-21 and the table. Delete the `## Static site` section (its `wrangler pages dev .` command, page-flow diagram, `### biz-engine.js` subsection, `### The button-CSS override` subsection, and `### Caching` subsection). In `## Adding a playbook`, remove the sentence about demo chips and type pills being injected into `app.html`/`onboard.html`, and the warning about moving the `generic` anchors, replacing them with a note that the generator writes `app/src/lib/data/playbooks.ts`. In `## Gotchas`, delete the bullet about `biz-engine.js` referencing a missing strategy document.

Keep: the React rebuild section, the localStorage keys table, `## Backend (worker/)`, `## Conventions`, and the `_next/` gotcha.

- [ ] **Step 5: Update `AGENTS.md`, `app/README.md`, and `design-system/DESIGN-SYSTEM.md`**

```bash
grep -n "biz-engine\|onboard.html\|app.html\|setup.html\|parity" AGENTS.md app/README.md design-system/DESIGN-SYSTEM.md
```

In each hit, replace the reference with its React equivalent (`biz-engine.js` → `app/src/lib/data/`) or delete the line if it described only the static site. In `app/README.md`, the line "It was extracted by evaluating `biz-engine.js` in Node… re-extract rather than hand-merging" is now false — replace it with a pointer to `scripts/add-playbook.mjs` as the way playbooks are added.

- [ ] **Step 6: Nothing to do — `spec.html` is already handled**

It turned out to be the design system's own rendered specification, not an orphan, and it
was moved to `design-system/ink-and-strength.html` on 2026-08-21 before this plan ran. No
action here. If it is still at the repository root, the move was reverted — stop and ask.

- [ ] **Step 7: Verify the build and the full suite**

```bash
cd app && pnpm typecheck && pnpm test && pnpm build
```

Expected: all three succeed. The build must not reference any deleted file.

- [ ] **Step 8: Verify the deploy script still works end to end**

```bash
cd /Users/dr.noranizaahmad/ios/aisar-site
AISAR_PAGES_PROJECT=aisar-next ./deploy.sh "chore: verify slice 0 build"
```

Expected: publishes to the preview project and all four route probes return HTTP 200. **Deploy to `aisar-next` (preview), not the default `aisar-jentera`.**

**The apex is deliberately not part of this slice.** Spec §3 slice 0 originally read "Apex
to React build"; the repository owner deferred that on 2026-08-21. `aisar.ai` is a separate
Pages project (`aisar`) still serving the static site, and flipping it is an outward-facing
release decision independent of this refactor.

**Do not deploy to `aisar` or to `aisar-jentera` in this slice.** Preview only. Slice 1 does
not depend on the apex, and `deploy.sh` already knows the `aisar` project when the owner
decides to make the switch.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: delete the static implementation

The React app in app/ is now the only implementation. Removes
index/onboard/setup/app.html, biz-engine.js, and the parity audit that
existed to keep the two copies in step.

_headers is rewritten for a Vite SPA: content-hashed assets immutable,
everything else uncacheable. The old file named app.html, index.html
and biz-engine.js, none of which exist now.

spec.html is left in place — it is referenced by nothing and is not
part of the static product flow, so removing it is a separate call."
```

---

## Verification: slice 0 is done when

- [ ] `cd app && pnpm typecheck && pnpm test && pnpm build` all pass.
- [ ] `grep -rn "localStorage" app/src | grep -v "app/src/lib/repo/" | grep -v __tests__ | grep -v storage.ts` prints nothing.
- [ ] `ls index.html onboard.html setup.html app.html biz-engine.js scripts/parity-audit.mjs 2>&1` reports every one missing.
- [ ] `node scripts/add-playbook.mjs --file <a new spec>` adds a playbook to `app/src/lib/data/playbooks.ts` and the app still typechecks.
- [ ] A preview deploy serves `/`, `/onboard`, `/setup`, and `/app` at HTTP 200.
- [ ] A browser session that had AISAR state before the change still has its business type, connections, approvals, and completed work after it.
- [ ] Adding a second `Repository` implementation would require changing **no** file outside `app/src/lib/repo/`.

The last item is the one that matters. Everything else is cleanup; that is the property slice 1 depends on.
