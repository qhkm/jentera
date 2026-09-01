import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAsk } from '@/hooks/useAsk';
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
    repo.ask = (question: string): Promise<AskAnswer> =>
      new Promise<AskAnswer>((resolve) => pending.set(question, resolve));
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
    repo.ask = async () => ({ text: 'Here is the answer', usedKeys: [], grounded: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SignedInProvider value>
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
      expect(localStorage.getItem('jentera-ask-sessions-v1')).toContain('Here is the answer'));
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
  });
});
