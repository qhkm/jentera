import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ComputerPreview } from '../ComputerPreview';
import type { BusinessBrowserState } from '@/lib/repo/types';
const { preview, status } = vi.hoisted(() => ({ preview: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/repo', () => ({ useRepository: () => repo }));
const { lost } = vi.hoisted(() => ({ lost: { current: null as null | (() => void) } }));
vi.mock('@/routes/views/DesktopViewer', () => ({
  default: ({ observe, onControlLost }: { observe?: { runId: string }; onControlLost: () => void }) => {
    lost.current = onControlLost;
    return <div data-testid="desktop">watching {observe?.runId}</div>;
  },
}));
/* Opening the panel asks once whether this computer can be watched live, then
   either mounts the desktop or runs the page preview. Keeping the two calls
   apart means `preview` still counts only real preview requests, so the
   backoff and cadence assertions below mean what they always did. */
const repo: {
  businessBrowser: (command?: unknown, signal?: AbortSignal) => unknown;
  observeConnection?: (runId: string) => { url: string; protocols: string[] };
  watchBrowser?: (runId: string, callback: (frame: BusinessBrowserState) => void, signal: AbortSignal) => Promise<void>;
} = { businessBrowser: (command?: unknown, signal?: AbortSignal) => command === undefined ? status() : preview(command, signal) };
afterEach(() => {
  vi.useRealTimers(); preview.mockReset(); status.mockReset();
  status.mockResolvedValue({}); delete repo.watchBrowser; delete repo.observeConnection;
});
status.mockResolvedValue({});
describe('computer preview', () => {
  it.each([
    ['paused', 'under owner control'],
    ['private', 'privacy filter'],
    ['navigating', 'browser is navigating'],
    ['waiting', 'Connected. Waiting'],
    ['loading', 'Waiting for the task'],
    ['unavailable', 'live browser feed is unavailable'],
  ] as const)('explains %s without obsolete snapshot wording', async (previewStatus, message) => {
    preview.mockResolvedValue({ previewStatus });
    render(<ComputerPreview runId="status" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(screen.queryByText(/snapshot/i)).toBeNull();
  });
  it('distinguishes transport failure from a missing browser feed', async () => {
    preview.mockRejectedValue(new Error('private server detail'));
    render(<ComputerPreview runId="network" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Preview connection interrupted'));
    expect(screen.queryByText('private server detail')).toBeNull();
  });
  it('shows waiting after privacy clears, rather than leaving an obsolete privacy warning', async () => {
    let send!: (frame: BusinessBrowserState) => void;
    repo.watchBrowser = async (_id, callback, signal) => {
      send = callback;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    };
    render(<ComputerPreview runId="privacy" />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => send({ previewStatus: 'private' }));
    expect(screen.getByRole('status')).toHaveTextContent('privacy filter');
    await act(async () => send({ previewStatus: 'waiting' }));
    expect(screen.getByRole('status')).toHaveTextContent('Connected. Waiting');
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('renews the preview after startup waiting and then receives a frame', async () => {
    vi.useFakeTimers();
    repo.watchBrowser = vi.fn()
      .mockImplementationOnce(async (_id, callback) => callback({ previewStatus: 'loading' }))
      .mockImplementationOnce(async (_id, callback, signal) => {
        callback({ previewStatus: 'ready', image: 'YWJj', capturedAt: Date.now() });
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      });
    render(<ComputerPreview runId="starting" />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.getByRole('status')).toHaveTextContent('Waiting');
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByRole('img')).toBeVisible();
    expect(repo.watchBrowser).toHaveBeenCalledTimes(2);
  });
  it('streams multiple frames without polling and removes frames on privacy transitions', async () => {
    let send!: (frame: BusinessBrowserState) => void;
    let signal!: AbortSignal;
    repo.watchBrowser = vi.fn(async (_id, callback, abort) => {
      send = callback; signal = abort;
      await new Promise<void>(resolve => abort.addEventListener('abort', () => resolve(), { once: true }));
    });
    render(<ComputerPreview runId="live" />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => send({ previewStatus: 'ready', image: 'YWJj', capturedAt: Date.now() }));
    expect(screen.getByRole('img')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    await act(async () => send({ previewStatus: 'private', image: 'secret' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide computer preview' }));
    expect(signal.aborted).toBe(true);
    await act(async () => send({ previewStatus: 'ready', image: 'late', capturedAt: Date.now() }));
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('keeps the last safe frame while navigating and replaces it with the next frame', async () => {
    let send!: (frame: BusinessBrowserState) => void;
    repo.watchBrowser = async (_id, callback, signal) => {
      send = callback;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    };
    render(<ComputerPreview runId="navigation" />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => send({ previewStatus: 'ready', image: 'b2xk', capturedAt: 1000 }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,b2xk');
    await act(async () => send({ previewStatus: 'navigating' }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,b2xk');
    expect(screen.getByRole('status')).toHaveTextContent('Navigating · last safe frame');
    await act(async () => send({ previewStatus: 'ready', image: 'bmV3', capturedAt: 2000 }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,bmV3');
  });
  it('keeps the last frame explicitly stale during reconnect then clears it on access denial', async () => {
    vi.useFakeTimers();
    repo.watchBrowser = vi.fn()
      .mockImplementationOnce(async (_id, callback) => { callback({ previewStatus: 'ready', image: 'YWJj', capturedAt: Date.now() }); throw new Error('offline'); })
      .mockRejectedValueOnce(Object.assign(new Error('internal'), { status: 403 }));
    render(<ComputerPreview runId="live" />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.getByRole('img')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('owner access');
  });
  it('does not fetch until opened, shows timestamp, and clears on collapse', async () => {
    preview.mockResolvedValue({ previewStatus: 'ready', image: 'YWJj', capturedAt: 1000 });
    render(<ComputerPreview runId="run-1" />);
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,YWJj');
    expect(screen.getByText(/Captured at/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide computer preview' }));
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });
  it('does not render blocked images', async () => {
    preview.mockResolvedValue({ previewStatus: 'private', image: 'sensitive' });
    render(<ComputerPreview runId="run-2" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Preview hidden by the privacy filter/)).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('aborts an in-flight snapshot on collapse and ignores its late response', async () => {
    let resolve!: (value: unknown) => void;
    preview.mockImplementation(() => new Promise(r => { resolve = r; }));
    render(<ComputerPreview runId="run-3" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    const signal = preview.mock.calls[0][1] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Hide computer preview' }));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ previewStatus: 'ready', image: 'secret', capturedAt: 1000 }));
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('stops polling after the runtime reports the task inactive', async () => {
    vi.useFakeTimers();
    preview.mockResolvedValue({ previewStatus: 'inactive' });
    render(<ComputerPreview runId="run-4" />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Browser work has ended');
  });
  it('stops on access errors without displaying server error details', async () => {
    vi.useFakeTimers();
    preview.mockRejectedValue(Object.assign(new Error('private internal detail'), { status: 403 }));
    render(<ComputerPreview runId="run-5" />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('owner access');
    expect(screen.queryByText('private internal detail')).toBeNull();
  });
  it('backs off and stops after three failures, with explicit retry', async () => {
    vi.useFakeTimers();
    preview.mockRejectedValue(new Error('network'));
    render(<ComputerPreview runId="run-6" />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    await act(async () => vi.advanceTimersByTimeAsync(90000));
    expect(preview).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status')).toHaveTextContent('does not stop the task');
    preview.mockResolvedValue({ previewStatus: 'inactive' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry preview' })));
    expect(preview).toHaveBeenCalledTimes(4);
  });
});

describe('watching the computer live', () => {
  const connection = { url: 'wss://api.jentera.ai/api/browser/observe', protocols: ['binary', 'jentera-observe.run-1'] };

  it('stays on the page preview when the repository cannot watch', async () => {
    preview.mockResolvedValue({ previewStatus: 'ready', image: 'AAAA', capturedAt: Date.now() });
    render(<ComputerPreview runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    await waitFor(() => expect(preview).toHaveBeenCalled());
    // Nothing asks about a capability the repository does not expose.
    expect(status).not.toHaveBeenCalled();
    expect(screen.queryByTestId('desktop')).toBeNull();
  });

  it('stays on the page preview when this business is not in the pilot', async () => {
    repo.observeConnection = () => connection;
    status.mockResolvedValue({});
    preview.mockResolvedValue({ previewStatus: 'ready', image: 'AAAA', capturedAt: Date.now() });
    render(<ComputerPreview runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId('desktop')).toBeNull();
    expect(screen.getByText(/Sensitive pages are hidden/)).toBeVisible();
  });

  it('swaps to the live computer and labels the broadcast read-only', async () => {
    repo.observeConnection = () => connection;
    status.mockResolvedValue({ desktopView: 1 });
    preview.mockResolvedValue({ previewStatus: 'waiting' });
    render(<ComputerPreview runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    expect(await screen.findByTestId('desktop')).toHaveTextContent('watching run-1');
    // The page filter's promise must not be repeated over a whole screen.
    expect(screen.queryByText(/Sensitive pages are hidden/)).toBeNull();
    expect(screen.getByText(/Live read-only view/)).toBeVisible();
  });

  it('ends the read-only broadcast before handing off to interactive control', async () => {
    const takeControl = vi.fn();
    repo.observeConnection = () => connection;
    status.mockResolvedValue({ desktopView: 1 });
    preview.mockResolvedValue({ previewStatus: 'waiting' });
    render(<ComputerPreview runId="run-1" onTakeControl={takeControl} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    expect(await screen.findByTestId('desktop')).toHaveTextContent('watching run-1');
    expect(screen.getByText(/Live read-only view/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Take control' }));

    expect(takeControl).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('desktop')).toBeNull();
  });

  it('falls back to the page preview when the watch cannot hold', async () => {
    repo.observeConnection = () => connection;
    status.mockResolvedValue({ desktopView: 1 });
    preview.mockResolvedValue({ previewStatus: 'ready', image: 'AAAA', capturedAt: Date.now() });
    render(<ComputerPreview runId="run-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview computer' }));
    await screen.findByTestId('desktop');
    await act(async () => { lost.current?.(); });
    expect(screen.queryByTestId('desktop')).toBeNull();
    await waitFor(() => expect(screen.getByText(/Sensitive pages are hidden/)).toBeVisible());
  });
});
