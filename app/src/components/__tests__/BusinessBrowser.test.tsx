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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
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

it('offers explicit window recovery after a conflict and keeps the agent paused until hand-back', async () => {
  const user = userEvent.setup();
  const pause = vi.fn();
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command?.action === 'claim') throw new Error('Another window is controlling this browser.');
    if (command?.action === 'frame') return sampleFrame;
    return { enabled: true, controlRecovery: 1, paused: command?.action !== 'release' };
  });
  mountBrowser(browser, pause);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  expect(screen.queryByRole('button', { name: 'Use this window' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  const recovery = await screen.findByRole('region', { name: 'Continue in this window?' });
  expect(recovery).toHaveTextContent('This disconnects your previous window.');
  expect(browser.mock.calls.some(([command]) => command?.action === 'reclaim')).toBe(false);
  expect(screen.queryByRole('img')).toBeNull();
  await user.click(within(recovery).getByRole('button', { name: 'Use this window' }));
  await screen.findByRole('img');
  expect(screen.queryByRole('region', { name: 'Continue in this window?' })).toBeNull();
  expect(pause).toHaveBeenLastCalledWith(true);
  expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Hand back to Jentera' }));
  expect(pause).toHaveBeenLastCalledWith(false);
});

it('does not offer unsupported recovery on an older runtime', async () => {
  const user = userEvent.setup();
  const browser = vi.fn(async (command?: BrowserCommand) => {
    if (command?.action === 'claim') throw new Error('Another window is controlling this browser.');
    return { enabled: true, paused: true };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Use this window' })).toBeNull();
  expect(browser.mock.calls.some(([command]) => command?.action === 'reclaim')).toBe(false);
});

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

it('starts the page-only viewer enlarged on phones and still offers a fitted overview', async () => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const user = userEvent.setup();
  const browser = vi.fn(async (command?: BrowserCommand) => command?.action === 'frame' ? sampleFrame : { enabled: true, paused: true });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  const remote = await screen.findByRole('button', { name: /^Business browser screen/ });
  expect(remote).toHaveStyle({ width: '200%' });
  expect(screen.getByRole('group', { name: 'Browser view zoom' })).toHaveTextContent('200%');
  await user.click(screen.getByRole('button', { name: 'Fit view' }));
  expect(remote).toHaveStyle({ width: '100%' });
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

const TARGET = '33333333-3333-4333-8333-333333333333';
const directFrame = (sequence = 1, kind: 'text' | 'password' = 'text'): BusinessBrowserState => ({ ...sampleFrame,
  directTyping: 1, inputTarget: { id: TARGET, kind, nextSequence: sequence } });

it('focuses the keyboard on screen tap, types/pastes directly, forwards keys and leaves no local plaintext', async () => {
  const user = userEvent.setup();
  let sequence = 1;
  const browser = vi.fn(async (command?: BrowserCommand) => {
    if (command?.action === 'input') sequence++;
    return ['frame', 'click', 'input'].includes(command?.action ?? '') ? directFrame(sequence, 'password') : { paused: true };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  const proxy = screen.getByLabelText('Live browser keyboard');
  expect(proxy).toHaveAttribute('readonly');
  const remote = screen.getByRole('button', { name: /^Business browser screen/ });
  vi.spyOn(remote, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 640, height: 400 } as DOMRect);
  fireEvent.click(remote, { detail: 1, clientX: 100, clientY: 100 });
  expect(proxy).toHaveFocus();
  await screen.findByText('Keyboard connected — type or paste');
  expect(proxy).toHaveAttribute('type', 'password');
  // Chromium can place the caret before the invisible mobile-delete marker
  // after switching keyboard modes. The marker must never reach the site.
  fireEvent.input(proxy, { target: { value: 'x\u200b' } });
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.text === 'x')).toBe(true));
  fireEvent.input(proxy, { target: { value: '\u200bsynthetic-direct-secret' } });
  expect(proxy).toHaveValue('\u200b');
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.text === 'synthetic-direct-secret')).toBe(true));
  await user.keyboard('{Backspace}{Enter}');
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.key === 'Enter')).toBe(true));
  expect(browser.mock.calls.filter(([command]) => command?.action === 'input').map(([command]) => command && 'sequence' in command ? command.sequence : null)).toEqual([1, 2, 3, 4]);
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-direct-secret');
  await user.keyboard('{Escape}');
  expect(proxy).not.toHaveFocus();
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(false);
});

it('commits IME composition once and supports native mobile deletion without a Type button', async () => {
  const user = userEvent.setup();
  let sequence = 1;
  const browser = vi.fn(async (command?: BrowserCommand) => {
    if (command?.action === 'input') sequence++;
    return ['frame', 'click', 'input'].includes(command?.action ?? '') ? directFrame(sequence) : { paused: true };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: /^Business browser screen/ }), { detail: 1 });
  await screen.findByText('Keyboard connected — type or paste');
  const proxy = screen.getByLabelText('Live browser keyboard');
  fireEvent.compositionStart(proxy);
  fireEvent.input(proxy, { target: { value: '\u200b你好' }, isComposing: true });
  expect(browser.mock.calls.some(([command]) => command?.action === 'input')).toBe(false);
  fireEvent.compositionEnd(proxy);
  fireEvent.input(proxy);
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.text === '你好')).toBe(true));
  fireEvent(proxy, new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.key === 'Backspace')).toBe(true));
  expect(browser.mock.calls.filter(([command]) => command?.action === 'input' && command.text === '你好')).toHaveLength(1);
});

it('does not send queued direct input or reopen a closed viewer after a slow selection', async () => {
  const user = userEvent.setup();
  let finish!: (value: BusinessBrowserState) => void;
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => {
    if (command?.action === 'click') return new Promise(resolve => { finish = resolve; });
    return command?.action === 'frame' ? directFrame() : { paused: true };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: /^Business browser screen/ }), { detail: 1 });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const proxy = screen.getByLabelText('Live browser keyboard');
  fireEvent.input(proxy, { target: { value: '\u200bunsent-secret' } });
  await user.click(screen.getByRole('button', { name: 'Close browser view' }));
  await act(async () => finish(directFrame()));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(browser.mock.calls.some(([command]) => command?.action === 'input' || command?.action === 'release')).toBe(false);
});

it('uses the same field guard for the paste box and clears direct typing on loss of control', async () => {
  const user = userEvent.setup();
  let expired = false;
  const browser = vi.fn(async (command?: BrowserCommand) => {
    if (command?.action === 'input' && expired) throw new Error('Your browser control expired.');
    return ['frame', 'click', 'input'].includes(command?.action ?? '') ? directFrame(command?.action === 'input' ? 2 : 1, 'password') : { paused: true };
  });
  mountBrowser(browser);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('img');
  await user.type(screen.getByLabelText('Text or password for the selected field'), 'guarded-paste');
  expect(screen.getByRole('button', { name: 'Type into browser' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /^Business browser screen/ }), { detail: 1 });
  await screen.findByText('Keyboard connected — type or paste');
  await user.click(screen.getByRole('button', { name: 'Type into browser' }));
  await waitFor(() => expect(browser.mock.calls.some(([command]) => command?.action === 'input' && command.text === 'guarded-paste')).toBe(true));
  expect(browser.mock.calls.some(([command]) => command?.action === 'text')).toBe(false);
  expired = true;
  const proxy = screen.getByLabelText('Live browser keyboard');
  fireEvent.input(proxy, { target: { value: '\u200bexpire-now' } });
  await screen.findByText('Your browser control expired.');
  expect(screen.queryByLabelText('Live browser keyboard')).toBeNull();
  expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled();
  expect(JSON.stringify(localStorage)).not.toContain('guarded-paste');
});
