/* Describes what the domain modules (business/country/permissions/tools)
   do — characterized before the Repository refactor (Task 1) and carried
   forward across it (Task 4). Task 4 changed every function's call shape:
   a BusinessSnapshot comes in first, and nothing writes any more. Every
   assertion below still proves the same behaviour as before the change.
   If an assertion doesn't compile under the new signatures, change how
   the function is called — build a snapshot, seed storage directly where
   a deleted writer used to run the setup — never what it asserts.
   Weakening an assertion to make this file compile means the refactor
   changed behaviour and nobody is testing for it any more. */

import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import { LocalRepository } from '@/lib/repo/local';
import type { BusinessSnapshot } from '@/lib/repo/types';
import {
  bumpPotential,
  confirmFor,
  getBizType,
  getChannels,
  getConnections,
  isAgentReady,
  isConnected,
  isOnboarded,
  isPlaybookKey,
  isSetupDone,
  isWorkDone,
  planRegisterBusiness,
  planSeedConnections,
  planToggleConnection,
  popular,
  resolveBusiness,
} from '@/lib/business';
import {
  cityList,
  getCountryCode,
  isCountryCode,
  localizeChannels,
  localizeDetect,
  localizeKeywords,
  localizeSite,
} from '@/lib/country';
import { defaultPolicy, getPolicies, isCustomised, policyFor } from '@/lib/permissions';
import { callTool, listApprovals, pendingApprovals, riskOf } from '@/lib/tools';

const repo = new LocalRepository();
const snap = (): Promise<BusinessSnapshot> => repo.load();

beforeEach(() => {
  localStorage.clear();
});

describe('business type', () => {
  it('falls back to generic when unset', async () => {
    expect(getBizType(await snap())).toBe('generic');
  });

  it('rejects a key that is not a playbook', () => {
    expect(isPlaybookKey('not-a-real-playbook')).toBe(false);
  });

  it('recognizes a real playbook key and reads back what is stored', async () => {
    expect(isPlaybookKey('restaurant')).toBe(true);
    store.set(KEYS.bizType, 'restaurant');
    expect(getBizType(await snap())).toBe('restaurant');
  });
});

describe('business profile overrides', () => {
  it('prefers the stored name over the playbook default', async () => {
    const fromPlaybook = resolveBusiness(await snap(), 'restaurant').name;
    store.set(KEYS.bizName, 'Warung Pak Din');
    const s = await snap();
    expect(resolveBusiness(s, 'restaurant').name).toBe('Warung Pak Din');
    expect(resolveBusiness(s, 'restaurant').name).not.toBe(fromPlaybook);
  });

  it('prefers the stored location over the playbook default', async () => {
    store.set(KEYS.bizLoc, 'Ipoh, Perak');
    expect(resolveBusiness(await snap(), 'restaurant').loc).toBe('Ipoh, Perak');
  });
});

describe('planRegisterBusiness', () => {
  it('infers a playbook from free text and records it as a learning signal', async () => {
    const plan = planRegisterBusiness(await snap(), 'saya ada kedai makan nasi kandar di Penang');
    expect(plan.key).toBe('restaurant');
    expect(plan.learnPick).toBe('inferred:restaurant');
  });
});

describe('connections', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(getConnections(await snap())).toEqual([]);
  });

  it('seeds from the playbook only once', async () => {
    const firstPlan = planSeedConnections(await snap(), 'restaurant');
    expect(firstPlan).not.toBeNull();
    store.setJSON(KEYS.conns, firstPlan);

    const seeded = getConnections(await snap());
    expect(seeded.length).toBeGreaterThan(0);

    store.setJSON(KEYS.conns, planToggleConnection(await snap(), seeded[0]));

    const secondPlan = planSeedConnections(await snap(), 'restaurant');
    if (secondPlan) store.setJSON(KEYS.conns, secondPlan);

    expect(getConnections(await snap())).not.toContain(seeded[0]);
  });

  it('toggles a connection on and off', async () => {
    expect(isConnected(await snap(), 'WhatsApp')).toBe(false);
    store.setJSON(KEYS.conns, planToggleConnection(await snap(), 'WhatsApp'));
    expect(isConnected(await snap(), 'WhatsApp')).toBe(true);
    store.setJSON(KEYS.conns, planToggleConnection(await snap(), 'WhatsApp'));
    expect(isConnected(await snap(), 'WhatsApp')).toBe(false);
  });
});

describe('work-done indices', () => {
  it('reads indices the engine wrote as strings', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', ['0', '2']);
    const s = await snap();
    expect(isWorkDone(s, 'restaurant', 0)).toBe(true);
    expect(isWorkDone(s, 'restaurant', 2)).toBe(true);
    expect(isWorkDone(s, 'restaurant', 1)).toBe(false);
  });

  it('reads indices an older port wrote as numbers', async () => {
    store.setJSON(KEYS.workDone + 'restaurant', [0, 2]);
    const s = await snap();
    expect(isWorkDone(s, 'restaurant', 0)).toBe(true);
    expect(isWorkDone(s, 'restaurant', 1)).toBe(false);
  });

  // The write/dedup behaviour formerly exercised here (`markWorkDone` always
  // writing strings and never duplicating) now lives entirely on
  // `LocalRepository.markWorkDone` and is covered by
  // `repo/__tests__/local.test.ts`. business.ts has no writer left to call.
});

describe('learning counters', () => {
  it('counts repeated picks and reports the most popular', async () => {
    store.setJSON(KEYS.learn + 'restaurant', { a: 1, b: 2 });
    expect(popular(await snap(), 'restaurant')).toEqual({ pick: 'b', n: 2 });
  });

  it('returns null when nothing has been learned', async () => {
    expect(popular(await snap(), 'restaurant')).toBeNull();
  });
});

describe('country', () => {
  it('defaults to MY', async () => {
    expect(getCountryCode(await snap())).toBe('MY');
  });

  it('rejects an unknown code', () => {
    expect(isCountryCode('ZZ')).toBe(false);
  });

  it('recognizes a known code and reads back what is stored', async () => {
    expect(isCountryCode('SG')).toBe(true);
    store.set(KEYS.country, 'SG');
    expect(getCountryCode(await snap())).toBe('SG');
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

  it('returns every operation from getPolicies', async () => {
    expect(Object.keys(getPolicies(await snap())).sort()).toEqual(
      ['book', 'cancel', 'export', 'list', 'pay', 'read', 'refund', 'send', 'update'].sort(),
    );
  });

  it('remembers an override and reports it as customised', async () => {
    expect(isCustomised(await snap(), 'send')).toBe(false);
    store.setJSON(KEYS.permissions, { send: 'automatic' });
    const s = await snap();
    expect(policyFor(s, 'send')).toBe('automatic');
    expect(isCustomised(s, 'send')).toBe(true);
  });

  it('does not report a no-op override as customised', async () => {
    store.setJSON(KEYS.permissions, { send: defaultPolicy('send') });
    expect(isCustomised(await snap(), 'send')).toBe(false);
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

  it('lists a queued approval as pending', async () => {
    store.setJSON(KEYS.approvals, [
      {
        id: 1,
        conn: 'WhatsApp',
        op: 'send',
        args: { to: '+60123' },
        risk: 'high',
        ts: new Date().toISOString(),
        status: 'pending',
      },
    ]);
    const s = await snap();
    expect(listApprovals(s)).toHaveLength(1);
    expect(pendingApprovals(s)).toHaveLength(1);
    expect(pendingApprovals(s)[0].status).toBe('pending');
  });
});

describe('callTool', () => {
  it('rejects an unknown connector', async () => {
    const result = callTool(await snap(), { conn: 'NotAThing', op: 'read' });
    expect(result).toEqual({ ok: false, err: 'unknown connector: NotAThing' });
  });

  it('asks to connect first when the connector is known but not connected', async () => {
    const result = callTool(await snap(), { conn: 'WhatsApp', op: 'read' });
    expect(result).toEqual({
      ok: false,
      need: 'connect',
      conn: 'WhatsApp',
      msg: 'Connect WhatsApp first, in Connections.',
    });
  });

  it('blocks a blocked-policy op even when connected', async () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool(await snap(), { conn: 'WhatsApp', op: 'pay' });
    expect(result).toEqual({
      ok: false,
      blocked: true,
      op: 'pay',
      msg: '"pay" is blocked in your permissions. Enable it in My Business to allow this.',
    });
  });

  it('dry-runs an approval-policy op and queues it at the right risk', async () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool(await snap(), { conn: 'WhatsApp', op: 'send', args: { to: '+60123' } });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      would: 'WhatsApp → send {"to":"+60123"}',
      risk: 'high',
    });
    if (result.ok && 'queued' in result) {
      expect(result.queued.status).toBe('pending');
      expect(result.queued.risk).toBe('high');
      // callTool no longer persists the queued approval itself — the caller
      // does. Apply it here to exercise pendingApprovals as a reader.
      store.setJSON(KEYS.approvals, [result.queued]);
    } else {
      throw new Error('expected a dry-run result with a queued approval');
    }
    expect(pendingApprovals(await snap())).toHaveLength(1);
  });

  it('runs the mock path when dryRun is explicitly false, even for a low-risk op', async () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool(await snap(), { conn: 'WhatsApp', op: 'read', dryRun: false });
    expect(result).toEqual({
      ok: true,
      mock: true,
      msg: 'WhatsApp → read OK (mock — no backend executor yet).',
    });
  });
});

describe('country localization family (non-MY)', () => {
  it('localizeSite swaps a .my domain for the country tld', async () => {
    store.set(KEYS.country, 'SG');
    expect(localizeSite(await snap(), { site: 'yourbakery.my' })).toBe('yourbakery.sg');
  });

  it('localizeSite leaves a domain without .my alone', async () => {
    store.set(KEYS.country, 'SG');
    expect(localizeSite(await snap(), { site: 'yourbusiness.com' })).toBe('yourbusiness.com');
  });

  it('localizeDetect rewrites the trailing city to the countrys first listed city', async () => {
    store.set(KEYS.country, 'SG');
    expect(
      localizeDetect(await snap(), { detect: 'restaurant · premium · Kuala Lumpur' }),
    ).toBe('restaurant · premium · Singapore');
  });

  it('localizeKeywords appends the country pack when the playbook defines one', async () => {
    store.set(KEYS.country, 'ID');
    expect(
      localizeKeywords(await snap(), {
        keywords: ['restaurant'],
        kw: { ID: ['nasi padang', 'warteg', 'rumah makan'] },
      }),
    ).toEqual(['restaurant', 'nasi padang', 'warteg', 'rumah makan']);
  });

  it('localizeKeywords returns the base list unchanged when there is nothing to add for this country', async () => {
    store.set(KEYS.country, 'SG');
    expect(
      localizeKeywords(await snap(), { keywords: ['restaurant'], kw: { ID: ['nasi padang'] } }),
    ).toEqual(['restaurant']);
  });

  it('localizeChannels puts the country default channels first, then anything new the playbook adds', async () => {
    store.set(KEYS.country, 'TH');
    expect(localizeChannels(await snap(), ['WhatsApp', 'Instagram'])).toEqual([
      'Line',
      'Facebook',
      'WhatsApp',
      'Instagram',
    ]);
  });

  it('cityList merges the always-available MY cities with the active country cities', async () => {
    store.set(KEYS.country, 'SG');
    const cities = cityList(await snap());
    expect(cities['kuala lumpur']).toBe('Kuala Lumpur, MY');
    expect(cities['jurong']).toBe('Jurong, SG');
  });
});

describe('permissions: getPolicies override merge', () => {
  it('merges a stored override over the defaults, leaving the rest untouched', async () => {
    store.setJSON(KEYS.permissions, { read: 'approval' });
    const policies = getPolicies(await snap());
    expect(policies.read).toBe('approval');
    expect(policies.pay).toBe('blocked');
    expect(policies.list).toBe('automatic');
  });
});

describe('business.ts: cheap accessors', () => {
  it('isSetupDone reflects the setupDone key', async () => {
    expect(isSetupDone(await snap())).toBe(false);
    store.set(KEYS.setupDone, '1');
    expect(isSetupDone(await snap())).toBe(true);
  });

  it('isOnboarded reflects the onboarded key', async () => {
    expect(isOnboarded(await snap())).toBe(false);
    store.set(KEYS.onboarded, '1');
    expect(isOnboarded(await snap())).toBe(true);
  });

  it('bumpPotential leaves the value unchanged when setup is not done', async () => {
    expect(bumpPotential(await snap(), 50)).toBe(50);
  });

  it('bumpPotential adds 20 once setup is done, capped at 96', async () => {
    store.set(KEYS.setupDone, '1');
    const s = await snap();
    expect(bumpPotential(s, 50)).toBe(70);
    expect(bumpPotential(s, 90)).toBe(96);
  });

  it('getChannels returns null when nothing is stored', async () => {
    expect(getChannels(await snap())).toBeNull();
  });

  it('getChannels returns the stored array', async () => {
    store.setJSON(KEYS.channels, ['WhatsApp', 'Instagram']);
    expect(getChannels(await snap())).toEqual(['WhatsApp', 'Instagram']);
  });
});

describe('isAgentReady', () => {
  it('a setup agent is ready once Accounting is connected', async () => {
    expect(isAgentReady(await snap(), { setup: true })).toBe(false);
    store.setJSON(KEYS.conns, planToggleConnection(await snap(), 'Accounting'));
    expect(isAgentReady(await snap(), { setup: true })).toBe(true);
  });

  it('a channel agent is ready once ANY connection exists, even one that does not match its channel', async () => {
    expect(isAgentReady(await snap(), { ch: 'WhatsApp' })).toBe(false);
    store.setJSON(KEYS.conns, planToggleConnection(await snap(), 'Instagram'));
    expect(isAgentReady(await snap(), { ch: 'WhatsApp' })).toBe(true);
  });
});

describe('confirmFor', () => {
  it('rewrites the confirm sentence to the city extracted from the text', async () => {
    expect(confirmFor(await snap(), 'restaurant', 'saya ada kedai makan di Penang')).toBe(
      'I found that you operate a restaurant/café in George Town. Is that correct?',
    );
  });

  it('falls back to the playbook default confirm sentence when no location is found', async () => {
    expect(confirmFor(await snap(), 'restaurant', 'saya suka masak je')).toBe(
      'I found that you operate a restaurant/café in Kuala Lumpur. Is that correct?',
    );
  });
});
