/* ============================================================
   Inference — free text to a playbook. The heart of "generate on
   the run": there is no per-customer profile anywhere, only a
   keyword match into PLAYBOOKS.

   Scoring rules are load-bearing and ported exactly:
     · multi-word phrases score higher (more specific)
     · <=3-char keywords need a whole-token match, so 'pet' does
       not match 'petaling'
     · longer keywords allow a short prefix, so 'hair' catches
       'haircut' but not an unrelated long word
   ============================================================ */

import { PLAYBOOKS } from './data/playbooks';
import { cityList, getCountry, localizeKeywords } from './country';

export const FALLBACK_KEY = 'generic';

export interface InferResult {
  key: string;
  score: number;
}

export function inferPlaybook(text: string): InferResult {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z0-9&]+/).filter(Boolean);

  let best = FALLBACK_KEY;
  let bestScore = 0;

  for (const key of Object.keys(PLAYBOOKS)) {
    if (key === FALLBACK_KEY) continue;
    let score = 0;

    for (const raw of localizeKeywords(PLAYBOOKS[key])) {
      const w = String(raw).toLowerCase();

      if (w.includes(' ')) {
        if (lower.includes(w)) score += 1 + (w.split(' ').length - 1) * 1.5;
      } else if (w.length <= 3) {
        if (tokens.includes(w)) score += 1;
      } else if (
        tokens.some((t) => t === w || (t.startsWith(w) && t.length - w.length <= 3))
      ) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }

  return { key: best, score: bestScore };
}

/** Pull a location out of free text — known city alias first, then "di/in/at X". */
export function extractLocation(text: string): string {
  const lower = (text || '').toLowerCase();
  const cities = cityList();

  for (const alias of Object.keys(cities)) {
    if (lower.includes(alias)) return cities[alias];
  }

  const m = lower.match(/(?:di|in|at)\s+([a-z .,'-]{2,40})/);
  const parts = m?.[1]?.trim().split(/[\s,]+/).filter(Boolean);
  if (parts?.length) {
    const cap = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${cap}, ${getCountry().code}`;
  }

  return '';
}

/** Best-effort business name: strip the trailing location, title-case, cap at 5 words. */
export function extractName(text: string, fallback: string): string {
  const t = (text || '')
    .replace(/(?:di|in|at)\s+[a-z .,'-]{2,40}$/i, '')
    .replace(/[^a-zA-Z0-9 &'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (t.length < 3) return fallback;

  return t
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .slice(0, 5)
    .join(' ');
}
