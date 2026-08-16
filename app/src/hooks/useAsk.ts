/* ============================================================
   Ask AISAR — the owner's instruction channel.

   Distinct from the Customer inbox: this is where the owner asks
   what happened or tells AISAR to handle something. Answers are
   generated from live state (work handled, approvals pending, the
   next suggested opportunity), never from a canned transcript —
   "chat is where the owner asks, Activity is where they
   understand what happened".
   ============================================================ */

import { useCallback, useState } from 'react';
import type { Business } from '@/lib/types';

export interface AskMessage {
  from: 'you' | 'ai';
  text: string;
}

/** Prompt chips offered above the composer. */
export const ASK_PROMPTS = ['status', 'approvals', 'next'] as const;
export type AskPrompt = (typeof ASK_PROMPTS)[number];

/** Keyword routing, matching the engine. EN and BM stems both covered. */
const INTENTS: { test: RegExp; intent: 'status' | 'approvals' | 'next' }[] = [
  { test: /today|status|happen|hari|berlaku/, intent: 'status' },
  { test: /need|approval|approve|perlu|lulus/, intent: 'approvals' },
  { test: /next|help|handle|seterus|bantu|urus/, intent: 'next' },
];

export interface AskCounts {
  handled: number;
  needs: number;
}

export function useAsk(
  business: Business,
  counts: AskCounts,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  const [messages, setMessages] = useState<AskMessage[]>([]);

  const answer = useCallback(
    (question: string): string => {
      const q = question.toLowerCase();
      const hit = INTENTS.find((i) => i.test.test(q));

      switch (hit?.intent) {
        case 'status':
          return t('ask.status')
            .replace('{handled}', String(counts.handled))
            .replace('{needs}', String(counts.needs));
        case 'approvals':
          if (!counts.needs) return t('ask.clear');
          return counts.needs === 1
            ? t('ask.needone')
            : t('ask.needs').replace('{n}', String(counts.needs));
        case 'next':
          return t('ask.next')
            .replace('{title}', business.sug.t)
            .replace('{detail}', business.sug.d);
        default:
          return t('ask.default');
      }
    },
    [business.sug, counts, t],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question) return;
      setMessages((prev) => [
        ...prev,
        { from: 'you', text: question },
        { from: 'ai', text: answer(question) },
      ]);
    },
    [answer],
  );

  return { messages, send, hasHistory: messages.length > 0 };
}
