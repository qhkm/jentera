import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('AskReply: the agent\'s steps', () => {
  /* "@step:" lines used to replace one label, and once leaked into the reply
     as text. They are the agent narrating its work, so they read as a list:
     done steps ticked, the current one moving, and the whole list kept as a
     small receipt under the finished answer. */
  it('lists the steps while working, with the latest one current', async () => {
    const { container } = mount({
      from: 'ai', text: '💭 Thinking…', mode: 'work', state: 'working', pendingId: 'p4', depth: 'quick',
      startedAt: Date.now() - 2_000,
      steps: ['Searching for today\'s headlines', '🌐 web_extract: "https://www.malaymail.com/"'],
    });
    await waitFor(() => expect(container.querySelector('.ask-steps')).not.toBeNull());
    const items = Array.from(container.querySelectorAll('.ask-steps li'));
    expect(items.map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Searching for today'), expect.stringContaining('web_extract')]),
    );
    expect(items.at(-1)?.getAttribute('aria-current')).toBe('step');
    expect(items[0].getAttribute('aria-current')).toBeNull();
  });

  it('keeps the steps as a collapsed receipt under the finished answer', async () => {
    const { container } = mount({
      from: 'ai', text: 'Top stories today: …', mode: 'work', runId: RUN, state: 'done',
      depth: 'quick', kind: 'work', taskTitle: 'news', steps: ['Searching', 'Reading Malay Mail', 'Summarising'],
    });
    await waitFor(() => expect(container.textContent).toContain('Top stories today'));
    const receipt = container.querySelector('details.ask-reply-steps');
    expect(receipt).not.toBeNull();
    expect(receipt?.querySelector('summary')?.textContent).toContain('3');
    expect(receipt?.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('AskReply: files the agent produced', () => {
  it('offers each file as a download, named and sized', async () => {
    const repo = new LocalRepository();
    repo.artifactUrl = (id: string) => `https://api.test/api/artifacts/${id}`;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    );
    const message: AskMessage = {
      from: 'ai', text: 'Your digest is attached.', state: 'done', runId: RUN, taskTitle: 'digest', mode: 'work', kind: 'conversation',
      artifacts: [
        { id: 'a1', runId: RUN, name: 'tech-digest.md', contentType: 'text/markdown', size: 5321, createdAt: '2026-09-12T01:00:00.000Z' },
        { id: 'a2', runId: RUN, name: 'sources.csv', contentType: 'text/csv', size: 640, createdAt: '2026-09-12T01:00:00.000Z' },
      ],
    };
    render(<AskReply message={message} onOpenActivity={() => {}} onRetry={() => {}} />, { wrapper });
    const list = await screen.findByRole('list', { name: 'Files' });
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([expect.stringContaining('tech-digest.md'), expect.stringContaining('sources.csv')]);
    expect(links[0]).toHaveAttribute('href', 'https://api.test/api/artifacts/a1');
    expect(links[0]).toHaveAttribute('download', 'tech-digest.md');
    expect(links[0]).toHaveTextContent('5.2 KB');
    expect(links[1]).toHaveTextContent('640 B');
  });
});
