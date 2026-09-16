import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function mountBrowser(browser: (command?: BrowserCommand) => Promise<BusinessBrowserState>, onPauseChange?: (paused: boolean) => void) {
  const repo = new LocalRepository();
  repo.businessBrowser = browser;
  return render(<RepositoryProvider repository={repo}><I18nProvider><BusinessBrowser onPauseChange={onPauseChange} /></I18nProvider></RepositoryProvider>);
}

const sampleFrame: BusinessBrowserState = { image: 'aW1hZ2U=', width: 1280, height: 800, tabs: [
  { index: 0, origin: 'https://accounts.google.com', selected: true },
  { index: 1, origin: 'null', selected: false },
] };

it('explains takeover before opening the live view, locks background scroll, and restores it on close', async () => {
  const user = userEvent.setup();
  const priorOverflow = document.body.style.overflow;
  document.body.style.overflow = 'clip';
  const browser = vi.fn(async (_command?: BrowserCommand) => ({ enabled: true, paused: false }));
  try {
    mountBrowser(browser);
    await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
    expect(await screen.findByText('Take over when you’re ready')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Browser handoff steps' })).toHaveTextContent('Sign in or verify');
    expect(screen.queryByRole('img')).toBeNull();
    expect(browser.mock.calls.every(([command]) => !command)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'Close browser view' }));
    expect(document.body.style.overflow).toBe('clip');
  } finally { document.body.style.overflow = priorOverflow; }
});

it('requires status to finish and offers a read-only retry after a connection error', async () => {
  const user = userEvent.setup();
  let finish: (value: BusinessBrowserState) => void = () => {};
  const browser = vi.fn<(command?: BrowserCommand) => Promise<BusinessBrowserState>>()
    .mockRejectedValueOnce(new Error('Computer unavailable.'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Computer unavailable.');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('button', { name: 'Take control' })).toBeDisabled();
  await act(async () => finish({ enabled: true, paused: false }));
  expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled();
  expect(browser.mock.calls.every(([command]) => !command)).toBe(true);
});

it('masks text by default, reveals only on request, and clears both content and reveal state after sending', async () => {
  const user = userEvent.setup();
  const browser = vi.fn(async (command?: BrowserCommand) => command?.action === 'frame' ? sampleFrame : { enabled: true, paused: true });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  const input = screen.getByLabelText('Text or password for the selected field');
  expect(input).toHaveAttribute('type', 'password');
  await user.type(input, 'synthetic-secret');
  await user.click(screen.getByRole('button', { name: 'Show typed text' }));
  expect(input).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide typed text' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Type into browser' }));
  await waitFor(() => expect(input).toHaveValue(''));
  expect(input).toHaveAttribute('type', 'password');
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-secret');
  expect(browser.mock.calls.some(([command]) => command?.action === 'text' && command.text === 'synthetic-secret')).toBe(true);
  expect(browser.mock.calls.some(([command]) => command?.action === 'key')).toBe(false);
});

it('keeps native screen coordinates, ignores coordinate-free clicks, and provides explicit keys, scrolling and tabs', async () => {
  const user = userEvent.setup();
  const browser = vi.fn(async (command?: BrowserCommand) => command?.action === 'frame' ? sampleFrame : { enabled: true, paused: true });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  const remote = screen.getByRole('button', { name: /^Business browser screen/ });
  vi.spyOn(remote, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 640, height: 400 } as DOMRect);
  fireEvent.click(remote, { detail: 0 });
  expect(browser.mock.calls.some(([command]) => command?.action === 'click')).toBe(false);
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(remote).toHaveStyle({ width: '125%' });
  expect(screen.getByRole('group', { name: 'Browser view zoom' })).toHaveTextContent('125%');
  await user.click(screen.getByRole('button', { name: 'Fit view' }));
  expect(remote).toHaveStyle({ width: '100%' });
  fireEvent.click(remote, { detail: 1, clientX: 340, clientY: 240 });
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'click' && command.x === 640 && command.y === 400)).toBe(true));
  await user.click(screen.getByRole('button', { name: 'Enter' }));
  await user.click(screen.getByText('More keys & scrolling'));
  await user.click(screen.getByRole('button', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Scroll down' }));
  await user.click(within(screen.getByRole('group', { name: 'Browser tabs' })).getByRole('button', { name: 'New tab' }));
  expect(browser.mock.calls.some(([command]) => command?.action === 'key' && command.key === 'Enter')).toBe(true);
  expect(browser.mock.calls.some(([command]) => command?.action === 'key' && command.key === 'ControlOrMeta+A')).toBe(true);
  expect(browser.mock.calls.some(([command]) => command?.action === 'scroll' && command.deltaY === 500)).toBe(true);
  expect(browser.mock.calls.some(([command]) => command?.action === 'tab' && command.index === 1)).toBe(true);
});

it('does not restore a closed live view after an in-flight claim, but still reports the durable pause', async () => {
  const user = userEvent.setup();
  let finish: (value: BusinessBrowserState) => void = () => {};
  let paused = false;
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command?.action === 'claim') return new Promise(resolve => { finish = value => { paused = true; resolve(value); }; });
    return { enabled: true, paused };
  });
  const pause = vi.fn();
  mountBrowser(browser, pause);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await user.click(screen.getByRole('button', { name: 'Close browser view' }));
  await act(async () => finish({ enabled: true, paused: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(pause).toHaveBeenLastCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'Open business browser' }));
  expect(await screen.findByRole('button', { name: 'Take control' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Hand back to Jentera' })).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(false);
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
  const input = await screen.findByLabelText(/text or password/i);
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

it('clears unsent credentials after a lost lease and explains successful hand-back without claiming sign-in', async () => {
  const user = userEvent.setup();
  let paused = false;
  const browser = vi.fn(async (command?: BrowserCommand) => {
    if (command?.action === 'claim') paused = true;
    if (command?.action === 'release') paused = false;
    if (command?.action === 'navigate') throw new Error('Browser control expired.');
    return command?.action === 'frame' ? sampleFrame : { enabled: true, paused };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  await user.type(screen.getByLabelText('Text or password for the selected field'), 'synthetic-unsent-secret');
  await user.click(screen.getByRole('button', { name: 'Show typed text' }));
  await user.type(screen.getByLabelText('Website address'), 'https://example.com');
  await user.click(screen.getByRole('button', { name: 'Go' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Browser control expired.');
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  expect(screen.getByLabelText('Text or password for the selected field')).toHaveValue('');
  expect(screen.getByLabelText('Text or password for the selected field')).toHaveAttribute('type', 'password');
  await user.click(screen.getByRole('button', { name: 'Hand back to Jentera' }));
  expect(await screen.findByText('Control handed back')).toBeVisible();
  expect(screen.getByText(/It will re-check access/)).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-unsent-secret');
  expect(browser.mock.calls.some(([command]) => command?.action === 'text')).toBe(false);
});
