import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsk } from '@/hooks/useAsk';
import { LocalRepository } from '@/lib/repo/local';
import { RepositoryProvider } from '@/lib/repo/context';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskAnswer, Repository } from '@/lib/repo';
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
        key === 'ask.working' ? 'AISAR is working on this…' : key),
      { wrapper },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => {
      result.current!.send('first');
      result.current!.send('second');
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'AISAR is working on this…', 'second', 'AISAR is working on this…',
    ]);

    await act(async () => {
      pending.get('second')?.({ text: 'second answer', usedKeys: [], grounded: false });
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'AISAR is working on this…', 'second', 'second answer',
    ]);

    await act(async () => {
      pending.get('first')?.({ text: 'first answer', usedKeys: [], grounded: false });
    });
    expect(result.current!.messages.map((message) => message.text)).toEqual([
      'first', 'first answer', 'second', 'second answer',
    ]);
  });
});
