import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { BrowserCommand, BusinessBrowserState } from '@/lib/repo/types';
import BusinessBrowser from '@/routes/views/BusinessBrowser';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

it('takes control, keeps typed secrets out of storage, and only hands back explicitly', async () => {
  const user = userEvent.setup();
  const repo = new LocalRepository();
  const calls: BrowserCommand[] = [];
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command) calls.push(command);
    if (command?.action === 'frame') return { image: 'aW1hZ2U=', tabs: [] };
    return { enabled: true, paused: command?.action === 'claim' };
  });
  repo.businessBrowser = browser;
  render(<RepositoryProvider repository={repo}><I18nProvider><BusinessBrowser /></I18nProvider></RepositoryProvider>);
  await user.click(await screen.findByRole('button', { name: /open business browser/i }));
  await user.click(screen.getByRole('button', { name: /take control/i }));
  const input = await screen.findByPlaceholderText(/text or password/i);
  await user.type(input, 'test-password');
  await user.click(screen.getByRole('button', { name: /type into browser/i }));
  await waitFor(() => expect(calls.some((c) => c.action === 'text' && c.text === 'test-password')).toBe(true));
  expect(input).toHaveValue('');
  expect(JSON.stringify(localStorage)).not.toContain('test-password');
  await user.click(screen.getByRole('button', { name: /close browser/i }));
  expect(calls.some((c) => c.action === 'release')).toBe(false);
  await user.click(screen.getByRole('button', { name: /open business browser/i }));
  await user.click(screen.getByRole('button', { name: /hand back/i }));
  await waitFor(() => expect(calls.some((c) => c.action === 'release')).toBe(true));
  expect(new Set(calls.map((c) => c.controlId)).size).toBe(1);
});
