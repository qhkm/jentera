/* ============================================================
   Ask Jentera — the owner's instruction channel.

   Distinct from the Customer inbox: this is where the owner asks
   what happened or tells Jentera to handle something. Answers are
   generated from live state (work handled, approvals pending, the
   next suggested opportunity), never from a canned transcript —
   "chat is where the owner asks, Activity is where they
   understand what happened".

   Conversations are grouped into sessions, Telegram-style: each
   chat keeps its own history, survives refresh, and carries a
   stable sessionId to the runtime so Hermes can keep context.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRepository } from '@/lib/repo';
import { useAccountKey, useSignedIn } from '@/lib/repo/gate';
import { TEAM_GENERAL, TEAM_REPLIES } from '@/lib/data/conversations';
import { TEAM_GENERAL_EN, TEAM_REPLIES_EN } from '@/i18n/agent-replies';
import { stripEmoji } from '@/components/Icon';
import type { Lang } from '@/lib/types';
import { taggedAgent } from '@/hooks/useMentions';
import type { Business } from '@/lib/types';
import type { AskAnswer, AskMode, AskProgress } from '@/lib/repo';
import { trackActivation } from '@/lib/analytics';

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
  /** Real runtime state used by the live work card. */
  state?: 'sending' | AskProgress | 'done' | 'failed';
  mode?: AskMode;
  /** Completion evidence returned by the server. */
  usedKeys?: string[];
  grounded?: boolean;
}

export interface AskSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AskMessage[];
}

/* Storage is keyed per account. The earlier single global key meant the next
   account to sign in on a shared browser inherited the previous account's
   conversations; those unscoped keys are cleared, never migrated. */
const ASK_STORAGE_PREFIX = 'jentera-ask';
const ASK_SESSIONS_KEY = 'jentera-ask-sessions-v1';
const ASK_HISTORY_KEY = 'jentera-ask-history-v1';
const MAX_SESSIONS = 20;

function sessionsKey(account: string): string {
  return `${ASK_SESSIONS_KEY}:${account}`;
}

/** Forget every account's Ask conversations on this browser. Called at
    sign-out and on the sign-in screen so a shared device carries nothing
    across accounts; unrelated flow gates are left alone. */
export function clearAskStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(ASK_STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  try {
    sessionStorage.removeItem(ASK_HISTORY_KEY);
  } catch {
    /* Same. */
  }
}

function isMessage(value: unknown): value is AskMessage {
  return Boolean(value) && typeof value === 'object' &&
    ((value as AskMessage).from === 'you' || (value as AskMessage).from === 'ai') &&
    typeof (value as AskMessage).text === 'string';
}

/* In-flight pairs are excluded from storage: restoring "working" after
   a reload would create a spinner that can never finish. */
function stableMessages(messages: AskMessage[]): AskMessage[] {
  return messages.filter((message, index) =>
    !message.pendingId && !(message.from === 'you' && messages[index + 1]?.pendingId));
}

function titleFor(messages: AskMessage[]): string {
  const first = messages.find((message) => message.from === 'you')?.text ?? '';
  const flat = first.replace(/\s+/g, ' ').trim();
  return flat.length <= 40 ? flat : `${flat.slice(0, 40)}…`;
}

function freshSession(): AskSession {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] };
}

function byRecent(a: AskSession, b: AskSession): number {
  return b.updatedAt - a.updatedAt;
}

function loadSessions(account: string): AskSession[] {
  try {
    const value = JSON.parse(localStorage.getItem(sessionsKey(account)) ?? '[]') as unknown;
    if (Array.isArray(value)) {
      const sessions = value
        .filter((s): s is AskSession =>
          Boolean(s) && typeof s === 'object' &&
          typeof (s as AskSession).id === 'string' &&
          Array.isArray((s as AskSession).messages))
        .map((s) => ({
          id: s.id,
          title: typeof s.title === 'string' ? s.title : '',
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
          updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
          messages: s.messages.filter(isMessage).slice(-40),
        }));
      if (sessions.length) return sessions.sort(byRecent);
    }
  } catch {
    /* Private mode / quota — fresh session below. */
  }
  return [freshSession()];
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

interface AskState {
  sessions: AskSession[];
  activeId: string;
}

export function useAsk(
  business: Business,
  counts: AskCounts,
  t: (key: string, vars?: Record<string, string | number>) => string,
  lang: Lang = 'en',
  onCompleted?: (mode: AskMode, answer: AskAnswer) => void,
) {
  const repo = useRepository();
  const grounded = useSignedIn();
  /* Persist only when the account is known: a signed-in session without an
     id would otherwise fall back to one shared key, which is the leak. */
  const account = useAccountKey();
  const persisted = grounded && account !== null;
  const [state, setState] = useState<AskState>(() => {
    const sessions = persisted ? loadSessions(account) : [freshSession()];
    return { sessions, activeId: sessions[0]?.id ?? '' };
  });
  const activeIdRef = useRef(state.activeId);
  activeIdRef.current = state.activeId;
  /* Deterministic rotation — Math.random would change on every render. */
  const turn = useRef(0);

  /* Keep conversations through navigation and refresh in this browser.
     In-flight pairs are excluded so a reload never restores a spinner
     that can never finish. */
  useEffect(() => {
    if (!persisted) return;
    const stable = state.sessions.map((session) => ({
      ...session,
      messages: stableMessages(session.messages).slice(-40),
    }));
    try {
      localStorage.setItem(sessionsKey(account), JSON.stringify(stable.slice(0, MAX_SESSIONS)));
    } catch {
      /* Private mode / quota — conversation still works in memory. */
    }
  }, [persisted, account, state.sessions]);

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

  const newSession = useCallback(() => {
    const session = freshSession();
    setState((prev) => ({
      sessions: [session, ...prev.sessions].slice(0, MAX_SESSIONS),
      activeId: session.id,
    }));
  }, []);

  const openSession = useCallback((id: string) => {
    setState((prev) => (prev.sessions.some((s) => s.id === id)
      ? { ...prev, activeId: id }
      : prev));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((prev) => {
      const remaining = prev.sessions.filter((s) => s.id !== id);
      if (remaining.length === 0) {
        const fresh = freshSession();
        return { sessions: [fresh], activeId: fresh.id };
      }
      return {
        sessions: remaining,
        activeId: prev.activeId === id ? remaining[0].id : prev.activeId,
      };
    });
  }, []);

  const send = useCallback(
    (raw: string, mode: AskMode = 'work') => {
      const question = raw.trim();
      if (!question) return;
      const sessionId = activeIdRef.current;
      const now = Date.now();

      /* Signed in: the server answers from confirmed facts and real
         work records, and says so when it does not know. The canned
         replies below stay for the anonymous demo, which has no
         backend to ask and no facts to ground an answer in. */
      if (grounded) {
        trackActivation(mode === 'work' ? 'work_sent' : 'ask_sent');
        const pendingId = crypto.randomUUID();
        setState((prev) => {
          const index = prev.sessions.findIndex((s) => s.id === sessionId);
          if (index === -1) return prev;
          const session = prev.sessions[index];
          const updated: AskSession = {
            ...session,
            title: session.title || titleFor([{ from: 'you' as const, text: question }]),
            updatedAt: now,
            messages: [
              ...session.messages,
              { from: 'you', text: question },
              { from: 'ai', text: t('ask.working'), pendingId, state: 'sending', mode },
            ],
          };
          return {
            sessions: [...prev.sessions.slice(0, index), updated, ...prev.sessions.slice(index + 1)],
            activeId: prev.activeId,
          };
        });
        void repo
          .ask(question, {
            mode,
            sessionId,
            onProgress: (progress: AskProgress) => {
              const key = progress === 'queued' ? 'ask.queued'
                : progress === 'waking' ? 'ask.waking'
                  : progress === 'retrying' ? 'ask.retrying' : 'ask.working';
              setState((prev) => {
                const index = prev.sessions.findIndex((s) => s.id === sessionId);
                if (index === -1) return prev;
                const session = prev.sessions[index];
                return {
                  sessions: [...prev.sessions.slice(0, index), {
                    ...session,
                    messages: session.messages.map((message) =>
                      message.pendingId === pendingId
                        ? { ...message, text: t(key), state: progress }
                        : message),
                  }, ...prev.sessions.slice(index + 1)],
                  activeId: prev.activeId,
                };
              });
            },
          })
          .then((a) => {
            // Replace the placeholder rather than appending, so the
            // thinking indicator does not stay in the transcript.
            setState((prev) => {
              const index = prev.sessions.findIndex((s) => s.id === sessionId);
              if (index === -1) return prev;
              const session = prev.sessions[index];
              return {
                sessions: [...prev.sessions.slice(0, index), {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((message) =>
                    message.pendingId === pendingId
                      ? {
                          from: 'ai',
                          text: a.text,
                          state: 'done' as const,
                          mode,
                          usedKeys: a.usedKeys,
                          grounded: a.grounded,
                        }
                      : message),
                }, ...prev.sessions.slice(index + 1)],
                activeId: prev.activeId,
              };
            });
            onCompleted?.(mode, a);
            trackActivation(mode === 'work' ? 'work_completed' : 'ask_completed');
          }, (reason: unknown) => {
            const text = reason instanceof Error ? reason.message : 'Jentera could not answer.';
            setState((prev) => {
              const index = prev.sessions.findIndex((s) => s.id === sessionId);
              if (index === -1) return prev;
              const session = prev.sessions[index];
              return {
                sessions: [...prev.sessions.slice(0, index), {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((message) =>
                    message.pendingId === pendingId
                      ? {
                          from: 'ai',
                          text,
                          failedQuestion: question,
                          failedMode: mode,
                          state: 'failed' as const,
                          mode,
                        }
                      : message),
                }, ...prev.sessions.slice(index + 1)],
                activeId: prev.activeId,
              };
            });
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

      setState((prev) => {
        const index = prev.sessions.findIndex((s) => s.id === sessionId);
        if (index === -1) return prev;
        const session = prev.sessions[index];
        const updated: AskSession = {
          ...session,
          title: session.title || titleFor([{ from: 'you' as const, text: question }]),
          updatedAt: now,
          messages: [
            ...session.messages,
            { from: 'you', text: question },
            { from: 'ai', text: reply, agent: agent?.n },
          ],
        };
        return {
          sessions: [...prev.sessions.slice(0, index), updated, ...prev.sessions.slice(index + 1)],
          activeId: prev.activeId,
        };
      });
    },
    [answer, business.team, lang, grounded, repo, onCompleted, t],
  );

  const active = state.sessions.find((s) => s.id === state.activeId) ?? state.sessions[0];
  const messages = active?.messages ?? [];
  const sessions = [...state.sessions].sort(byRecent);

  return {
    messages,
    sessions,
    activeId: active?.id ?? '',
    send,
    newSession,
    openSession,
    deleteSession,
    hasHistory: messages.length > 0,
  };
}
