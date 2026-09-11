import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { PwaUpdateNotice } from '@/components/PwaUpdateNotice';

const wrap = (children: ReactNode) => (
  <RepositoryProvider repository={new LocalRepository()}>
    <I18nProvider>{children}</I18nProvider>
  </RepositoryProvider>
);

const updateServiceWorker = vi.fn(async () => undefined);
let needRefresh = true;
const setNeedRefresh = vi.fn((next: boolean) => { needRefresh = next; });

vi.mock('@/pwa/register', () => ({
  useRegisterSW: () => ({
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [false, vi.fn()] as const,
    updateServiceWorker,
  }),
}));

describe('PwaUpdateNotice', () => {
  it('offers a reload when a newer Jentera has been installed in the background', async () => {
    localStorage.setItem('aisar-lang', 'en');
    const user = userEvent.setup();
    render(wrap(<PwaUpdateNotice />));
    expect(await screen.findByRole('status')).toHaveTextContent('A new version of Jentera is ready.');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('can be put off until later', async () => {
    localStorage.setItem('aisar-lang', 'en');
    const user = userEvent.setup();
    render(wrap(<PwaUpdateNotice />));
    await user.click(await screen.findByRole('button', { name: 'Later' }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
