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
import type { ChatTranscript, Artifact, AskAnswer, AskMode, AskProgress, AskProgressEvent, WorkKind } from '@/lib/repo';
import { artifactsOf } from '@/lib/artifacts';
import { trackActivation } from '@/lib/analytics';
import { isRunId } from '@/lib/task';

export interface AskMessage {
  from: 'you' | 'ai';
  text: string;
  /** Set when the question tagged a specific agent. */
  agent?: string;
  /** Correlates an in-flight answer without exposing runtime ids in the UI. */
  pendingId?: string;
  /** When the question was sent; the waiting bubble counts up from it. */
  startedAt?: number;
  /** What the agent is doing while answer text is already on screen (a tool
      mid-answer); cleared by the next piece of text. */
  liveStatus?: string;
  /** The agent's own steps and tool calls, in order, kept with the reply. */
  steps?: string[];
  /** Files the agent produced for the owner, offered as downloads. */
  artifacts?: Artifact[];
  /** The request that failed, retained so the UI can offer a real retry. */
  failedQuestion?: string;
  failedMode?: AskMode;
  /** Real runtime state used by the live work card. */
  /** streaming: answer text is arriving and `text` is the partial answer. */
  state?: 'sending' | AskProgress | 'streaming' | 'done' | 'failed';
  mode?: AskMode;
  runId?: string;
  taskTitle?: string;
  /** Completion evidence returned by the server. */
  usedKeys?: string[];
  grounded?: boolean;
  taskStatus?: string;
  /** Reasoning depth; does not imply a tracked task. */
  depth?: 'quick' | 'deep';
  /** What the server decided the finished run was. */
  kind?: WorkKind;
  /** Set with state 'needs_approval': the card fetches the question with it.
      Nothing about what is being approved travels through the stream. */
  approvalId?: string;
}

export interface AskSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AskMessage[];
  /** Set when the chat was opened inside a workspace: every member of it
      may read and continue the chat, and each turn is sent with it. */
  workspaceId?: string;
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

/** The steps the run remembers, for when none were seen live: the socket
    never opened, or the page was reloaded while the agent worked. */
function durableSteps(answer: AskAnswer): string[] | undefined {
  const steps = answer.steps;
  return Array.isArray(steps) && steps.length && steps.every((step) => typeof step === 'string')
    ? steps
    : undefined;
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** One progress event applied to the placeholder it belongs to. Pure, so
    the same projection serves a run this page started and one it resumed
    after a reload. */
function applyProgress(message: AskMessage, event: AskProgressEvent, t: Translate): AskMessage {
  /* The agent's own steps and tool calls read as a list; a
     repeated line is the same step, not a new one. */
  if (event.type === 'status' && (event.kind === 'step' || event.kind === 'tool')) {
    const detail = event.detail?.trim();
    if (detail && message.steps?.at(-1) !== detail) {
      message = { ...message, steps: [...(message.steps ?? []), detail].slice(-20) };
    }
  }
  if (event.type === 'delta') {
    /* Stripped thinking blocks and step lines leave their
       newlines behind between tool calls; the reply keeps
       whitespace, so a run of them was a tall empty gap
       mid-answer. Runs collapse to one blank line. */
    const text = ((message.state === 'streaming' ? message.text : '') + (event.text ?? ''))
      .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')
      .replace(/^\s+/, '');
    /* A blank first chunk (a newline before the answer) would
       replace the status bubble with an empty reply. */
    if (!text.trim()) return message;
    return { ...message, text, state: 'streaming', liveStatus: undefined };
  }
  /* Once answer text is on screen, a status line must not erase
     it; it rides alongside, so a tool running mid-answer still
     shows. */
  if (message.state === 'streaming') {
    if (event.type === 'needs_approval') {
      return {
        ...message,
        state: 'needs_approval',
        approvalId: event.approvalId,
        liveStatus: undefined,
      };
    }
    if (event.type === 'status' || event.type === 'thinking') {
      const detail = event.detail?.trim();
      return detail
        ? { ...message, liveStatus: event.type === 'thinking' ? `💭 ${detail}` : detail }
        : message;
    }
    return message;
  }
  if (event.type === 'status') {
    return { ...message, text: event.detail || t('ask.working'), state: 'working' };
  }
  if (event.type === 'thinking') {
    return { ...message, text: `💭 ${event.detail ?? ''}`.trim(), state: 'working' };
  }
  if (event.type === 'needs_approval') {
    /* Any answer text already streamed is kept: the agent may
       have said what it intends to do before asking, and
       replacing that with a bare card would throw away the
       reason the owner needs in order to decide. */
    return {
      ...message,
      state: 'needs_approval',
      approvalId: event.approvalId,
      liveStatus: undefined,
    };
  }
  const key = event.type === 'queued' ? 'ask.queued'
    : event.type === 'waking' ? 'ask.waking'
      : event.type === 'retrying' ? 'ask.retrying' : 'ask.working';
  return { ...message, text: t(key), state: event.type };
}

/* A pair still in flight is kept only once the run exists: the next mount
   reattaches to it. Before that there is nothing to go back to, and a
   restored spinner could never finish. */
function stableMessages(messages: AskMessage[]): AskMessage[] {
  const resumable = (message: AskMessage | undefined) => Boolean(message?.runId);
  return messages.filter((message, index) =>
    (!message.pendingId || resumable(message)) &&
    !(message.from === 'you' && messages[index + 1]?.pendingId && !resumable(messages[index + 1])));
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
          ...(typeof s.workspaceId === 'string' ? { workspaceId: s.workspaceId } : {}),
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
  /* Deep opts into the research loop; quick is the default, as on Telegram. */
  const [deep, setDeep] = useState(false);
  /* Wake the agent as the chat opens so the first message finds it warm. */
  useEffect(() => {
    if (!grounded) return;
    void repo.warmAgent?.().catch(() => undefined);
  }, [grounded, repo]);
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
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  /* Deterministic rotation — Math.random would change on every render. */
  const turn = useRef(0);

  /* Keep conversations through navigation and refresh in this browser.
     A pair still in flight is kept once its run exists, so the next
     mount can pick it back up. */
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

  const newSession = useCallback((resumeId?: string, workspaceId?: string) => {
    const session = freshSession();
    if (resumeId) session.id = resumeId;
    if (workspaceId) session.workspaceId = workspaceId;
    setState((prev) => ({
      sessions: prev.sessions.some((s) => s.id === session.id) ? prev.sessions : [session, ...prev.sessions].slice(0, MAX_SESSIONS),
      activeId: session.id,
    }));
    return session.id;
  }, []);

  /* A chat another member opened in a shared workspace, read from the
     server and brought into this browser so it can be continued here. Each
     turn becomes the pair the chat would have shown had it been typed here;
     a turn still running or failed shows its question alone. */
  const importSession = useCallback((chat: ChatTranscript) => {
    const messages: AskMessage[] = [];
    for (const turn of chat.turns) {
      messages.push({ from: 'you', text: turn.question });
      if (turn.status === 'completed' && turn.text) {
        messages.push({
          from: 'ai', text: turn.text, state: 'done', runId: turn.runId,
          ...(turn.artifacts.length ? { artifacts: turn.artifacts } : {}),
        });
      }
    }
    const session: AskSession = {
      id: chat.id,
      title: chat.title ?? messages[0]?.text.slice(0, 40) ?? '',
      createdAt: Date.parse(chat.createdAt) || Date.now(),
      updatedAt: Date.parse(chat.lastAt) || Date.now(),
      messages: messages.slice(-40),
      ...(chat.workspaceId ? { workspaceId: chat.workspaceId } : {}),
    };
    setState((prev) => ({
      sessions: [session, ...prev.sessions.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS),
      activeId: session.id,
    }));
    return session.id;
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

  /** One placeholder, patched in place; the session and pair ids find it. */
  const patchPending = useCallback((
    sessionId: string,
    pendingId: string,
    patch: (message: AskMessage) => AskMessage,
  ) => {
    setState((prev) => {
      const index = prev.sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return prev;
      const session = prev.sessions[index];
      return {
        sessions: [...prev.sessions.slice(0, index), {
          ...session,
          messages: session.messages.map((message) =>
            message.pendingId === pendingId ? patch(message) : message),
        }, ...prev.sessions.slice(index + 1)],
        activeId: prev.activeId,
      };
    });
  }, []);

  /** The answer, or the failure, replaces the placeholder; the same for a
      run this page sent and one it picked back up after a reload. */
  const settlePending = useCallback((
    sessionId: string,
    pendingId: string,
    question: string,
    mode: AskMode,
    promise: Promise<AskAnswer>,
  ) => {
    promise.then((a) => {
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
                    runId: isRunId(a.runId) ? a.runId : message.runId,
                    taskTitle: question,
                    state: 'done' as const,
                    mode,
                    depth: message.depth,
                    steps: message.steps?.length ? message.steps : durableSteps(a),
                    artifacts: artifactsOf(a.artifacts),
                    kind: a.kind,
                    taskStatus: a.taskStatus,
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
                    runId: message.runId,
                    taskTitle: question,
                    state: 'failed' as const,
                    mode,
                    steps: message.steps,
                  }
                : message),
          }, ...prev.sessions.slice(index + 1)],
          activeId: prev.activeId,
        };
      });
    });
  }, [onCompleted]);

  /* A pair kept through a reload has a run to go back to. Reattach once,
     into the same placeholder: the steps seen so far stay, the partial
     text does not (the durable answer replaces it). Without a way to
     resume, the question is offered back for a retry, not dropped. */
  const resumed = useRef(false);
  useEffect(() => {
    if (!persisted || resumed.current) return;
    resumed.current = true;
    for (const session of state.sessions) {
      session.messages.forEach((message, index) => {
        if (!message.pendingId || !message.runId) return;
        const { pendingId, runId } = message;
        const question = message.taskTitle ?? session.messages[index - 1]?.text ?? '';
        const mode = message.mode ?? 'work';
        if (!repo.resumeAsk) {
          settlePending(session.id, pendingId, question, mode,
            Promise.reject(new Error('Jentera could not answer.')));
          return;
        }
        patchPending(session.id, pendingId, (current) => ({
          ...current, text: t('ask.working'), state: 'working', liveStatus: undefined,
        }));
        settlePending(session.id, pendingId, question, mode, repo.resumeAsk(runId, {
          onProgress: (event) => patchPending(session.id, pendingId, (current) => applyProgress(current, event, t)),
        }));
      });
    }
    /* Once, over the sessions restored at mount; later state is not re-read. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted, repo, patchPending, settlePending, t]);

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
              {
                from: 'ai', text: t('ask.working'), pendingId, state: 'sending', mode,
                depth: deep ? 'deep' : 'quick', startedAt: now,
              },
            ],
          };
          return {
            sessions: [...prev.sessions.slice(0, index), updated, ...prev.sessions.slice(index + 1)],
            activeId: prev.activeId,
          };
        });
        const workspaceId = sessionsRef.current.find((s) => s.id === sessionId)?.workspaceId;
        settlePending(sessionId, pendingId, question, mode, repo.ask(question, {
          mode,
          sessionId,
          ...(workspaceId ? { workspaceId } : {}),
          responseMode: deep ? 'deep' : 'quick',
          onRunCreated: (runId: string) => {
            if (!isRunId(runId)) return;
            patchPending(sessionId, pendingId, (message) => ({ ...message, runId, taskTitle: question }));
          },
          onProgress: (event: AskProgressEvent) =>
            patchPending(sessionId, pendingId, (message) => applyProgress(message, event, t)),
        }));
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
    [answer, business.team, lang, grounded, repo, patchPending, settlePending, t],
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
    importSession,
    openSession,
    deleteSession,
    hasHistory: messages.length > 0,
    deep,
    setDeep,
  };
}
