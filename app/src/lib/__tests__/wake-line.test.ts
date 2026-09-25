/* The app and the Worker each keep a copy of the waking lines: the Worker
   sends its English line to Telegram, the app shows its translated one. A
   run is meant to read the same in both, so the two copies must not drift. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MESSAGES } from '@/lib/data/i18n';
import { WAKE_LINE_COUNT, wakeLineIndex } from '@/lib/wake-line';

const workerSource = readFileSync(resolve(process.cwd(), '../worker/src/runtime/wake-lines.ts'), 'utf8');

function workerLines(): string[] {
  const block = workerSource.match(/WAKE_LINES = \[([\s\S]*?)\] as const/)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

describe('the waking line', () => {
  it('has the Worker’s English lines, in the Worker’s order', () => {
    const english = Array.from({ length: WAKE_LINE_COUNT }, (_, index) => MESSAGES.en[`ask.wake.${index}`]);
    expect(english).toEqual(workerLines());
  });

  it('has every line in Bahasa Malaysia too', () => {
    for (let index = 0; index < WAKE_LINE_COUNT; index += 1) {
      expect(MESSAGES.bm[`ask.wake.${index}`], `ask.wake.${index}`).toMatch(/~20 saat/);
    }
  });

  it('picks the line the same way the Worker does', () => {
    const body = (source: string) => source.match(/function wakeLineIndex[\s\S]*?\n}/)?.[0];
    const app = readFileSync(resolve(process.cwd(), 'src/lib/wake-line.ts'), 'utf8');
    expect(body(app)).toBeDefined();
    expect(body(app)).toBe(body(workerSource));
  });

  it('spreads runs across every line and keeps one run on one line', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const seen = new Set(ids.map((id) => wakeLineIndex(id, WAKE_LINE_COUNT)));
    expect(seen.size).toBe(WAKE_LINE_COUNT);
    expect(wakeLineIndex(ids[7], WAKE_LINE_COUNT)).toBe(wakeLineIndex(ids[7], WAKE_LINE_COUNT));
  });
});
