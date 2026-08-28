/* ============================================================
   Reading a business's own website and proposing facts from it.

   The first run type that does real work, and deliberately the one
   with zero external side effects: it reads a public page, thinks, and
   writes rows. Nothing is sent, charged, or posted. If the extraction
   is wrong the cost is a bad suggestion the owner declines, not a
   message to a customer.

   Everything it produces is `source: 'agent'` and unconfirmed. The
   product does not act on these until a person says they are right.
   ============================================================ */

import type { Env } from './env';

/** Cheap and fast; the task is extraction, not reasoning. Swapping
    this for an external provider is a change to one constant and the
    body of `askModel`. */
export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
/** Enough of a page to characterise a small business, short enough to
    stay inside a single model context without truncation games. */
const MAX_CHARS = 12_000;

export interface Candidate {
  key: string;
  value: string;
  confidence: number;
}

/**
 * Reject a URL before fetching it.
 *
 * The Worker is fetching an address a user supplied, which is the
 * shape of an SSRF. Cloudflare will not route to RFC1918 space from a
 * Worker, so this is not the only thing standing in the way — but
 * `file:`, `data:` and a hostname that is plainly internal should
 * never get as far as depending on that.
 */
export function urlProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return 'url is required';
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return 'that does not look like a web address';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only http and https are supported';
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return 'that address is not reachable from the internet';
  }
  return null;
}

/** Fetch a page as text, bounded in both time and size. */
export async function fetchPage(url: string): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    headers: {
      // Identify honestly. A site owner reading their logs should be
      // able to tell what this was.
      'User-Agent': 'Jentera/1.0 (+https://jentera.ai; reads a business its own site)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`the site answered ${res.status}`);

  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('html') && !type.includes('text/plain')) {
    throw new Error('that address is not a web page');
  }

  const raw = await res.text();
  const html = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;
  return { text: htmlToText(html), title: titleOf(html) };
}

function titleOf(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? '';
}

/**
 * Strip a page to readable text.
 *
 * Not a parser. Script and style bodies are removed because their
 * contents are noise that crowds out the page's actual words; the rest
 * is tag-stripped and whitespace-collapsed. Good enough to feed a
 * model, and it cannot execute anything.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

const PROMPT = `You are reading a small business's own website to learn about it.

Extract only facts the page actually states. Do not infer, do not fill
gaps with what is typical for this kind of business, and do not repeat
marketing copy as fact.

Return JSON only, shaped:
{"facts":[{"key":"...","value":"...","confidence":0.0}]}

Keys are dotted lowercase paths from this vocabulary where they fit:
  business.name, business.about, business.address, business.phone,
  business.email, business.whatsapp, hours.monday ... hours.sunday,
  hours.note, service.<slug>.name, service.<slug>.price,
  service.<slug>.about, payment.methods, delivery.options,
  social.instagram, social.facebook, social.tiktok

Invent a key in the same style only if the page states something
important that none of the above covers.

confidence is how plainly the page says it: 0.9 when stated outright,
0.5 when implied, below 0.4 do not include it at all. Prefer returning
fewer, well-supported facts over many weak ones.`;

/**
 * Ask the model for candidate facts.
 *
 * Parses defensively: a model that returns prose around its JSON, or a
 * fact missing a field, must degrade to fewer candidates rather than
 * failing the whole run. The owner reviews everything anyway, so a
 * dropped candidate costs less than a crashed ingestion.
 */
function asText(res: unknown): string {
  if (typeof res === 'string') return res;
  if (typeof res !== 'object' || res === null) return '';
  const r = res as Record<string, unknown>;

  if (typeof r.response === 'string') return r.response;
  // Some models answer with the parsed object directly under
  // `response`; re-serialising it costs nothing and the parser below
  // is happy either way.
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);

  const choices = r.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
    if (typeof first?.message?.content === 'string') return first.message.content;
    if (typeof first?.text === 'string') return first.text;
  }
  if (typeof r.result === 'string') return r.result;
  return '';
}

export async function extractFacts(env: Env, page: string, title: string): Promise<Candidate[]> {
  const res = (await env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: `Page title: ${title}\n\n${page}` },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  })) as unknown;

  /* Workers AI does not return one shape across models: some give
     { response: string }, some nest it under choices[].message.content,
     and a model that emits structured output can return an object
     where a string was expected. Normalising here keeps the shape
     question in one place instead of scattering `?.` through parsing. */
  const text = asText(res);
  if (!text) {
    /* String() around the stringify: JSON.stringify(undefined) returns
       undefined, not "undefined", so calling .slice on it threw — and
       the line that threw was the one reporting that something had
       gone wrong. A model returning nothing crashed the run instead of
       degrading, which is the opposite of what this function promises. */
    console.error(`[ingest] unrecognised AI response: ${String(JSON.stringify(res)).slice(0, 400)}`);
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];

  let parsed: { facts?: unknown };
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { facts?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.facts)) return [];

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.facts) {
    if (typeof raw !== 'object' || raw === null) continue;
    const f = raw as Record<string, unknown>;
    const key = typeof f.key === 'string' ? f.key.trim().toLowerCase() : '';
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key) || seen.has(key)) continue;
    const value =
      typeof f.value === 'string'
        ? f.value.trim()
        : typeof f.value === 'number'
          ? String(f.value)
          : '';
    if (!value || value.length > 2000) continue;
    const confidence = Number(f.confidence);
    if (!Number.isFinite(confidence) || confidence < 0.4) continue;
    seen.add(key);
    out.push({ key, value, confidence: Math.min(1, Math.max(0, confidence)) });
    // A page yielding more than this is almost certainly listing rather
    // than describing, and a review screen of 60 rows gets dismissed.
    if (out.length >= 30) break;
  }
  return out;
}
