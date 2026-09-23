import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, TAKEOVER_GRACE_MS } from '@/pwa/apply-update';

/** Stands in for `navigator.serviceWorker`, which jsdom does not provide
    and which only needs to carry `controllerchange` here. */
function fakeContainer() {
  const listeners = new Set<() => void>();
  return {
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'controllerchange') listeners.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'controllerchange') listeners.delete(fn);
    }),
    takeOver: () => [...listeners].forEach(fn => fn()),
    get listening() { return listeners.size; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('applyUpdate', () => {
  it('asks the waiting worker to take over', () => {
    const updateServiceWorker = vi.fn(async () => undefined);
    const worker = fakeContainer();
    applyUpdate(updateServiceWorker, { worker: worker as unknown as ServiceWorkerContainer, reload: vi.fn() });
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('reloads when the new worker takes control', () => {
    const reload = vi.fn();
    const worker = fakeContainer();
    applyUpdate(vi.fn(), { worker: worker as unknown as ServiceWorkerContainer, reload });
    expect(reload).not.toHaveBeenCalled();
    worker.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  /* The plugin only reloads when it saw a controller at registration time.
     A page that had none — a first install, or a hard refresh — swapped
     workers and stayed on the old bundle with the notice still up. */
  it('reloads on takeover however the page was registered', () => {
    const reload = vi.fn();
    const worker = fakeContainer();
    applyUpdate(vi.fn(), { worker: worker as unknown as ServiceWorkerContainer, reload });
    worker.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  /* Another tab already took the update, so nothing is waiting, the
     skip-waiting message lands nowhere and no event ever follows. */
  it('reloads anyway when no worker takes control', () => {
    const reload = vi.fn();
    const worker = fakeContainer();
    applyUpdate(vi.fn(), { worker: worker as unknown as ServiceWorkerContainer, reload });
    vi.advanceTimersByTime(TAKEOVER_GRACE_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once, and stops listening, when both paths fire', () => {
    const reload = vi.fn();
    const worker = fakeContainer();
    applyUpdate(vi.fn(), { worker: worker as unknown as ServiceWorkerContainer, reload });
    worker.takeOver();
    vi.advanceTimersByTime(TAKEOVER_GRACE_MS * 2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.listening).toBe(0);
  });

  it('still reloads where there is no service worker at all', () => {
    const reload = vi.fn();
    applyUpdate(vi.fn(), { worker: undefined, reload });
    vi.advanceTimersByTime(TAKEOVER_GRACE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not let a refused message stop the reload', async () => {
    const reload = vi.fn();
    const worker = fakeContainer();
    applyUpdate(() => Promise.reject(new Error('no worker')), {
      worker: worker as unknown as ServiceWorkerContainer,
      reload,
    });
    await Promise.resolve();
    vi.advanceTimersByTime(TAKEOVER_GRACE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
