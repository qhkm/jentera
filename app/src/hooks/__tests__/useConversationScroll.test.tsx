import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationScroll } from '@/hooks/useConversationScroll';
import type { AskMessage } from '@/hooks/useAsk';

function Harness({
  messages,
  session = 'one',
  active = true,
}: {
  messages: AskMessage[];
  session?: string;
  active?: boolean;
}) {
  const scroll = useConversationScroll(messages, session, active);
  return (
    <>
      <div data-testid="scroll" ref={scroll.viewport} onScroll={scroll.onScroll} />
      <button onClick={scroll.jumpToLatest}>Latest</button>
      <span>{scroll.unread ? 'Unread' : 'Read'}</span>
    </>
  );
}
const first: AskMessage[] = [{ from: 'you', text: 'Question' }];
const next: AskMessage[] = [...first, { from: 'ai', text: 'Answer' }];

function measurements() {
  const viewport = screen.getByTestId('scroll');
  Object.defineProperties(viewport, {
    scrollHeight: { value: 2000, configurable: true },
    clientHeight: { value: 400, configurable: true },
  });
  return viewport;
}

describe('conversation scroll ownership', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('moves progressively during text growth and lets an upward wheel stop it', async () => {
    const { rerender } = render(<Harness messages={first} />);
    const viewport = measurements();
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
    viewport.scrollTop = 1600;
    fireEvent.scroll(viewport);
    Object.defineProperty(viewport, 'scrollHeight', { value: 2800, configurable: true });
    rerender(<Harness messages={next} />);
    expect(viewport.scrollTop).toBe(1600);
    await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(1600));
    expect(viewport.scrollTop).toBeLessThan(2400);
    fireEvent.wheel(viewport, { deltaY: -20 });
    const stopped = viewport.scrollTop;
    rerender(<Harness messages={[...next, { from: 'ai', text: 'More text' }]} />);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(viewport.scrollTop).toBe(stopped);
    expect(screen.getByText('Unread')).toBeInTheDocument();
  });

  it('does not animate when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { rerender } = render(<Harness messages={first} />);
    const viewport = measurements();
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
    Object.defineProperty(viewport, 'scrollHeight', { value: 2600, configurable: true });
    rerender(<Harness messages={next} />);
    expect(viewport.scrollTop).toBe(2600);
  });
  it('does not move someone reading earlier messages when a response arrives', async () => {
    const { rerender } = render(<Harness messages={first} />);
    const viewport = measurements();
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    rerender(<Harness messages={next} />);
    expect(viewport.scrollTop).toBe(120);
    expect(screen.getByText('Unread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(viewport.scrollTop).toBe(2000);
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('follows updates again after the owner returns to the bottom', async () => {
    const { rerender } = render(<Harness messages={first} />);
    const viewport = measurements();
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
    viewport.scrollTop = 1600;
    fireEvent.scroll(viewport);
    Object.defineProperty(viewport, 'scrollHeight', { value: 2400, configurable: true });
    rerender(<Harness messages={next} />);
    await waitFor(() => expect(viewport.scrollTop).toBe(2400));
  });

  it('opens another chat at the latest message without marking unchanged text unread', async () => {
    const { rerender } = render(<Harness messages={first} />);
    const viewport = measurements();
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    rerender(<Harness messages={first} active={false} />);
    rerender(<Harness messages={first} />);
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(viewport.scrollTop).toBe(120);
    rerender(<Harness messages={next} session="two" />);
    await waitFor(() => expect(viewport.scrollTop).toBe(2000));
  });
});
