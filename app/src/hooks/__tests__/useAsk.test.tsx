import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
      resolveAnswer?.({ text: 'done', usedKeys: [], grounded: false });
    });
    expect(result.current!.messages[1].text).toBe('done');
  });
});
