/* ============================================================
   Ask Jentera — the owner's instruction channel.

   Distinct from the Customer inbox: this is where the owner asks
   what happened or tells Jentera to handle something. Answers are
   generated from live state (work handled, approvals pending, the
   next suggested opportunity), never from a canned transcript —
   "chat is where the owner asks, Activity is where they
   understand what happened".
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRepository } from '@/lib/repo';
import { useSignedIn } from '@/lib/repo/gate';
import { TEAM_GENERAL, TEAM_REPLIES } from '@/lib/data/conversations';
import { TEAM_GENERAL_EN, TEAM_REPLIES_EN } from '@/i18n/agent-replies';
import { stripEmoji } from '@/components/Icon';
import type { Lang } from '@/lib/types';
import { taggedAgent } from '@/hooks/useMentions';
import type { Business } from '@/lib/types';
import type { AskMode, AskProgress } from '@/lib/repo';

export interface AskMessage {
  from: 'you' | 'ai';
  text: string;
  /** Set when the question tagged a specific agent. */
  agent?: string;
  /** Correlates an in-flight answer without exposing runtime ids in the UI. */
  pendingId?: string;
  /** The request that failed, retained so the UI can offer a real retry. */
  failedQuestion?: string;
  failedMode?: AskMode;
}

const ASK_HISTORY_KEY = 'jentera-ask-history-v1';

function savedHistory(): AskMessage[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(ASK_HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((message): message is AskMessage =>
      Boolean(message) && typeof message === 'object' &&
      ((message as AskMessage).from === 'you' || (message as AskMessage).from === 'ai') &&
      typeof (message as AskMessage).text === 'string');
  } catch {
    return [];
  }
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
  lang: Lang = 'en',
) {
  const repo = useRepository();
  const grounded = useSignedIn();
  const [messages, setMessages] = useState<AskMessage[]>(() => grounded ? savedHistory() : []);
  /* Deterministic rotation — Math.random would change on every render. */
  const turn = useRef(0);

  /* Keep completed owner conversations through navigation and refresh in
     this browser tab. In-flight pairs are excluded: restoring "working" after
     a reload would create a spinner that can never finish. */
  useEffect(() => {
    if (!grounded) return;
    const stable = messages.filter((message, index) =>
      !message.pendingId && !(message.from === 'you' && messages[index + 1]?.pendingId));
    try {
      sessionStorage.setItem(ASK_HISTORY_KEY, JSON.stringify(stable.slice(-40)));
    } catch {
      /* Private mode / quota — conversation still works in memory. */
    }
  }, [grounded, messages]);

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
    (raw: string, mode: AskMode = 'ask') => {
      const question = raw.trim();
      if (!question) return;

      /* Signed in: the server answers from confirmed facts and real
         work records, and says so when it does not know. The canned
         replies below stay for the anonymous demo, which has no
         backend to ask and no facts to ground an answer in. */
      if (grounded) {
        const pendingId = crypto.randomUUID();
        setMessages((prev) => [
          ...prev,
          { from: 'you', text: question },
          { from: 'ai', text: t('ask.working'), pendingId },
        ]);
        void repo
          .ask(question, {
            mode,
            onProgress: (progress: AskProgress) => {
              const key = progress === 'queued' ? 'ask.queued'
                : progress === 'waking' ? 'ask.waking'
                  : progress === 'retrying' ? 'ask.retrying' : 'ask.working';
              setMessages((prev) => prev.map((message) =>
                message.pendingId === pendingId ? { ...message, text: t(key) } : message,
              ));
            },
          })
          .then((a) => {
            // Replace the placeholder rather than appending, so the
            // thinking indicator does not stay in the transcript.
            setMessages((prev) => prev.map((message) =>
              message.pendingId === pendingId ? { from: 'ai', text: a.text } : message,
            ));
          }, (reason: unknown) => {
            const text = reason instanceof Error ? reason.message : 'Jentera could not answer.';
            setMessages((prev) => prev.map((message) =>
              message.pendingId === pendingId
                ? { from: 'ai', text, failedQuestion: question, failedMode: mode }
                : message,
            ));
          });
        return;
      }

      /* Tagging an agent routes the reply to that agent rather than to
         Jentera's general answer. */
      const agent = taggedAgent(question, business.team);
      let reply: string;
      if (agent) {
        /* The ported BM replies carry emoji; strip so an agent speaks in
           the same voice as the rest of the product. */
        const replies = lang === 'bm' ? TEAM_REPLIES : TEAM_REPLIES_EN;
        const general = lang === 'bm' ? TEAM_GENERAL : TEAM_GENERAL_EN;
        const pool = replies[agent.n] ?? general;
        reply = stripEmoji(pool[turn.current % pool.length]);
        turn.current += 1;
      } else {
        reply = answer(question);
      }

      setMessages((prev) => [
        ...prev,
        { from: 'you', text: question },
        { from: 'ai', text: reply, agent: agent?.n },
      ]);
    },
    [answer, business.team, lang, grounded, repo],
  );

  return { messages, send, hasHistory: messages.length > 0 };
}
