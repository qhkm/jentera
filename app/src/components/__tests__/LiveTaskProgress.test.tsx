import { render, screen, act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTaskProgress } from '../LiveTaskProgress';
vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en' }) }));
vi.mock('@/hooks/useDetailLevel', () => ({ useDetailLevel: () => ({ advanced: false }) }));

afterEach(() => vi.useRealTimers());
describe('honest live progress', () => {
  it('keeps task purpose over tool details but lets connection status override it', () => {
    const props = { steps: ['terminal: "python3"'], taskLabel: 'Checking your token usage', since: Date.now(), durable: true };
    const view = render(<LiveTaskProgress {...props} />);
    expect(screen.getByText('Checking your token usage')).toBeVisible();
    expect(screen.getByText('View activity · 1')).toBeVisible();
    expect(view.container.querySelectorAll('details')).toHaveLength(1);
    expect(view.container.querySelector('details')).not.toHaveAttribute('open');
    view.rerender(<LiveTaskProgress {...props} disconnected />);
    expect(screen.queryByText('Checking your token usage')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(view.container.querySelector('.ask-active-shimmer')).toBeNull();
  });
  it('collapses previous steps and shimmers only the current action', () => {
    const props = { steps: ['🔍 web_search: "cache"', '🌐 web_extract: "https://example.com"', 'private narration'], since: Date.now(), durable: true };
    const view = render(<LiveTaskProgress {...props} />);
    const history = view.container.querySelector('details')!;
    expect(history).not.toHaveAttribute('open');
    expect(screen.getByText('View activity · 3')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Continuing research');
    expect(view.container.querySelectorAll('.ask-active-shimmer')).toHaveLength(1);
    expect(screen.queryByText('private narration')).toBeNull();
    fireEvent.click(screen.getByText('View activity · 3'));
    expect(history).toHaveAttribute('open');
    view.rerender(<LiveTaskProgress {...props} disconnected />);
    expect(view.container.querySelector('.ask-active-shimmer')).toBeNull();
  });
  it('resumes the live label only after fresh progress arrives', () => {
    const now = Date.now();
    const view = render(<LiveTaskProgress steps={[]} label="Thinking…" since={now - 90000} lastProgressAt={now - 90000} durable />);
    expect(screen.queryByText('Thinking…')).toBeNull();
    view.rerender(<LiveTaskProgress steps={[]} label="Thinking…" since={now - 90000} lastProgressAt={now} durable />);
    expect(screen.getByText('Thinking…')).toBeVisible();
    expect(view.container.querySelector('.bubble .typing')).not.toBeNull();
  });
  it('shows a known tool, then reports silence without claiming it stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));
    const now = Date.now();
    const view = render(<LiveTaskProgress steps={['💻 terminal: "codex"']} since={now} lastProgressAt={now} durable />);
    expect(screen.getByText('codex')).not.toBeVisible();
    fireEvent.click(screen.getByText('View activity · 1'));
    expect(screen.getByText('codex')).toBeVisible();
    expect(view.container.firstElementChild).not.toHaveClass('border');
    expect(view.container.querySelector('.ask-step-dot')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(78000); });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for an update');
    expect(screen.getByText(/No new progress update for 1m 18s/)).toBeVisible();
    expect(view.container.querySelector('.ask-step-dot')).toBeNull();
    view.unmount();
  });
  it('shows connection recovery and never presents raw commands', () => {
    render(<LiveTaskProgress steps={['💻 terminal: "codex --secret hidden-value"']} disconnected durable={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.queryByText(/hidden-value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/You can leave/)).not.toBeInTheDocument();
  });
});
