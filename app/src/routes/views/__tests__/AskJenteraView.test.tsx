import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import AskJenteraView from '@/routes/views/AskJenteraView';
import { AskReply } from '@/components/AskReply';
import { ToastProvider } from '@/components/Toast';
import { ActivityProvider } from '@/hooks/useActivity';
import { useBusiness } from '@/hooks/useBusiness';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { SignedInProvider } from '@/lib/repo/gate';
import type { AskAnswer } from '@/lib/repo';
import type { ReactNode } from 'react';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const { business } = useBusiness();
  return <AskJenteraView business={business} handled={0} needs={0} />;
}

async function mount(children: ReactNode = <Harness />, repo = new LocalRepository()) {
  await repo.setBizType('restaurant');
  await repo.setBizProfile({ name: 'Kedai Kita', loc: 'Shah Alam' });
  repo.activity = async () => ({
    counters: { handled: 0, needsYou: 0, minutesSaved: 0, thisWeek: 0, connections: 0 },
    work: [],
  });
  render(
    <SignedInProvider value account="ask-studio-test">
      <RepositoryProvider repository={repo}>
        <I18nProvider>
          <ToastProvider>
            <ActivityProvider>{children}</ActivityProvider>
          </ToastProvider>
        </I18nProvider>
      </RepositoryProvider>
    </SignedInProvider>,
  );
  return repo;
}

describe('compose-first Ask Jentera', () => {
  it('prepares a task without sending and keeps drafts with their own chats', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn();
    await mount(<Harness />, repo);
    const starters = await screen.findByRole('group', { name: 'Start with a task' });
    await user.click(within(starters).getByRole('button', { name: 'Draft a reply' }));
    const input = screen.getByRole('textbox');
    const draft = (input as HTMLTextAreaElement).value;
    expect(draft).toContain('customer');
    expect(repo.ask).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Past chats' }));
    await user.click(screen.getAllByRole('button', { name: 'Open chat: New chat' }).at(-1)!);
    expect(input).toHaveValue(draft);
  });

  it('allows a follow-up draft while work is pending, without sending it prematurely', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    let finish!: (answer: AskAnswer) => void;
    repo.ask = vi.fn(
      () =>
        new Promise<AskAnswer>((resolve) => {
          finish = resolve;
        }),
    );
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    await user.type(input, 'Prepare a reply');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(repo.ask).toHaveBeenCalledOnce());
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    await user.type(input, 'Make it suitable for a quotation');
    await user.keyboard('{Enter}');
    expect(repo.ask).toHaveBeenCalledOnce();
    expect(input).toHaveValue('Make it suitable for a quotation');
    await act(async () =>
      finish({
        text: 'Here is the draft.\n\nPlease review the delivery date.',
        grounded: false,
        usedKeys: [],
      }),
    );
    expect(await screen.findByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
    expect(send).toBeEnabled();
    expect(input).toHaveValue('Make it suitable for a quotation');
    await user.click(screen.getByRole('button', { name: 'Make it shorter' }));
    expect(repo.ask).toHaveBeenCalledOnce();
    expect(input).toHaveValue('Make your last answer shorter, keeping the important details.');
  });

  it('does not submit Enter during IME composition or Shift+Enter', async () => {
    const repo = new LocalRepository();
    repo.ask = vi.fn();
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(repo.ask).not.toHaveBeenCalled();
  });

  it('retries the failed question and keeps the work mode', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce({ text: 'Draft prepared.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    await user.type(await screen.findByRole('textbox'), 'Prepare a reply');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Try this again' }));
    expect(await screen.findByText('Draft prepared.')).toBeInTheDocument();
    expect(repo.ask).toHaveBeenLastCalledWith(
      'Prepare a reply',
      expect.objectContaining({ mode: 'work' }),
    );
  });
});

describe('usable replies', () => {
  it('copies the complete plain-text answer, preserving line breaks and treating HTML as text', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const text = 'First paragraph.\n\n<script>alert(1)</script>\n- One item';
    await mount(<AskReply message={{ from: 'ai', text, state: 'done' }} onRetry={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
    expect(copy).toHaveBeenCalledWith(text);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('reports a clipboard failure without pretending it copied', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
    await mount(<AskReply message={{ from: 'ai', text: 'Reply text' }} onRetry={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Copy reply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
    expect(screen.getByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
  });
});
