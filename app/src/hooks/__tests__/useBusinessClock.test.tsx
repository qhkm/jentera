import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBusinessClock } from '@/hooks/useBusinessClock';
import { malaysiaDay } from '@/lib/daily-brief';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('business date clock', () => {
  it('rolls over the Malaysia date and removes its timer on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T15:59:30Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result, unmount } = renderHook(() => useBusinessClock());
    expect(malaysiaDay(result.current)).toBe('2026-09-08');
    act(() => vi.advanceTimersByTime(60_000));
    expect(malaysiaDay(result.current)).toBe('2026-09-09');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('updates immediately when a background tab returns after midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T15:59:00Z'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { result, unmount } = renderHook(() => useBusinessClock());
    act(() => vi.advanceTimersByTime(120_000));
    expect(malaysiaDay(result.current)).toBe('2026-09-08');
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(malaysiaDay(result.current)).toBe('2026-09-09');
    unmount();
  });
});
