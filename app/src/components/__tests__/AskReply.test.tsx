import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { AskReply } from '@/components/AskReply';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { AskMessage } from '@/hooks/useAsk';

const RUN = '11111111-1111-4111-8111-111111111111';

function mount(message: AskMessage) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repository={new LocalRepository()}>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </RepositoryProvider>
  );
  return render(<AskReply message={message} onOpenActivity={() => {}} onRetry={() => {}} />, { wrapper });
}

/* Every reply used to become a task card. Conversation reads as a reply;
   only work, by request (deep) or by the server's verdict, gets the card. */
describe('AskReply: conversation versus work', () => {
  it('shows a plain reply for a quick answer the server called conversation', async () => {
    const { container } = mount({
      from: 'ai', text: 'Yes, Sunday too.', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'conversation', taskTitle: 'are we open on sunday?',
    });
    await waitFor(() => expect(container.textContent).toContain('Yes, Sunday too.'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
    expect(container.querySelector('.ask-reply-activity')).toBeNull();
  });

  it('shows the task card when the server called the run work', async () => {
    const { container } = mount({
      from: 'ai', text: 'Sent the reminder.', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'work', taskTitle: 'chase the late invoice',
    });
    await waitFor(() => expect(container.querySelector('.chat-task-card')).not.toBeNull());
  });

  it('does not infer a task from deep mode while the agent is running', async () => {
    const { container } = mount({
      from: 'ai', text: 'Working…', mode: 'work', runId: RUN, state: 'working',
      pendingId: 'p1', depth: 'deep', taskTitle: 'compare suppliers',
    });
    await waitFor(() => expect(container.textContent).toContain('Working…'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
  });

  it('keeps a completed deep explanation as chat', async () => {
    const { container } = mount({ from: 'ai', text: 'Explanation', mode: 'work', runId: RUN,
      state: 'done', depth: 'deep', kind: 'conversation' });
    await waitFor(() => expect(container.textContent).toContain('Explanation'));
    expect(container.querySelector('.chat-task-card')).toBeNull();
    expect(container.querySelector('.ask-reply-ready')).toBeNull();
  });

  it('shows Needs you instead of Done for a finished reply awaiting authorization', async () => {
    const { container } = mount({ from: 'ai', text: 'Authorize in your browser', mode: 'work', runId: RUN,
      state: 'done', kind: 'work', taskStatus: 'needs_input' });
    await waitFor(() => expect(container.querySelector('.chat-task-card')).toHaveTextContent('Needs you'));
    expect(container.querySelector('.ask-reply-ready')).toBeNull();
  });
});

describe('AskReply: the waiting bubble keeps moving', () => {
  /* Native Hermes shows something changing the whole time it works. Between
     two status lines nothing moved here for seconds, so the owner could not
     tell a slow reply from a dead one. */
  it('counts the seconds since the message was sent next to the status', async () => {
    const { container } = mount({
      from: 'ai', text: '💭 Thinking…', mode: 'work', state: 'working',
      pendingId: 'p2', depth: 'quick', startedAt: Date.now() - 3_000,
    });
    await waitFor(() => expect(container.textContent).toContain('💭 Thinking…'));
    await waitFor(() => expect(container.textContent).toMatch(/· [34]s/));
    await waitFor(() => expect(container.textContent).toMatch(/· [45]s/), { timeout: 3_000 });
  });

  it('shows what the agent is doing under answer text that has already started', async () => {
    const { container } = mount({
      from: 'ai', text: 'Let me check that for you.', mode: 'work', state: 'streaming',
      pendingId: 'p3', depth: 'quick', startedAt: Date.now() - 2_000,
      liveStatus: '🔎 web_search: KL weather now',
    });
    await waitFor(() => expect(container.textContent).toContain('Let me check that for you.'));
    expect(container.textContent).toContain('🔎 web_search: KL weather now');
    await waitFor(() => expect(container.textContent).toMatch(/· [23]s/));
  });
});
