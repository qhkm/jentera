import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startUpdateChecks, UPDATE_CHECK_INTERVAL_MS } from '@/pwa/update-checks';

function registration(update = vi.fn(async () => undefined)) {
  return { reg: { update } as unknown as ServiceWorkerRegistration, update };
}

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('service worker update checks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it('asks for an update when the app comes back to the foreground', () => {
    const { reg, update } = registration();
    const stop = startUpdateChecks(reg);
    visibility('hidden');
    expect(update).not.toHaveBeenCalled();
    visibility('visible');
    expect(update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asks once an hour while the app stays open in the foreground', () => {
    const { reg, update } = registration();
    const stop = startUpdateChecks(reg);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stays quiet in the background, and after stop()', () => {
    const { reg, update } = registration();
    const stop = startUpdateChecks(reg);
    visibility('hidden');
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 3);
    expect(update).not.toHaveBeenCalled();
    stop();
    visibility('visible');
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).not.toHaveBeenCalled();
  });

  it('shrugs off a check the browser refuses', async () => {
    const { reg } = registration(vi.fn(async () => { throw new TypeError('Failed to update'); }));
    const stop = startUpdateChecks(reg);
    visibility('visible');
    await vi.runOnlyPendingTimersAsync();
    stop();
  });
});
