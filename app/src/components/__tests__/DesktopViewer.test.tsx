import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import type { Repository, BrowserCommand, BusinessBrowserState } from '@/lib/repo/types';
import BusinessBrowser from '@/routes/views/BusinessBrowser';

const mocks = vi.hoisted(() => ({ clients: [] as (EventTarget & { disconnect: ReturnType<typeof vi.fn>; sendKey: ReturnType<typeof vi.fn>; clipViewport: boolean; dragViewport: boolean; scaleViewport: boolean })[], calls: [] as unknown[][] }));
vi.mock('@novnc/novnc', () => ({ default: class extends EventTarget {
  disconnect = vi.fn(); sendKey = vi.fn(); clipViewport = false; dragViewport = false; scaleViewport = false;
  constructor(...args: unknown[]) { super(); mocks.calls.push(args); mocks.clients.push(this); queueMicrotask(() => this.dispatchEvent(new Event('connect'))); }
} }));
beforeEach(() => {
  localStorage.clear(); mocks.clients.length = 0; mocks.calls.length = 0;
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({
    matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

it('uses actual-size pixels and explicit pan mode on a phone', async () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn().mockImplementation(() => ({
    matches: true, media: '(max-width: 640px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  expect(mocks.clients[0].scaleViewport).toBe(false);
  expect(mocks.clients[0].clipViewport).toBe(true);
  expect(mocks.clients[0].dragViewport).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Pan screen' }));
  expect(mocks.clients[0].dragViewport).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Interact with screen' }));
  expect(mocks.clients[0].dragViewport).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Fit view' }));
  expect(mocks.clients[0].scaleViewport).toBe(true);
  expect(mocks.clients[0].clipViewport).toBe(false);
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
it('connects only after explicit claim; shows a full desktop without duplicate fake Chrome controls or sidebar', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  expect(mocks.clients).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  await screen.findByRole('region', { name: 'Live business desktop' });
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  expect(screen.queryByLabelText('Website address')).toBeNull();
  expect(screen.queryByLabelText('Typing & keyboard')).toBeNull();
  expect(browser.mock.calls.some(([command]) => command?.action === 'frame')).toBe(false);
  expect(mocks.calls[0][1]).toBe('wss://api.example.test/api/browser/desktop');
  expect(JSON.stringify(mocks.calls[0].slice(1))).not.toContain('runnerKey');
  await user.click(screen.getByRole('button', { name: 'Close browser view' }));
  expect(mocks.clients[0].disconnect).toHaveBeenCalled();
  expect(browser.mock.calls.some(([command]) => command?.action === 'release')).toBe(false);
});
it('keeps the page-only viewer on old runtimes', async () => {
  const user = userEvent.setup(); mount(false);
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
  expect(mocks.clients).toHaveLength(0); expect(screen.queryByRole('region', { name: 'Live business desktop' })).toBeNull();
});
it('types/pastes Unicode through native keys, clears ephemeral text and never turns pasted newlines into submission', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Open business browser' }));
  await user.click(screen.getByRole('button', { name: 'Take control' }));
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
it('disconnects the desktop before explicit hand-back and preserves the existing pause contract', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open business browser' })); await user.click(screen.getByRole('button', { name: 'Take control' }));
  await waitFor(() => expect(mocks.clients).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Hand back to Jentera' }));
  expect(mocks.clients[0].disconnect).toHaveBeenCalled(); expect(browser.mock.calls.filter(([command]) => command?.action === 'release')).toHaveLength(1);
});

it('stops retrying after two brief reconnects and never claims/reclaims/resumes the browser automatically', async () => {
  const user = userEvent.setup(); const { browser } = mount();
  await user.click(await screen.findByRole('button', { name: 'Open business browser' })); await user.click(screen.getByRole('button', { name: 'Take control' }));
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
