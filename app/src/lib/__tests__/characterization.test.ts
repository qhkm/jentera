/* Describes what the storage-backed domain modules do TODAY, before the
   Repository refactor. These assertions must still hold at the end of
   Task 5. If one starts failing, the refactor changed behaviour. */

import { beforeEach, describe, expect, it } from 'vitest';
import * as store from '@/lib/storage';
import { KEYS } from '@/lib/storage';
import {
  bumpPotential,
  confirmFor,
  getBizType,
  getChannels,
  getConnections,
  isAgentReady,
  isConnected,
  isOnboarded,
  isSetupDone,
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
import {
  cityList,
  getCountryCode,
  localizeChannels,
  localizeDetect,
  localizeKeywords,
  localizeSite,
  setCountry,
} from '@/lib/country';
import { defaultPolicy, getPolicies, isCustomised, policyFor, setPolicy } from '@/lib/permissions';
import { callTool, listApprovals, pendingApprovals, queueApproval, riskOf } from '@/lib/tools';

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
  // The brief's original phrase, 'saya ada restoran nasi kandar di Penang',
  // does not infer 'restaurant': none of its words match a playbook
  // keyword ("restoran" != "restaurant"; "nasi kandar" isn't a keyword,
  // only "nasi padang" is, and that's scoped to the ID country pack).
  // It infers 'generic' with score 0. This phrase swaps in the exact
  // multi-word keyword "kedai makan" (see src/lib/data/playbooks.ts),
  // which is unique to the restaurant playbook and reliably infers it.
  it('infers a playbook from free text and persists the type', () => {
    const { key } = registerBusiness('saya ada kedai makan nasi kandar di Penang');
    expect(key).toBe('restaurant');
    expect(store.get(KEYS.bizType, '')).toBe('restaurant');
  });

  it('records the inference as a learning signal', () => {
    const { key } = registerBusiness('saya ada kedai makan nasi kandar di Penang');
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

describe('callTool', () => {
  it('rejects an unknown connector', () => {
    const result = callTool({ conn: 'NotAThing', op: 'read' });
    expect(result).toEqual({ ok: false, err: 'unknown connector: NotAThing' });
  });

  it('asks to connect first when the connector is known but not connected', () => {
    const result = callTool({ conn: 'WhatsApp', op: 'read' });
    expect(result).toEqual({
      ok: false,
      need: 'connect',
      conn: 'WhatsApp',
      msg: 'Connect WhatsApp first, in Connections.',
    });
  });

  it('blocks a blocked-policy op even when connected', () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool({ conn: 'WhatsApp', op: 'pay' });
    expect(result).toEqual({
      ok: false,
      blocked: true,
      op: 'pay',
      msg: '"pay" is blocked in your permissions. Enable it in My Business to allow this.',
    });
  });

  it('dry-runs an approval-policy op and queues it at the right risk', () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool({ conn: 'WhatsApp', op: 'send', args: { to: '+60123' } });
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      would: 'WhatsApp → send {"to":"+60123"}',
      risk: 'high',
    });
    if (result.ok && 'queued' in result) {
      expect(result.queued.status).toBe('pending');
      expect(result.queued.risk).toBe('high');
    } else {
      throw new Error('expected a dry-run result with a queued approval');
    }
    expect(pendingApprovals()).toHaveLength(1);
  });

  it('runs the mock path when dryRun is explicitly false, even for a low-risk op', () => {
    store.setJSON(KEYS.conns, ['WhatsApp']);
    const result = callTool({ conn: 'WhatsApp', op: 'read', dryRun: false });
    expect(result).toEqual({
      ok: true,
      mock: true,
      msg: 'WhatsApp → read OK (mock — no backend executor yet).',
    });
  });
});

describe('country localization family (non-MY)', () => {
  it('localizeSite swaps a .my domain for the country tld', () => {
    setCountry('SG');
    expect(localizeSite({ site: 'yourbakery.my' })).toBe('yourbakery.sg');
  });

  it('localizeSite leaves a domain without .my alone', () => {
    setCountry('SG');
    expect(localizeSite({ site: 'yourbusiness.com' })).toBe('yourbusiness.com');
  });

  it('localizeDetect rewrites the trailing city to the countrys first listed city', () => {
    setCountry('SG');
    expect(localizeDetect({ detect: 'restaurant · premium · Kuala Lumpur' })).toBe(
      'restaurant · premium · Singapore',
    );
  });

  it('localizeKeywords appends the country pack when the playbook defines one', () => {
    setCountry('ID');
    expect(
      localizeKeywords({ keywords: ['restaurant'], kw: { ID: ['nasi padang', 'warteg', 'rumah makan'] } }),
    ).toEqual(['restaurant', 'nasi padang', 'warteg', 'rumah makan']);
  });

  it('localizeKeywords returns the base list unchanged when there is nothing to add for this country', () => {
    setCountry('SG');
    expect(
      localizeKeywords({ keywords: ['restaurant'], kw: { ID: ['nasi padang'] } }),
    ).toEqual(['restaurant']);
  });

  it('localizeChannels puts the country default channels first, then anything new the playbook adds', () => {
    setCountry('TH');
    expect(localizeChannels(['WhatsApp', 'Instagram'])).toEqual([
      'Line',
      'Facebook',
      'WhatsApp',
      'Instagram',
    ]);
  });

  it('cityList merges the always-available MY cities with the active country cities', () => {
    setCountry('SG');
    const cities = cityList();
    expect(cities['kuala lumpur']).toBe('Kuala Lumpur, MY');
    expect(cities['jurong']).toBe('Jurong, SG');
  });
});

describe('permissions: getPolicies override merge', () => {
  it('merges a stored override over the defaults, leaving the rest untouched', () => {
    setPolicy('read', 'approval');
    const policies = getPolicies();
    expect(policies.read).toBe('approval');
    expect(policies.pay).toBe('blocked');
    expect(policies.list).toBe('automatic');
  });
});

describe('business.ts: cheap accessors', () => {
  it('isSetupDone reflects the setupDone key', () => {
    expect(isSetupDone()).toBe(false);
    store.set(KEYS.setupDone, '1');
    expect(isSetupDone()).toBe(true);
  });

  it('isOnboarded reflects the onboarded key', () => {
    expect(isOnboarded()).toBe(false);
    store.set(KEYS.onboarded, '1');
    expect(isOnboarded()).toBe(true);
  });

  it('bumpPotential leaves the value unchanged when setup is not done', () => {
    expect(bumpPotential(50)).toBe(50);
  });

  it('bumpPotential adds 20 once setup is done, capped at 96', () => {
    store.set(KEYS.setupDone, '1');
    expect(bumpPotential(50)).toBe(70);
    expect(bumpPotential(90)).toBe(96);
  });

  it('getChannels returns null when nothing is stored', () => {
    expect(getChannels()).toBeNull();
  });

  it('getChannels returns the stored array', () => {
    store.setJSON(KEYS.channels, ['WhatsApp', 'Instagram']);
    expect(getChannels()).toEqual(['WhatsApp', 'Instagram']);
  });
});

describe('isAgentReady', () => {
  it('a setup agent is ready once Accounting is connected', () => {
    expect(isAgentReady({ setup: true })).toBe(false);
    toggleConnection('Accounting');
    expect(isAgentReady({ setup: true })).toBe(true);
  });

  // The `ch` match (`keys.some(...)`) is OR'd with `keys.length > 0`, and any
  // match implies keys.length > 0 — so today this reduces to "any connection
  // at all", and the channel argument never actually gates readiness.
  it('a channel agent is ready once ANY connection exists, even one that does not match its channel', () => {
    expect(isAgentReady({ ch: 'WhatsApp' })).toBe(false);
    toggleConnection('Instagram');
    expect(isAgentReady({ ch: 'WhatsApp' })).toBe(true);
  });
});

describe('confirmFor', () => {
  it('rewrites the confirm sentence to the city extracted from the text', () => {
    expect(confirmFor('restaurant', 'saya ada kedai makan di Penang')).toBe(
      'I found that you operate a restaurant/café in George Town. Is that correct?',
    );
  });

  it('falls back to the playbook default confirm sentence when no location is found', () => {
    expect(confirmFor('restaurant', 'saya suka masak je')).toBe(
      'I found that you operate a restaurant/café in Kuala Lumpur. Is that correct?',
    );
  });
});
