import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ComputerPreview } from '../ComputerPreview';
const { preview } = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('@/lib/repo', () => ({ useRepository: () => repo }));
const repo = { businessBrowser: preview };
afterEach(() => { vi.useRealTimers(); preview.mockReset(); });
describe('computer preview', () => {
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
    expect(await screen.findByText('Preview paused for privacy or owner control.')).toBeVisible();
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
    expect(screen.getByRole('status')).toHaveTextContent('no longer active');
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
