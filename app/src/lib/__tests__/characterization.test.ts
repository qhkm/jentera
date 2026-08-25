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
