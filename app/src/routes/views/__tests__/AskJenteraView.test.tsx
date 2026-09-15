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

function Harness({ onOpenConnections }: { onOpenConnections?: () => void } = {}) {
  const { business } = useBusiness();
  return <AskJenteraView
    business={business}
    handled={0}
    needs={0}
    onOpenConnections={onOpenConnections}
  />;
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
  it('attaches an Excel file to a question and can send the file on its own', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn().mockResolvedValue({ text: 'The totals do not match.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    const file = new File(['workbook'], 'sales.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await user.upload(await screen.findByLabelText('Choose a file for Jentera'), file);
    expect(screen.getByText('sales.xlsx')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replace file' })).toBeVisible();
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(repo.ask).toHaveBeenCalledWith(
      'Review this file and tell me what stands out.',
      expect.objectContaining({ attachment: file, mode: 'work' }),
    ));
    expect(vi.mocked(repo.ask).mock.calls[0]?.[1]).not.toHaveProperty('responseMode');
    expect(screen.getByText('sales.xlsx')).toBeVisible();
  });
  it('routes the request automatically instead of asking the user to choose an answer mode', async () => {
    await mount();
    expect(await screen.findByRole('textbox')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Answer mode' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Research' })).toBeNull();
  });
  it('explains owner browser control, blocks sending, and links to the hand-back control', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const openConnections = vi.fn();
    repo.businessBrowser = vi.fn().mockResolvedValue({ enabled: true, paused: true });
    repo.ask = vi.fn().mockResolvedValue({ text: 'Should not send.', grounded: false, usedKeys: [] });
    await mount(<Harness onOpenConnections={openConnections} />, repo);

    expect(await screen.findByText('Jentera is paused')).toBeVisible();
    expect(screen.getByText(/Business Browser is still under owner control/)).toBeVisible();
    const input = screen.getByRole('textbox');
    await user.type(input, 'Prepare a reply');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(repo.ask).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open Business Browser' }));
    expect(openConnections).toHaveBeenCalledOnce();
  });
  it('shows an accuracy disclaimer associated with the composer', async () => {
    await mount();
    const input = await screen.findByRole('textbox');
    const disclaimer = screen.getByText('Jentera can make mistakes. Verify important information before acting.');
    expect(disclaimer).toBeVisible();
    expect(disclaimer.closest('p')).toHaveClass('ask-ai-disclaimer');
    expect(input).toHaveAttribute('aria-describedby', disclaimer.closest('p')!.id);
  });
  it('shows the disclaimer in Bahasa Malaysia', async () => {
    const repo = new LocalRepository();
    await repo.setLang('bm');
    await mount(<Harness />, repo);
    expect(await screen.findByText('Jentera boleh tersilap. Semak maklumat penting sebelum bertindak.')).toBeVisible();
  });
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

  it('accepts another message while earlier work is still pending', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    const finishes: Array<(answer: AskAnswer) => void> = [];
    repo.ask = vi.fn(
      () =>
        new Promise<AskAnswer>((resolve) => {
          finishes.push(resolve);
        }),
    );
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    await user.type(input, 'Prepare a reply');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(repo.ask).toHaveBeenCalledOnce());
    expect(screen.getByText('Jentera can make mistakes. Verify important information before acting.')).toBeVisible();
    await user.type(input, 'Make it suitable for a quotation');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(repo.ask).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('');
    await act(async () =>
      finishes[0]({
        text: 'Here is the draft.\n\nPlease review the delivery date.',
        grounded: false,
        usedKeys: [],
      }),
    );
    expect(await screen.findByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
    await act(async () =>
      finishes[1]({
        text: 'I made it suitable for a quotation.',
        grounded: false,
        usedKeys: [],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Make it shorter' }));
    expect(input).toHaveValue('Make your last answer shorter, keeping the important details.');
  });

  it('uses Enter for line breaks and submits only with Cmd/Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const repo = new LocalRepository();
    repo.ask = vi.fn().mockResolvedValue({ text: 'Done.', grounded: false, usedKeys: [] });
    await mount(<Harness />, repo);
    const input = await screen.findByRole('textbox');
    await user.type(input, 'First line{Enter}Second line');
    expect(input).toHaveValue('First line\nSecond line');
    expect(repo.ask).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(repo.ask).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(repo.ask).toHaveBeenCalledWith('你好', expect.objectContaining({ mode: 'work' }));
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
