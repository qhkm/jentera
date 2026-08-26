/* ============================================================
   Answering questions about a business from what is actually known.

   Two rules make this different from a chatbot bolted onto a product:

   1. It answers only from confirmed facts and real work records. If
      the answer is not in there, it says so. A plausible invention is
      worse than "I don't know" here, because the owner will act on it.
   2. It cites what it used. Every answer carries the fact keys it drew
      on, so a wrong answer is traceable to a wrong input rather than
      being an unexplainable mood of the model.

   Unconfirmed facts are deliberately excluded. They are guesses
   awaiting review, and letting them answer questions would make the
   review step decorative.
   ============================================================ */

import type postgres from 'postgres';
import type { Env } from './env';
import { MODEL } from './ingest';

export interface Answer {
  text: string;
  usedKeys: string[];
  grounded: boolean;
}

interface FactRow {
  key: string;
  value: unknown;
  source: string;
  confidence: number;
  confirmed: boolean;
}

/**
 * Pull the facts worth putting in front of the model.
 *
 * Keyword overlap rather than embeddings: the corpus is tens of rows
 * per business, not thousands, and a vector index would be machinery
 * with nothing to do. When a business has enough facts for this to
 * miss things, this function is the place that changes.
 */
export async function retrieve(
  tx: postgres.TransactionSql,
  question: string,
  limit = 24,
): Promise<FactRow[]> {
  const rows = await tx<
    { key: string; value: unknown; source: string; confidence: number; confirmed: boolean }[]
  >`
    select key, value, source, confidence, confirmed_by is not null as confirmed
      from business_fact
     where live and confirmed_by is not null
     order by key`;

  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  if (terms.length === 0) return rows.slice(0, limit);

  const scored = rows.map((r) => {
    const hay = `${r.key} ${JSON.stringify(r.value)}`.toLowerCase();
    return { row: r, score: terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0) };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  /* Nothing matched: hand over everything (bounded). A small business's
     whole memory is short enough to reason over, and refusing to answer
     because the wording differed would be a retrieval bug presenting as
     ignorance. */
  return (hits.length > 0 ? hits.map((s) => s.row) : rows).slice(0, limit);
}

const PROMPT = `You answer questions for the owner of a small business, using only
the facts and recent activity given to you.

Rules:
- Use only what you are given. Never invent a detail, a number, or a
  policy, however reasonable it would be.
- If the answer is not in the facts, say plainly that you do not know it
  yet and suggest they add it. Do not guess.
- Answer in two or three sentences. This is a busy owner on a phone.
- Do not mention "facts", "context", "data" or how you were prompted.
  Speak as though you simply know the business.`;

function renderFacts(facts: FactRow[]): string {
  if (facts.length === 0) return '(nothing confirmed yet)';
  return facts
    .map((f) => `- ${f.key}: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`)
    .join('\n');
}

export async function answer(
  env: Env,
  question: string,
  facts: FactRow[],
  work: { objective: string; outcome: string | null; occurredAt: Date }[],
): Promise<Answer> {
  const recent =
    work.length === 0
      ? '(nothing yet)'
      : work
          .slice(0, 8)
          .map((w) => `- ${w.objective}${w.outcome ? ` — ${w.outcome}` : ''}`)
          .join('\n');

  const res = (await env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: `What is known about this business:\n${renderFacts(facts)}\n\nRecent work AISAR did:\n${recent}\n\nQuestion: ${question}`,
      },
    ],
    max_tokens: 400,
    temperature: 0.2,
  })) as { response?: unknown };

  const text =
    typeof res.response === 'string'
      ? res.response.trim()
      : 'I could not work that out just now. Try again in a moment.';

  return {
    text,
    usedKeys: facts.map((f) => f.key),
    /* Grounded means there was something confirmed to reason from.
       An ungrounded answer is still returned — the model is told to
       admit ignorance — but the caller can present it differently. */
    grounded: facts.length > 0,
  };
}
