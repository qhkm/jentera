import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAskStorage, useAsk } from '@/hooks/useAsk';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskAnswer, AskOptions, AskProgressEvent, Repository } from '@/lib/repo';
import type { Business } from '@/lib/types';

const business = {
  sug: { t: 'Follow up', d: 'Reply to customers' },
  team: [],
} as unknown as Business;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('useAsk durable answers', () => {
  it('replaces the matching placeholder when answers finish out of order', async () => {
    const repo: Repository = new LocalRepository();
    const pending = new Map<string, (answer: AskAnswer) => void>();
    const ids = { first: '11111111-1111-4111-8111-111111111111', second: '22222222-2222-4222-8222-222222222222' };
    repo.ask = (question: string, options?: AskOptions): Promise<AskAnswer> => {
      options?.onRunCreated?.(ids[question as keyof typeof ids]);
      return new Promise<AskAnswer>((resolve) => pending.set(question, resolve));
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) =>
        key === 'ask.working' ? 'Jentera is working on this…' : key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => {
      result.current!.send('first');
      result.current!.send('second');
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'Jentera is working on this…', 'second', 'Jentera is working on this…',
    ]);

    await act(async () => {
      pending.get('second')?.({ text: 'second answer', usedKeys: [], grounded: false });
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'Jentera is working on this…', 'second', 'second answer',
    ]);

    await act(async () => {
      pending.get('first')?.({ text: 'first answer', usedKeys: [], grounded: false });
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'first answer', 'second', 'second answer',
    ]);
    expect(result.current!.messages[1]).toMatchObject({ runId: ids.first, taskTitle: 'first' });
    expect(result.current!.messages[3]).toMatchObject({ runId: ids.second, taskTitle: 'second' });
  });

  it('opts into durable work and projects WebSocket progress into its placeholder', async () => {
    const repo: Repository = new LocalRepository();
    let options: AskOptions | undefined;
    let resolveAnswer: ((answer: AskAnswer) => void) | undefined;
    repo.ask = (_question: string, next?: AskOptions): Promise<AskAnswer> => {
      options = next;
      return new Promise<AskAnswer>((resolve) => { resolveAnswer = resolve; });
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => ({
        'ask.working': 'Working',
        'ask.waking': 'Waking',
      }[key] ?? key)),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current!.send('handle this', 'work'));
    expect(options?.mode).toBe('work');
    act(() => options?.onProgress?.({ type: 'waking' }));
    expect(result.current!.messages[1].text).toBe('Waking');

    await act(async () => {
      resolveAnswer?.({ text: 'done', usedKeys: ['business.name'], grounded: true });
    });
    expect(result.current!.messages[1].text).toBe('done');
    expect(result.current!.messages[1]).toMatchObject({
      state: 'done',
      mode: 'work',
      usedKeys: ['business.name'],
      grounded: true,
    });
  });

  it('warms the agent once when a signed-in chat opens', async () => {
    const repo: Repository = new LocalRepository();
    const warmAgent = vi.fn(async () => {});
    repo.warmAgent = warmAgent;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result, rerender } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    await waitFor(() => expect(warmAgent).toHaveBeenCalledTimes(1));
    rerender();
    expect(warmAgent).toHaveBeenCalledTimes(1);
  });

  it('asks for a quick reply by default and a deep one only when toggled', async () => {
    const repo: Repository = new LocalRepository();
    const seen: AskOptions[] = [];
    repo.ask = (_question: string, next?: AskOptions): Promise<AskAnswer> => {
      if (next) seen.push(next);
      return Promise.resolve({ text: 'ok', usedKeys: [], grounded: false, kind: 'conversation' });
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => { result.current!.send('are we open?', 'work'); });
    expect(seen[0]?.responseMode).toBe('quick');
    expect(result.current!.messages[1]).toMatchObject({ depth: 'quick' });
    act(() => result.current!.setDeep(true));
    expect(result.current!.deep).toBe(true);
    await act(async () => { result.current!.send('compare suppliers', 'work'); });
    expect(seen[1]?.responseMode).toBe('deep');
    expect(result.current!.messages[1]).toMatchObject({ state: 'done', kind: 'conversation' });
    expect(result.current!.messages[3]).toMatchObject({ depth: 'deep' });
  });

  it('keeps the files the agent produced with the finished reply', async () => {
    const repo: Repository = new LocalRepository();
    const artifact = { id: 'a1', runId: '11111111-1111-4111-8111-111111111111', name: 'digest.md', contentType: 'text/markdown', size: 8, createdAt: '2026-09-12T01:00:00.000Z' };
    repo.ask = (): Promise<AskAnswer> => Promise.resolve({ text: 'Your digest is attached.', usedKeys: [], grounded: true, artifacts: [artifact] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => { result.current!.send('digest please', 'work'); });
    expect(result.current!.messages[1]).toMatchObject({ state: 'done', artifacts: [artifact] });
  });

  it('takes the steps from the durable answer when none arrived live', async () => {
    /* A reload mid-run, or a socket that never opened: the run detail
       still knows what the agent did, so the receipt is not lost. */
    const repo: Repository = new LocalRepository();
    repo.ask = (): Promise<AskAnswer> => Promise.resolve({
      text: 'Three headlines.', usedKeys: [], grounded: true,
      steps: ['Searching for headlines', '🔎 web_search: "news"'],
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => { result.current!.send('news?', 'work'); });
    expect(result.current!.messages[1]).toMatchObject({
      state: 'done',
      text: 'Three headlines.',
      steps: ['Searching for headlines', '🔎 web_search: "news"'],
    });
  });

  it("streams the agent's status, thinking and answer text into the placeholder", async () => {
    const repo: Repository = new LocalRepository();
    let options: AskOptions | undefined;
    let resolveAnswer: ((answer: AskAnswer) => void) | undefined;
    repo.ask = (_question: string, next?: AskOptions): Promise<AskAnswer> => {
      options = next;
      return new Promise<AskAnswer>((resolve) => { resolveAnswer = resolve; });
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.send('are we open on sunday?', 'work'));

    act(() => options?.onProgress?.({ type: 'status', detail: 'Searching the web…' }));
    expect(result.current!.messages[1].text).toBe('Searching the web…');
    act(() => options?.onProgress?.({ type: 'thinking', detail: 'checking the calendar' }));
    expect(result.current!.messages[1].text).toContain('checking the calendar');

    // a blank first chunk (a newline before the answer) must not replace the
    // status bubble with an empty reply
    act(() => options?.onProgress?.({ type: 'delta', text: '\n' }));
    expect(result.current!.messages[1]).toMatchObject({ text: '💭 checking the calendar', state: 'working' });
    act(() => options?.onProgress?.({ type: 'delta', text: 'We are ' }));
    act(() => options?.onProgress?.({ type: 'delta', text: 'open on Sunday.' }));
    expect(result.current!.messages[1]).toMatchObject({ text: 'We are open on Sunday.', state: 'streaming' });
    // a late status must not wipe answer text that has started arriving;
    // it rides alongside it, so a tool running mid-answer is still visible
    act(() => options?.onProgress?.({ type: 'status', detail: 'Finishing…' }));
    expect(result.current!.messages[1]).toMatchObject({
      text: 'We are open on Sunday.', state: 'streaming', liveStatus: 'Finishing…',
    });
    act(() => options?.onProgress?.({ type: 'delta', text: ' Yes.' }));
    expect(result.current!.messages[1]).toMatchObject({ text: 'We are open on Sunday. Yes.' });
    expect(result.current!.messages[1].liveStatus).toBeUndefined();
    // The agent's own steps and tool calls accumulate as a list; dispatch
    // stages only ever change the label. Both survive into the final reply.
    act(() => options?.onProgress?.({ type: 'status', detail: '✅ Agent started — thinking…', kind: 'stage' }));
    act(() => options?.onProgress?.({ type: 'status', detail: 'Checking the calendar', kind: 'step' }));
    act(() => options?.onProgress?.({ type: 'status', detail: 'Checking the calendar', kind: 'step' }));
    act(() => options?.onProgress?.({ type: 'status', detail: '🔎 web_search: "opening hours"', kind: 'tool' }));
    expect(result.current!.messages[1].steps).toEqual(['Checking the calendar', '🔎 web_search: "opening hours"']);
    // Stripped thinking blocks and step lines leave their newlines behind
    // between tool calls; the reply keeps whitespace, so a run of them was a
    // tall empty gap mid-answer. Runs collapse to one blank line.
    act(() => options?.onProgress?.({ type: 'delta', text: '\n\n' }));
    act(() => options?.onProgress?.({ type: 'delta', text: '\n \n\n' }));
    act(() => options?.onProgress?.({ type: 'delta', text: '\nHey boss' }));
    expect(result.current!.messages[1].text).toBe('We are open on Sunday. Yes.\n\nHey boss');

    await act(async () => {
      resolveAnswer?.({ text: 'We are open on Sunday, 9 to 5.', usedKeys: [], grounded: true });
    });
    expect(result.current!.messages[1]).toMatchObject({
      text: 'We are open on Sunday, 9 to 5.', state: 'done',
      steps: ['Checking the calendar', '🔎 web_search: "opening hours"'],
    });
  });

  it('keeps a failed question retryable instead of presenting the error as an answer', async () => {
    const repo: Repository = new LocalRepository();
    repo.ask = async () => {
      throw new Error('temporarily offline');
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current!.send('check the orders'));
    await waitFor(() => expect(result.current!.messages[1].text).toBe('temporarily offline'));
    expect(result.current!.messages[1]).toMatchObject({
      failedQuestion: 'check the orders',
      state: 'failed',
      mode: 'work',
    });
  });

  it('restores completed conversation history in the same browser tab', async () => {
    const repo: Repository = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = async () => ({ text: 'Here is the answer', usedKeys: [], grounded: false, runId });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value account="user-1">
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const first = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current).not.toBeNull());
    act(() => first.result.current!.send('my question'));
    await waitFor(() => expect(first.result.current!.messages[1].text).toBe('Here is the answer'));
    await waitFor(() =>
      expect(localStorage.getItem('jentera-ask-sessions-v1:user-1')).toContain('Here is the answer'));
    first.unmount();

    const second = renderHook(
      () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
      { wrapper },
    );
    await waitFor(() => expect(second.result.current).not.toBeNull());
    expect(second.result.current!.sessions[0]).toMatchObject({
      title: 'my question',
    });
    expect(second.result.current!.messages.map((message) => message.text)).toEqual([
      'my question',
      'Here is the answer',
    ]);
    expect(second.result.current!.messages[1]).toMatchObject({ runId, taskTitle: 'my question' });
  });

  it('resumes a run that was in flight when the page was reloaded', async () => {
    /* The question and its placeholder used to vanish on reload. With a
       run id the pair is kept, and the next mount reattaches to the run:
       progress carries on into the same placeholder and the answer lands. */
    const repo: Repository = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = (_question, options) => {
      options?.onRunCreated?.(runId);
      options?.onProgress?.({ type: 'status', detail: 'Checking hours', kind: 'step' });
      return new Promise<AskAnswer>(() => { /* the tab goes away first */ });
    };
    const resumeAsk = vi.fn(async (id: string, options?: { onProgress?: (event: AskProgressEvent) => void }) => {
      expect(id).toBe(runId);
      options?.onProgress?.({ type: 'status', detail: 'Reading the calendar', kind: 'step' });
      return { text: 'We open at 9.', usedKeys: [], grounded: true, runId, kind: 'work' as const };
    });
    repo.resumeAsk = resumeAsk;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value account="resume-1">
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const first = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(first.result.current).not.toBeNull());
    act(() => first.result.current!.send('hours?', 'work'));
    await waitFor(() => expect(first.result.current!.messages[1]).toMatchObject({ runId, steps: ['Checking hours'] }));
    await waitFor(() => expect(localStorage.getItem('jentera-ask-sessions-v1:resume-1')).toContain(runId));
    expect(resumeAsk).not.toHaveBeenCalled();
    first.unmount();

    const second = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(second.result.current).not.toBeNull());
    await waitFor(() => expect(second.result.current!.messages[1]).toMatchObject({ state: 'done' }));
    expect(resumeAsk).toHaveBeenCalledTimes(1);
    expect(second.result.current!.messages.map((message) => message.text)).toEqual(['hours?', 'We open at 9.']);
    expect(second.result.current!.messages[1]).toMatchObject({
      runId, taskTitle: 'hours?', mode: 'work', kind: 'work',
      steps: ['Checking hours', 'Reading the calendar'],
    });
  });

  it('keeps a resumed run retryable when it cannot be reattached', async () => {
    const repo: Repository = new LocalRepository();
    const runId = '22222222-2222-4222-8222-222222222222';
    repo.ask = (_question, options) => {
      options?.onRunCreated?.(runId);
      return new Promise<AskAnswer>(() => { /* the tab goes away first */ });
    };
    repo.resumeAsk = async () => { throw new Error('Jentera stopped that answer.'); };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value account="resume-2">
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const first = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(first.result.current).not.toBeNull());
    act(() => first.result.current!.send('hours?', 'ask'));
    await waitFor(() => expect(localStorage.getItem('jentera-ask-sessions-v1:resume-2')).toContain(runId));
    first.unmount();

    const second = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(second.result.current).not.toBeNull());
    await waitFor(() => expect(second.result.current!.messages[1]).toMatchObject({ state: 'failed' }));
    expect(second.result.current!.messages[1]).toMatchObject({
      text: 'Jentera stopped that answer.', failedQuestion: 'hours?', failedMode: 'ask', runId,
    });
  });

  it('retains an accepted run when the answer connection fails', async () => {
    const repo: Repository = new LocalRepository();
    const runId = '11111111-1111-4111-8111-111111111111';
    repo.ask = async (_question, options) => {
      options?.onRunCreated?.(runId);
      throw new Error('Connection lost');
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value account="task-recovery">
        <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
      </SignedInProvider>
    );
    const { result } = renderHook(() => useAsk(business, { handled: 0, needs: 0 }, (key) => key), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current!.send('Prepare the quotation'));
    await waitFor(() => expect(result.current!.messages[1].state).toBe('failed'));
    expect(result.current!.messages[1]).toMatchObject({ runId, taskTitle: 'Prepare the quotation' });
    expect(localStorage.getItem('jentera-ask-sessions-v1:task-recovery')).toContain(runId);
  });
});

describe('useAsk keeps accounts apart on a shared browser', () => {
  const repo: Repository = new LocalRepository();
  repo.ask = async () => ({ text: 'private answer', usedKeys: [], grounded: false });
  const wrapperFor = (account: string) => ({ children }: { children: ReactNode }) => (
    <SignedInProvider value account={account}>
      <RepositoryProvider repository={repo}>{children}</RepositoryProvider>
    </SignedInProvider>
  );
  const render = (account: string) => renderHook(
    () => useAsk(business, { handled: 0, needs: 0 }, (key) => key),
    { wrapper: wrapperFor(account) },
  );

  it('never shows one account the conversations of another', async () => {
    const first = render('user-1');
    await waitFor(() => expect(first.result.current).not.toBeNull());
    act(() => first.result.current!.send('my private question'));
    await waitFor(() => expect(first.result.current!.messages[1].text).toBe('private answer'));
    await waitFor(() => expect(localStorage.getItem('jentera-ask-sessions-v1:user-1'))
      .toContain('my private question'));
    first.unmount();

    const other = render('user-2');
    await waitFor(() => expect(other.result.current).not.toBeNull());
    expect(other.result.current!.messages).toEqual([]);
    expect(other.result.current!.sessions.every((session) => session.messages.length === 0))
      .toBe(true);
    other.unmount();

    const again = render('user-1');
    await waitFor(() => expect(again.result.current).not.toBeNull());
    expect(again.result.current!.messages.map((message) => message.text)).toEqual([
      'my private question', 'private answer',
    ]);
  });

  it('does not resurrect history saved before accounts were separated', async () => {
    /* The old single global key belonged to whoever used the browser last.
       Attributing it to the next account to sign in is the leak itself. */
    localStorage.setItem('jentera-ask-sessions-v1', JSON.stringify([{
      id: 'legacy', title: 'someone else', createdAt: 1, updatedAt: 1,
      messages: [{ from: 'you', text: 'previous owner secret' }, { from: 'ai', text: 'ok' }],
    }]));
    sessionStorage.setItem('jentera-ask-history-v1', JSON.stringify([
      { from: 'you', text: 'older secret' }, { from: 'ai', text: 'ok' },
    ]));
    const { result } = render('user-3');
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.messages).toEqual([]);
  });

  it('forgets every account on this browser when storage is cleared at sign-out', () => {
    localStorage.setItem('jentera-ask-sessions-v1:user-1', '[]');
    localStorage.setItem('jentera-ask-sessions-v1:user-2', '[]');
    localStorage.setItem('jentera-ask-sessions-v1', '[]');
    sessionStorage.setItem('jentera-ask-history-v1', '[]');
    localStorage.setItem('aisar-onboarded-v1', '1');
    clearAskStorage();
    expect(Object.keys(localStorage).filter((key) => key.startsWith('jentera-ask'))).toEqual([]);
    expect(sessionStorage.getItem('jentera-ask-history-v1')).toBeNull();
    // Unrelated flow gates are untouched.
    expect(localStorage.getItem('aisar-onboarded-v1')).toBe('1');
  });
});
