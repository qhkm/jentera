import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAskStorage, useAsk } from '@/hooks/useAsk';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskAnswer, AskOptions, Repository } from '@/lib/repo';
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
    act(() => options?.onProgress?.('waking'));
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
