import { render, screen, act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTaskProgress } from '../LiveTaskProgress';
vi.mock('@/i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en' }),
  useT: () => (key: string, vars?: { n?: number }) => (({
    'ask.steps.earlier': `Show ${vars?.n} earlier steps`,
    'ask.steps.fewer': 'Show fewer',
  }) as Record<string, string>)[key] ?? key,
}));
vi.mock('@/hooks/useDetailLevel', () => ({ useDetailLevel: () => ({ advanced: false }) }));

afterEach(() => vi.useRealTimers());
describe('honest live progress', () => {
  it('uses compact grouped rows and an inline expansion, with no disclosure at all', () => {
    const view = render(<LiveTaskProgress steps={[
      `web_search: "${'first query '.repeat(8)}"`,
      `web_search: "${'second query '.repeat(8)}"`,
    ]} durable />);
    expect(screen.getByLabelText('2 steps')).toHaveTextContent('×2');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    /* The trail is the thing being read. Nothing about it is behind a click. */
    expect(view.container.querySelectorAll('details')).toHaveLength(0);
  });
  it('keeps task purpose over tool details but lets connection status override it', () => {
    const props = { steps: ['terminal: "python3"'], taskLabel: 'Checking your token usage', since: Date.now(), durable: true };
    const view = render(<LiveTaskProgress {...props} />);
    expect(screen.getByText('Checking your token usage')).toBeVisible();
    expect(screen.getByText('python3')).toBeVisible();
    expect(view.container.querySelectorAll('details')).toHaveLength(0);
    view.rerender(<LiveTaskProgress {...props} disconnected />);
    expect(screen.queryByText('Checking your token usage')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(view.container.querySelector('.ask-active-shimmer')).toBeNull();
  });
  it('shows previous steps and shimmers only the current action', () => {
    const props = { steps: ['🔍 web_search: "cache"', '🌐 web_extract: "https://example.com"', 'private narration'], since: Date.now(), durable: true };
    const view = render(<LiveTaskProgress {...props} />);
    const trail = view.container.querySelector('.ask-step-trail')!;
    expect(trail).toBeVisible();
    expect(trail.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('Continuing research');
    expect(view.container.querySelectorAll('.ask-active-shimmer')).toHaveLength(1);
    /* Narration still never appears as itself, inline or otherwise. */
    expect(screen.queryByText('private narration')).toBeNull();
    view.rerender(<LiveTaskProgress {...props} disconnected />);
    expect(view.container.querySelector('.ask-active-shimmer')).toBeNull();
  });

  it('holds a long trail to its last lines until the earlier ones are asked for', () => {
    const steps = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
      .map((word, i) => i % 2 ? `🔍 web_search: "${word}"` : `📖 read_file: "${word}.txt"`);
    const view = render(<LiveTaskProgress steps={steps} since={Date.now()} durable />);
    expect(view.container.querySelectorAll('.ask-step-trail li')).toHaveLength(6);
    expect(screen.queryByText('one.txt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 earlier steps' }));
    expect(view.container.querySelectorAll('.ask-step-trail li')).toHaveLength(8);
    expect(screen.getByText('one.txt')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(view.container.querySelectorAll('.ask-step-trail li')).toHaveLength(6);
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
