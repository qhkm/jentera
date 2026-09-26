import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

class FakeRecorder {
  static isTypeSupported = () => false;
  mimeType = '';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() { this.ondataavailable?.({ data: new Blob(['v'], { type: 'audio/mp4' }) }); this.onstop?.(); }
}

afterEach(() => vi.unstubAllGlobals());

/* The server hears up to ten minutes; a recording left running stops there. */
describe('the voice recorder', () => {
  it('stops by itself at the limit and sends what it has', async () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) }, configurable: true,
    });
    const transcribe = vi.fn(async () => 'ok');
    const { result } = renderHook(() => useVoiceRecorder({ transcribe, onText: () => {}, onError: () => {}, maxSeconds: 1 }));
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('recording');
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce(), { timeout: 3_000 });
    const [audio] = transcribe.mock.calls[0] as unknown as [Blob];
    expect(audio.type).toBe('audio/mp4');
  });
});
