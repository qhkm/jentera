/* ============================================================
   The runtime that is a Worker request.

   Everything Jentera does today fits here: one fetch, one model call,
   done before the response. It is the fallback in every sense — the
   thing that runs when nothing more capable is provisioned, and the
   thing a broken remote runtime falls back to.
   ============================================================ */

import type { Env } from '../env';
import { MODEL, extractFacts, fetchPage } from '../ingest';
import { answer } from '../ask';
import type { PriorWork, RetrievedFact, RuntimeAdapter } from './types';

export class InlineRuntime implements RuntimeAdapter {
  readonly id = 'worker-inline';
  readonly model = MODEL;
  readonly mode = 'inline' as const;

  constructor(private readonly env: Env) {}

  async readPage(url: string) {
    const page = await fetchPage(url);
    if (page.text.trim().length < 120) {
      throw new Error('This page has too little readable text. Try a public About or Services page, upload a document, or describe your business.');
    }
    return {
      candidates: await extractFacts(this.env, page.text, page.title),
      title: page.title,
      chars: page.text.length,
    };
  }

  async answerQuestion(question: string, facts: RetrievedFact[], recent: PriorWork[]) {
    return answer(
      this.env,
      question,
      facts as never,
      recent.map((w) => ({ objective: w.objective, outcome: w.outcome, occurredAt: new Date() })),
    );
  }
}
