import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository, BrowserCommand, BusinessBrowserState } from '@/lib/repo/types';
import BusinessBrowser from '@/routes/views/BusinessBrowser';

const mocks = vi.hoisted(() => ({ clients: [] as (EventTarget & {
  disconnect: ReturnType<typeof vi.fn>;
  sendKey: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  clipViewport: boolean;
  dragViewport: boolean;
  scaleViewport: boolean;
  _canvas: HTMLCanvasElement;
  _display: { scale: number; width: number; height: number };
  _screen: HTMLDivElement;
})[], calls: [] as unknown[][] }));
vi.mock('@novnc/novnc', () => ({ default: class extends EventTarget {
  disconnect = vi.fn(); sendKey = vi.fn(); focus = vi.fn(); dragViewport = false;
  _clipViewport = false; _scaleViewport = false;
  _canvas = document.createElement('canvas');
  _display = { scale: 1, width: 1280, height: 720 };
  _screen = document.createElement('div');
  get clipViewport() { return this._clipViewport; }
  set clipViewport(value: boolean) { this._clipViewport = value; }
  get scaleViewport() { return this._scaleViewport; }
  set scaleViewport(value: boolean) { this._scaleViewport = value; if (!value) this._display.scale = 1; }
  constructor(...args: unknown[]) {
    super(); mocks.calls.push(args);
    this._screen.appendChild(this._canvas); (args[0] as HTMLElement).appendChild(this._screen);
    mocks.clients.push(this); queueMicrotask(() => this.dispatchEvent(new Event('connect')));
  }
} }));
beforeEach(() => {
  localStorage.clear(); mocks.clients.length = 0; mocks.calls.length = 0;
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({
    matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => vi.unstubAllGlobals());

it('uses actual-size pixels, survives rotation, and keeps explicit pan mode on a phone', async () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({
    matches: true, media: '(max-width: 640px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  expect(mocks.clients[0].scaleViewport).toBe(false);
  expect(mocks.clients[0].clipViewport).toBe(false);
  expect(mocks.clients[0].dragViewport).toBe(false);
  expect(screen.queryByRole('button', { name: 'Enter' })).toBeNull();
  await user.click(screen.getByLabelText('Keyboard / paste'));
  expect(screen.getByRole('button', { name: 'Enter' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Hide keyboard shortcuts' }));
  expect(screen.queryByRole('button', { name: 'Enter' })).toBeNull();
  const modal = screen.getByRole('dialog');
  expect(modal).toHaveStyle({ '--browser-vvw': '390px', '--browser-vvh': '844px' });
  act(() => {
    viewport.width = 844; viewport.height = 390;
    window.dispatchEvent(new Event('orientationchange'));
    viewport.dispatchEvent(new Event('resize'));
  });
  await waitFor(() => expect(modal).toHaveStyle({ '--browser-vvw': '844px', '--browser-vvh': '390px' }));
  expect(mocks.clients).toHaveLength(1);
  expect(mocks.clients[0].scaleViewport).toBe(false);
  expect(mocks.clients[0].clipViewport).toBe(false);
  const move = screen.getByRole('button', { name: 'Pan screen' });
  await user.click(move);
  expect(move).toHaveAttribute('aria-pressed', 'true');
  mocks.clients[0]._screen.scrollLeft = 100;
  act(() => {
    mocks.clients[0]._canvas.dispatchEvent(new CustomEvent('gesturestart', { detail: { type: 'drag', clientX: 100, clientY: 100 } }));
    mocks.clients[0]._canvas.dispatchEvent(new CustomEvent('gesturemove', { detail: { type: 'drag', clientX: 50, clientY: 100 } }));
    mocks.clients[0]._canvas.dispatchEvent(new CustomEvent('gestureend', { detail: { type: 'drag', clientX: 50, clientY: 100 } }));
  });
  expect(mocks.clients[0]._screen.scrollLeft).toBe(150);
  await user.click(screen.getByRole('button', { name: 'Interact with screen' }));
  expect(mocks.clients[0].dragViewport).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Fit' }));
  expect(mocks.clients[0].scaleViewport).toBe(true);
  expect(mocks.clients[0].clipViewport).toBe(false);
});

it('zooms the local desktop with pinch without leaking Ctrl-wheel to the remote browser', async () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({
    matches: true, media: '(max-width: 640px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  const client = mocks.clients[0];
  const leakedGesture = vi.fn();
  client._canvas.addEventListener('gesturemove', leakedGesture);

  const gesture = (type: string, magnitude: number) => new CustomEvent(type, { detail: {
    type: 'pinch', clientX: 120, clientY: 180, magnitudeX: magnitude, magnitudeY: 0,
  } });
  act(() => {
    client._canvas.dispatchEvent(gesture('gesturestart', 100));
    client._canvas.dispatchEvent(gesture('gesturemove', 150));
    client._canvas.dispatchEvent(gesture('gestureend', 150));
  });

  expect(client._display.scale).toBe(1.5);
  expect(screen.getByRole('button', { name: 'Actual size' })).toHaveTextContent('150%');
  expect(leakedGesture).not.toHaveBeenCalled();
  expect(client.sendKey).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(client._display.scale).toBe(1.25);
  expect(screen.getByRole('button', { name: 'Actual size' })).toHaveTextContent('125%');
});
function mount(capability = true) {
  const browser = vi.fn(async (command?: BrowserCommand): Promise<BusinessBrowserState> => ({
    enabled: true, paused: command?.action === 'claim', controlRecovery: 1, ...(capability ? { desktopView: 1 } : {}),
  }));
  const repo: Repository = new LocalRepository(); repo.businessBrowser = browser;
  repo.desktopConnection = id => ({ url: 'wss://api.example.test/api/browser/desktop', protocols: ['binary', `jentera-control.${id}`] });
  render(<RepositoryProvider repository={repo}><I18nProvider><BusinessBrowser /></I18nProvider></RepositoryProvider>);
  return { browser };
}
it('claims on open and shows a full desktop without duplicate fake Chrome controls or sidebar', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await screen.findByRole('region', { name: 'Live business desktop' });
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  expect(screen.queryByLabelText('Website address')).toBeNull();
  expect(screen.queryByLabelText('Typing & keyboard')).toBeNull();
  expect(browser.mock.calls.some(([command]) => command?.action === 'frame')).toBe(false);
  expect(mocks.calls[0][1]).toBe('wss://api.example.test/api/browser/desktop');
  expect(JSON.stringify(mocks.calls[0].slice(1))).not.toContain('runnerKey');
  await user.click(screen.getByRole('button', { name: 'Close computer view' }));
  await waitFor(() => expect(mocks.clients[0].disconnect).toHaveBeenCalled());
  expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(true);
});
it('expands the controlled desktop to full screen and restores it without handing control back', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  let active: Element | null = null;
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
  const requestDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'requestFullscreen');
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: vi.fn(async () => {
    active = null; document.dispatchEvent(new Event('fullscreenchange'));
  }) });
  Object.defineProperty(HTMLDialogElement.prototype, 'requestFullscreen', { configurable: true, value: vi.fn(async function (this: HTMLDialogElement) {
    active = this; document.dispatchEvent(new Event('fullscreenchange'));
  }) });
  try {
    await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
    const modal = await screen.findByRole('dialog');
    await user.click(await screen.findByRole('button', { name: 'Enter full screen' }));
    expect(modal).toHaveClass('is-fullscreen');
    expect(document.documentElement).toHaveClass('business-browser-fullscreen-open');
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(modal).not.toHaveClass('is-fullscreen');
    expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(false);
  } finally {
    if (fullscreenDescriptor) Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor);
    else Reflect.deleteProperty(document, 'fullscreenElement');
    if (exitDescriptor) Object.defineProperty(document, 'exitFullscreen', exitDescriptor);
    else Reflect.deleteProperty(document, 'exitFullscreen');
    if (requestDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'requestFullscreen', requestDescriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'requestFullscreen');
  }
});
it('hands physical-keyboard focus to the controlled canvas on its first pointer interaction', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  const desktop = await screen.findByRole('region', { name: 'Live business desktop' });
  await waitFor(() => expect(mocks.clients).toHaveLength(1));

  fireEvent.pointerDown(desktop.querySelector('.business-desktop-stage')!);
  expect(mocks.clients[0].focus).toHaveBeenCalledWith({ preventScroll: true });
});
it('keeps the page-only viewer on old runtimes', async () => {
  const user = userEvent.setup(); mount(false);
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await waitFor(() => expect(screen.getByLabelText('Website address')).toBeVisible());
  expect(mocks.clients).toHaveLength(0); expect(screen.queryByRole('region', { name: 'Live business desktop' })).toBeNull();
});
it('types/pastes Unicode through native keys, clears ephemeral text and never turns pasted newlines into submission', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  const input = await screen.findByLabelText('Keyboard / paste'); await waitFor(() => expect(input).toBeEnabled());
  fireEvent.input(input, { target: { value: 'hi✓\n' } });
  expect(mocks.clients[0].sendKey.mock.calls.map(call => call[0])).toEqual([104, 105, 0x01002713]);
  expect(input).toHaveValue('\u200b'); expect(input).toHaveAttribute('type', 'password');
  expect(JSON.stringify(localStorage)).not.toContain('hi✓');
  await user.click(screen.getByRole('button', { name: 'Enter' })); expect(mocks.clients[0].sendKey).toHaveBeenLastCalledWith(0xff0d);
  const count = mocks.clients[0].sendKey.mock.calls.length;
  act(() => mocks.clients[0].dispatchEvent(new Event('disconnect')));
  fireEvent.input(input, { target: { value: 'never-replay' } });
  expect(mocks.clients[0].sendKey.mock.calls.length).toBe(count); expect(input).toHaveValue('\u200b');
});
it('handles the native paste event directly and offers an explicit local clipboard action', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  const input = await screen.findByLabelText('Keyboard / paste'); await waitFor(() => expect(input).toBeEnabled());
  fireEvent.paste(input, { clipboardData: { getData: (type: string) => type === 'text/plain' ? 'copy✓\n' : '' } });
  expect(mocks.clients[0].sendKey.mock.calls.map(call => call[0])).toEqual([99, 111, 112, 121, 0x01002713]);
  expect(input).toHaveValue('\u200b');

  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const readText = vi.fn().mockResolvedValue('local paste');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
  mocks.clients[0].sendKey.mockClear();
  try {
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(readText).toHaveBeenCalledOnce());
    expect(mocks.clients[0].sendKey.mock.calls.map(call => call[0])).toEqual(
      Array.from('local paste', char => char.codePointAt(0)),
    );
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
it('disconnects the desktop before explicit hand-back and preserves the existing pause contract', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Hand back to Jentera' }));
  expect(mocks.clients[0].disconnect).toHaveBeenCalled(); expect(browser.mock.calls.filter(([command]) => command?.action === 'release')).toHaveLength(1);
});

it('stops retrying after two brief reconnects without reclaiming or releasing the browser', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open Jentera’s computer' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  vi.useFakeTimers();
  try {
    act(() => mocks.clients[0].dispatchEvent(new Event('disconnect')));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(mocks.clients).toHaveLength(2);
    act(() => mocks.clients[1].dispatchEvent(new Event('disconnect')));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(mocks.clients).toHaveLength(3);
    act(() => mocks.clients[2].dispatchEvent(new Event('disconnect')));
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(mocks.clients).toHaveLength(3); expect(screen.queryByRole('region', { name: 'Live business desktop' })).toBeNull();
    expect(browser.mock.calls.filter(([command]) => command?.action === 'claim')).toHaveLength(1);
    expect(browser.mock.calls.some(([command]) => command?.action === 'reclaim' || command?.action === 'release')).toBe(false);
  } finally { vi.useRealTimers(); }
});
