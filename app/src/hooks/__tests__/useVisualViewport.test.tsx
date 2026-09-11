import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisualViewport } from '@/hooks/useVisualViewport';

function Harness({ enabled = true }: { enabled?: boolean }) {
  const open = useVisualViewport(enabled);
  return <span>{open ? 'Keyboard open' : 'Keyboard closed'}</span>;
}

function viewport() {
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('visualViewport', vv);
  return vv;
}

afterEach(() => vi.unstubAllGlobals());

describe('keyboard viewport positioning', () => {
  it('follows both the keyboard resize and the browser pan, then restores on close', () => {
    const vv = viewport();
    render(<Harness />);
    act(() => {
      vv.height = 420;
      vv.offsetTop = 180;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByText('Keyboard open')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('420px');
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('180px');
    act(() => {
      vv.offsetTop = 220;
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('220px');
    act(() => {
      vv.height = 844;
      vv.offsetTop = 0;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByText('Keyboard closed')).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('kb-open');
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('0px');
  });

  it('does not treat pinch zoom or browser chrome as a keyboard', () => {
    const vv = viewport();
    render(<Harness />);
    act(() => {
      vv.height = 780;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByText('Keyboard closed')).toBeInTheDocument();
    act(() => {
      vv.scale = 2;
      vv.height = 390;
      vv.offsetTop = 100;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByText('Keyboard closed')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('780px');
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('0px');
  });

  it('removes viewport positioning and listeners when leaving chat', () => {
    const vv = viewport();
    const { rerender } = render(<Harness />);
    act(() => {
      vv.height = 420;
      vv.offsetTop = 180;
      vv.dispatchEvent(new Event('resize'));
    });
    rerender(<Harness enabled={false} />);
    act(() => vv.dispatchEvent(new Event('scroll')));
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('');
    expect(document.documentElement).not.toHaveClass('kb-open');
    expect(screen.getByText('Keyboard closed')).toBeInTheDocument();
  });

  it('falls back to CSS when the visual viewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    render(<Harness />);
    expect(screen.getByText('Keyboard closed')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--vv-offset-top')).toBe('');
  });
});
