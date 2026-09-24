import { describe, expect, it } from 'vitest';
import { PAGE_MESSAGES } from '../pages';

/* A missing key never fails at runtime: t() falls back to English, then to
   the raw key. This test is what keeps the Malay workspace complete. */
describe('page strings', () => {
  it('has every key in both English and Malay', () => {
    expect(Object.keys(PAGE_MESSAGES.bm).sort()).toEqual(Object.keys(PAGE_MESSAGES.en).sort());
  });

  it('has no empty string in either language', () => {
    for (const lang of ['en', 'bm'] as const) {
      for (const [key, value] of Object.entries(PAGE_MESSAGES[lang])) expect(value.trim(), `${lang}:${key}`).not.toBe('');
    }
  });

  it('keeps the same placeholders in both languages', () => {
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(PAGE_MESSAGES.en)) {
      expect(slots(PAGE_MESSAGES.bm[key] ?? ''), key).toEqual(slots(value));
    }
  });
});
