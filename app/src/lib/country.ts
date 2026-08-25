import { COUNTRIES } from './data/countries';
import type { Country, CountryCode, Playbook } from './types';
import type { BusinessSnapshot } from '@/lib/repo/types';

export const DEFAULT_COUNTRY: CountryCode = 'MY';

export function isCountryCode(v: string): v is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRIES, v);
}

export function getCountryCode(snap: BusinessSnapshot): CountryCode {
  return isCountryCode(snap.country) ? snap.country : DEFAULT_COUNTRY;
}

export function getCountry(snap: BusinessSnapshot): Country {
  return COUNTRIES[getCountryCode(snap)];
}

/** Malaysian cities are always available; the active country adds its own. */
export function cityList(snap: BusinessSnapshot): Record<string, string> {
  return { ...COUNTRIES[DEFAULT_COUNTRY].cities, ...getCountry(snap).cities };
}

/** Swap a placeholder .my domain for the country TLD; leave real TLDs alone. */
export function localizeSite(snap: BusinessSnapshot, p: Pick<Playbook, 'site'>): string {
  const c = getCountry(snap);
  const site = String(p.site ?? '');
  if (c.code === DEFAULT_COUNTRY) return site;
  return site.replace(/\.my$/i, c.tld || '.my');
}

/** Rewrite the trailing city in a detect string to suit the country. */
export function localizeDetect(snap: BusinessSnapshot, p: Pick<Playbook, 'detect'>): string {
  const c = getCountry(snap);
  if (c.code === DEFAULT_COUNTRY || !p.detect) return p.detect;
  const cities = Object.keys(c.cities);
  const first = cities.length ? c.cities[cities[0]] : c.name;
  const city = first.split(',')[0].trim();
  return String(p.detect).replace(/·\s*[^·]+$/, `· ${city}`);
}

/** Base keywords plus any country-specific additions. */
export function localizeKeywords(
  snap: BusinessSnapshot,
  p: Pick<Playbook, 'keywords' | 'kw'>,
): string[] {
  const out = p.keywords ? [...p.keywords] : [];
  const extra = p.kw?.[getCountryCode(snap)];
  return extra?.length ? out.concat(extra) : out;
}

/** Country default channels first, then anything the playbook adds. */
export function localizeChannels(snap: BusinessSnapshot, ch: string[]): string[] {
  const c = getCountry(snap);
  if (c.code === DEFAULT_COUNTRY || !ch) return ch ?? [];
  const out = [...(c.defaultCh ?? [])];
  ch.forEach((x) => {
    if (!out.includes(x)) out.push(x);
  });
  return out;
}
