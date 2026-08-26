/* ============================================================
   The approval inbox.

   The screen where a person decides whether something reaches a
   customer. Its correctness is not "does it render" — it is that the
   send carries what the owner actually saw, that declining is as easy
   as approving, and that a failure says so instead of quietly looking
   like success.
   ============================================================ */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalInbox from '../ApprovalInbox';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Approval } from '@/lib/types';

const reply: Approval = {
  id: 1,
  remoteId: 'a-1',
  conn: 'telegram',
  op: 'send_message',
  args: {
    from: 'Aminah',
    question: 'Are you open on Sunday?',
    draft: 'Yes, we are open 11am to 10pm.',
    chatId: 42,
    connectionId: 'c-1',
  },
  risk: 'medium',
  ts: '2026-08-26T10:00:00.000Z',
  status: 'pending',
};

/** A repository that records how decideApproval was called. */
function repoSpy(behaviour: 'ok' | 'throw' = 'ok') {
  const calls: { id: number; approved: boolean; text?: string }[] = [];
  const repo = new LocalRepository();
  repo.decideApproval = async (id: number, approved: boolean, text?: string) => {
    calls.push({ id, approved, text });
    if (behaviour === 'throw') throw new Error('Telegram would not deliver that message');
  };
  return { repo, calls };
}

function mount(approvals: Approval[], repo: LocalRepository, onDecided = () => {}) {
  return render(
    <RepositoryProvider repository={repo}>
      <ApprovalInbox approvals={approvals} onDecided={onDecided} />
    </RepositoryProvider>,
  );
}

describe('showing what is waiting', () => {
  it('shows the question and the draft', async () => {
    const { repo } = repoSpy();
    mount([reply], repo);
    await screen.findByText('Are you open on Sunday?');
    expect(screen.getByRole('textbox')).toHaveValue('Yes, we are open 11am to 10pm.');
    expect(screen.getByText(/Reply to Aminah on Telegram/)).toBeTruthy();
  });

  it('says plainly that nothing has been sent', async () => {
    /* The owner has to know the state before deciding: this is a
       draft, not a copy of something already delivered. */
    const { repo } = repoSpy();
    mount([reply], repo);
    await waitFor(() => expect(screen.getByText(/Nothing here has been sent/i)).toBeTruthy());
  });

  it('renders nothing at all when the queue is empty', () => {
    const { repo } = repoSpy();
    const { container } = mount([], repo);
    expect(container.textContent).toBe('');
  });

  it('offers declining as prominently as approving', async () => {
    /* Both are buttons of equal weight. A queue whose easy action is
       "yes" teaches people to stop reading it. */
    const { repo } = repoSpy();
    mount([reply], repo);
    await screen.findByRole('button', { name: /send it/i });
    expect(screen.getByRole('button', { name: /don.t send/i })).toBeTruthy();
  });
});

describe('deciding', () => {
  it('sends the draft unchanged when it was not edited', async () => {
    const { repo, calls } = repoSpy();
    mount([reply], repo);
    await userEvent.click(await screen.findByRole('button', { name: /send it/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].approved).toBe(true);
    // No text: the server keeps the draft it already has.
    expect(calls[0].text).toBeUndefined();
  });

  it('sends the owner’s wording when they changed it', async () => {
    /* What they send must be what they saw. Sending the model's
       original after someone edited it would be the worst possible
       failure on this screen. */
    const { repo, calls } = repoSpy();
    mount([reply], repo);
    const box = await screen.findByRole('textbox');
    await userEvent.clear(box);
    await userEvent.type(box, 'Yes! Open 11-10, parking behind.');
    await userEvent.click(screen.getByRole('button', { name: /send my version/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].text).toBe('Yes! Open 11-10, parking behind.');
  });

  it('changes the button once the draft differs, so the change is visible', async () => {
    const { repo } = repoSpy();
    mount([reply], repo);
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, ' Extra.');
    await waitFor(() => expect(screen.getByRole('button', { name: /send my version/i })).toBeTruthy());
    expect(screen.getByText(/AISAR will learn from the change/i)).toBeTruthy();
  });

  it('does not treat whitespace as an edit', async () => {
    const { repo, calls } = repoSpy();
    mount([reply], repo);
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, '   ');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].text).toBeUndefined();
  });

  it('records a refusal', async () => {
    const { repo, calls } = repoSpy();
    mount([reply], repo);
    await userEvent.click(await screen.findByRole('button', { name: /don.t send/i }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].approved).toBe(false);
  });

  it('will not send an empty reply', async () => {
    const { repo, calls } = repoSpy();
    mount([reply], repo);
    await userEvent.clear(await screen.findByRole('textbox'));
    const send = screen.getByRole('button', { name: /send it|send my version/i });
    expect(send).toBeDisabled();
    await userEvent.click(send);
    expect(calls).toHaveLength(0);
  });

  it('tells the parent to refresh once a decision lands', async () => {
    const { repo } = repoSpy();
    const onDecided = vi.fn();
    mount([reply], repo, onDecided);
    await userEvent.click(await screen.findByRole('button', { name: /send it/i }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledOnce());
  });
});

describe('when the send fails', () => {
  it('says so rather than looking like it worked', async () => {
    const { repo } = repoSpy('throw');
    const onDecided = vi.fn();
    mount([reply], repo, onDecided);
    await userEvent.click(await screen.findByRole('button', { name: /send it/i }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/would not deliver/i);
    // The row stays: the owner still has a decision outstanding.
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('lets them try again', async () => {
    const { repo } = repoSpy('throw');
    mount([reply], repo);
    await userEvent.click(await screen.findByRole('button', { name: /send it/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /send it/i })).not.toBeDisabled();
  });
});
