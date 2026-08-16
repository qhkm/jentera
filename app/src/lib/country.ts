/* ============================================================
   Country layer. Malaysia-first but country-aware: adding a
   country is one COUNTRIES entry, not a code change.
   ============================================================ */

import { COUNTRIES } from './data/countries';
import type { Country, CountryCode, Playbook } from './types';
import * as store from './storage';
import { KEYS } from './storage';

export const DEFAULT_COUNTRY: CountryCode = 'MY';

export function isCountryCode(v: string): v is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, v);
}

export function getCountryCode(): CountryCode {
  const c = store.get(KEYS.country, DEFAULT_COUNTRY);
  return isCountryCode(c) ? c : DEFAULT_COUNTRY;
}

export function getCountry(): Country {
  return COUNTRIES[getCountryCode()];
}

export function setCountry(code: string): boolean {
  if (!isCountryCode(code)) return false;
  store.set(KEYS.country, code);
  return true;
}

/** Malaysian cities are always available; the active country adds its own. */
export function cityList(): Record<string, string> {
  return { ...COUNTRIES[DEFAULT_COUNTRY].cities, ...getCountry().cities };
}

/** Swap a placeholder .my domain for the country TLD; leave real TLDs alone. */
export function localizeSite(p: Pick<Playbook, 'site'>): string {
  const c = getCountry();
  const site = String(p.site ?? '');
  if (c.code === DEFAULT_COUNTRY) return site;
  return site.replace(/\.my$/i, c.tld || '.my');
}

/** Rewrite the trailing city in a detect string to suit the country. */
export function localizeDetect(p: Pick<Playbook, 'detect'>): string {
  const c = getCountry();
  if (c.code === DEFAULT_COUNTRY || !p.detect) return p.detect;
  const cities = Object.keys(c.cities);
  const first = cities.length ? c.cities[cities[0]] : c.name;
  const city = first.split(',')[0].trim();
  return String(p.detect).replace(/·\s*[^·]+$/, `· ${city}`);
}

/** Base keywords plus any country-specific additions. */
export function localizeKeywords(p: Pick<Playbook, 'keywords' | 'kw'>): string[] {
  const out = p.keywords ? [...p.keywords] : [];
  const extra = p.kw?.[getCountryCode()];
  return extra?.length ? out.concat(extra) : out;
}

/** Country default channels first, then anything the playbook adds. */
export function localizeChannels(ch: string[]): string[] {
  const c = getCountry();
  if (c.code === DEFAULT_COUNTRY || !ch) return ch ?? [];
  const out = [...(c.defaultCh ?? [])];
  ch.forEach((x) => {
    if (!out.includes(x)) out.push(x);
  });
  return out;
}
