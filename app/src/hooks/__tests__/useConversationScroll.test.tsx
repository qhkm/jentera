import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
