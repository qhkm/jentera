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
  /* The pause is durable on the sprite and outlives the viewer, so the fake
     holds it too. A fake that reported "not paused" to every status call
     described a browser that cannot get stuck, which is the one thing this
     screen has to handle. */
  let paused = false;
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command) calls.push(command);
    if (command?.action === 'claim') paused = true;
    if (command?.action === 'release') paused = false;
    if (command?.action === 'frame') return { image: 'aW1hZ2U=', tabs: [] };
    return { enabled: true, paused };
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

/* The trap this screen set on 15 September: an owner signing into Google ran
   past the ten-minute lease and every action started failing. The runner fix
   lets an expired controller hand back, but only if the screen offers the
   button — and after a reload, which is what an owner reaches for when a page
   seems stuck, it did not. `controlled` starts false, so the toolbar showed
   Take control alone while the browser sat paused behind it, refusing every
   task the agent was given. Paused is exactly when hand back has to be there. */
it('offers hand back on a reloaded page when the browser is paused by nobody', async () => {
  const user = userEvent.setup();
  const repo = new LocalRepository();
  const calls: BrowserCommand[] = [];
  // A fresh mount holds no lease, and the sprite reports the durable pause an
  // abandoned session left behind.
  let paused = true;
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command) calls.push(command);
    if (command?.action === 'release') { paused = false; return { enabled: true, paused }; }
    if (command?.action === 'claim') { paused = true; return { enabled: true, paused }; }
    return { enabled: true, paused };
  });
  repo.businessBrowser = browser;
  render(<RepositoryProvider repository={repo}><I18nProvider><BusinessBrowser /></I18nProvider></RepositoryProvider>);
  await user.click(await screen.findByRole('button', { name: /open business browser/i }));

  // Without claiming anything first: the browser is stuck and this is the way out.
  await user.click(await screen.findByRole('button', { name: /hand back/i }));
  await waitFor(() => expect(calls.some((c) => c.action === 'release')).toBe(true));
  expect(paused).toBe(false);
  expect(calls.some((c) => c.action === 'claim')).toBe(false);
});
