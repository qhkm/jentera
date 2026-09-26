import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { PwaUpdateNotice } from '@/components/PwaUpdateNotice';
import { applyUpdate } from '@/pwa/apply-update';

const wrap = (children: ReactNode) => (
  <RepositoryProvider repository={new LocalRepository()}>
    <I18nProvider>{children}</I18nProvider>
  </RepositoryProvider>
);

const updateServiceWorker = vi.fn(async () => undefined);
let needRefresh = true;
const setNeedRefresh = vi.fn((next: boolean) => { needRefresh = next; });

vi.mock('@/pwa/apply-update', () => ({ applyUpdate: vi.fn() }));

let registered: { onNeedRefresh?: () => void } = {};

vi.mock('@/pwa/register', () => ({
  useRegisterSW: (options: { onNeedRefresh?: () => void }) => {
    registered = options;
    return {
      needRefresh: [needRefresh, setNeedRefresh] as const,
      offlineReady: [false, vi.fn()] as const,
      updateServiceWorker,
    };
  },
}));

/** This page as the build wrote it, and the worker the server has now. */
function runningBuild(entry: string) {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = `/assets/${entry}`;
  script.dataset.test = 'entry';
  document.head.append(script);
}
function servedWorker(...precached: string[]) {
  const fetcher = vi.fn(async () => new Response(
    `self.__WB_MANIFEST=[${precached.map((url) => `{url:"assets/${url}",revision:null}`).join(',')}]`,
  ));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(applyUpdate).mockClear();
  needRefresh = true;
  document.head.querySelectorAll('[data-test="entry"]').forEach((node) => node.remove());
});

describe('PwaUpdateNotice', () => {
  it('offers a reload when a newer Jentera has been installed in the background', async () => {
    localStorage.setItem('aisar-lang', 'en');
    const user = userEvent.setup();
    render(wrap(<PwaUpdateNotice />));
    expect(await screen.findByRole('status')).toHaveTextContent('A new version of Jentera is ready.');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    /* The reload itself is applyUpdate's: the plugin's own only fires when
       it saw a controller at registration time. See its tests. */
    expect(applyUpdate).toHaveBeenCalledWith(updateServiceWorker);
  });

  it('takes one tap, so a second cannot restart the wait', async () => {
    localStorage.setItem('aisar-lang', 'en');
    const user = userEvent.setup();
    render(wrap(<PwaUpdateNotice />));
    const reload = await screen.findByRole('button', { name: 'Reload' });
    await user.click(reload);
    expect(reload).toBeDisabled();
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('can be put off until later', async () => {
    localStorage.setItem('aisar-lang', 'en');
    const user = userEvent.setup();
    render(wrap(<PwaUpdateNotice />));
    await user.click(await screen.findByRole('button', { name: 'Later' }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
  });

  /* Pages load from the network first, so the first load after a deploy
     already runs the new build while the new worker waits behind the old
     one — and it went on waiting, prompting on every load, until Reload.
     Seen live on 26 September on a page already running that build. */
  it('keeps quiet when this page already runs the build the server has', async () => {
    localStorage.setItem('aisar-lang', 'en');
    runningBuild('index-NEW.js');
    const fetcher = servedWorker('index-NEW.js');
    render(wrap(<PwaUpdateNotice />));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers the reload once the server has a later build than this page', async () => {
    localStorage.setItem('aisar-lang', 'en');
    runningBuild('index-OLD.js');
    servedWorker('index-NEW.js');
    render(wrap(<PwaUpdateNotice />));
    expect(await screen.findByRole('status')).toHaveTextContent('A new version of Jentera is ready.');
  });

  it('asks again when a later worker arrives while the page stays open', async () => {
    localStorage.setItem('aisar-lang', 'en');
    runningBuild('index-NEW.js');
    const fetcher = servedWorker('index-NEW.js');
    render(wrap(<PwaUpdateNotice />));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    servedWorker('index-NEXT.js');
    act(() => registered.onNeedRefresh?.());
    expect(await screen.findByRole('status')).toHaveTextContent('A new version of Jentera is ready.');
  });

  it('stays inert inside the native shell', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    render(wrap(<PwaUpdateNotice />));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
