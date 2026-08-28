/* ============================================================
   Setup progress, which replaced a number that meant nothing.

   The sidebar used to read "Jentera can handle 82%" — taken from the
   playbook, identical for every business of that type, and unmoved by
   anything the owner did. Precise, prominent and untethered, which is
   the worst combination, because it reads as a measurement.

   These three milestones are checkable and they move. Each takes its
   evidence from something real, which was itself the second bug here:
   the first version asked `snap.conns` whether a channel was
   connected, and that list is seeded from the playbook — it named
   WhatsApp, Instagram, Google Calendar and Google Sheets for a
   business that had connected none of them.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import { milestones, readiness } from '@/lib/business';
import type { BusinessSnapshot, Fact } from '@/lib/repo/types';

const fact = (confirmed: boolean): Fact => ({
  key: 'hours.monday',
  value: '9-6',
  source: 'owner',
  sourceRef: null,
  confidence: 1,
  confirmed,
  confirmedAt: null,
  version: 1,
  createdAt: '2026-08-26T00:00:00.000Z',
});

/** conns is deliberately populated: it must not influence anything. */
const snap = (facts: Fact[] = []) =>
  ({
    facts,
    conns: ['WhatsApp', 'Instagram', 'Google Calendar'],
  }) as BusinessSnapshot;

const next = (facts: Fact[], handled: number, connections: number) =>
  milestones(snap(facts), handled, connections).find((m) => !m.done)?.key;

describe('a business that has done nothing', () => {
  it('is at zero, not at a flattering default', () => {
    expect(readiness(snap(), 0, 0)).toBe(0);
  });

  it('is asked to tell Jentera about itself first', () => {
    expect(next([], 0, 0)).toBe('knows');
  });
});

describe('each milestone counts only when it is true', () => {
  it('an unconfirmed guess is not knowing something', () => {
    /* The same rule as retrieval: a guess nobody vouched for does not
       count as the business having told Jentera anything. */
    expect(readiness(snap([fact(false)]), 0, 0)).toBe(0);
    expect(readiness(snap([fact(true)]), 0, 0)).toBe(33);
  });

  it('a playbook suggestion is not a connection', () => {
    /* The regression. `snap()` carries three playbook-seeded names;
       none of them is an account anyone connected, and readiness must
       stay at zero until a real one exists. */
    expect(readiness(snap(), 0, 0)).toBe(0);
    expect(readiness(snap(), 0, 1)).toBe(33);
  });

  it('work only counts once something has completed', () => {
    expect(readiness(snap(), 0, 0)).toBe(0);
    expect(readiness(snap(), 1, 0)).toBe(33);
  });
});

describe('progress', () => {
  it('reaches a hundred only when all three are true', () => {
    expect(readiness(snap([fact(true)]), 1, 1)).toBe(100);
  });

  it('moves as each one lands', () => {
    expect(readiness(snap([fact(true)]), 0, 0)).toBe(33);
    expect(readiness(snap([fact(true)]), 0, 1)).toBe(67);
  });

  it('names the next thing to do, in order', () => {
    expect(next([fact(true)], 0, 0)).toBe('connected');
    expect(next([fact(true)], 0, 1)).toBe('working');
  });

  it('has nothing left to suggest once finished', () => {
    expect(next([fact(true)], 3, 1)).toBeUndefined();
  });
});
