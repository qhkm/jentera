import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/App';

/* The worker is registered for every route, not only the ones that can show
   the update notice. It sat on the old landing page until 23 September,
   which `/` stopped rendering when LandingV3 took over: no public page
   registered a worker, so an owner arriving through /signin reached the app
   on a page no worker controlled — the one state in which vite-plugin-pwa
   refuses to reload on an update. */

const useRegisterSW = vi.fn(() => ({
  needRefresh: [false, vi.fn()] as const,
  offlineReady: [false, vi.fn()] as const,
  updateServiceWorker: async () => undefined,
}));

vi.mock('@/pwa/register', () => ({ useRegisterSW: (...args: unknown[]) => useRegisterSW(...(args as [])) }));

afterEach(() => {
  useRegisterSW.mockClear();
  localStorage.clear();
});

/** Every public route, which is where a visitor first meets the app. */
const PUBLIC_PATHS = ['/', '/ms', '/pricing', '/about', '/connect', '/privacy', '/terms', '/signin', '/access'];

describe('service worker registration', () => {
  it.each(PUBLIC_PATHS)('registers the worker on %s', async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await waitFor(() => expect(useRegisterSW).toHaveBeenCalled());
  });
});
