import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTaskProgress } from '../LiveTaskProgress';
vi.mock('@/i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en' }) }));
vi.mock('@/hooks/useDetailLevel', () => ({ useDetailLevel: () => ({ advanced: false }) }));

afterEach(() => vi.useRealTimers());
describe('honest live progress', () => {
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
    expect(view.container.querySelector('details')).toBeNull();
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
