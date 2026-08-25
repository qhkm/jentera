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
import type { BusinessSnapshot } from '@/lib/repo/types';

export const FALLBACK_KEY = 'generic';

export interface InferResult {
  key: string;
  score: number;
}

export function inferPlaybook(snap: BusinessSnapshot, text: string): InferResult {
  const lower = (text || '').toLowerCase();
  const tokens = lower.split(/[^a-z0-9&]+/).filter(Boolean);

  let best = FALLBACK_KEY;
  let bestScore = 0;

  for (const key of Object.keys(PLAYBOOKS)) {
    if (key === FALLBACK_KEY) continue;
    let score = 0;

    for (const raw of localizeKeywords(snap, PLAYBOOKS[key])) {
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
export function extractLocation(snap: BusinessSnapshot, text: string): string {
  const lower = (text || '').toLowerCase();
  const cities = cityList(snap);

  /* Match on word boundaries, longest alias first.
     A plain substring test made the two-letter aliases fire inside
     ordinary words: "kl" is an alias for Kuala Lumpur, and "klinik gigi
     di Ipoh" contains it, so every Malay-described clinic was relocated
     to KL regardless of the city its owner actually named. "jb" and
     "pj" carry the same hazard. Longest-first then keeps "kuala lumpur"
     and "johor bahru" from losing to their own abbreviations. */
  const aliases = Object.keys(cities).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (pattern.test(lower)) return cities[alias];
  }

  const m = lower.match(/(?:di|in|at)\s+([a-z .,'-]{2,40})/);
  const parts = m?.[1]?.trim().split(/[\s,]+/).filter(Boolean);
  if (parts?.length) {
    const cap = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${cap}, ${getCountry(snap).code}`;
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
