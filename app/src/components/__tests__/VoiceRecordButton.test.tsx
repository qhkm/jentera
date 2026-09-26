import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecordButton } from '@/components/VoiceRecordButton';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RepositoryProvider } from '@/lib/repo/context';
import { LocalRepository } from '@/lib/repo/local';
import { VoiceUnintelligible } from '@/lib/voice';
import * as native from '@/lib/native';

/** A browser recorder that hands back one chunk when stopped. */
class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  mimeType: string;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? ''; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  track = { stop: vi.fn() };
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(transcribe?: (audio: Blob) => Promise<string>) {
  const repo = Object.assign(new LocalRepository(), transcribe ? { transcribe: vi.fn(transcribe) } : {});
  const onText = vi.fn();
  render(<RepositoryProvider repository={repo}><I18nProvider><ToastProvider>
    <VoiceRecordButton onText={onText} />
  </ToastProvider></I18nProvider></RepositoryProvider>);
  return { repo: repo as LocalRepository & { transcribe?: ReturnType<typeof vi.fn> }, onText };
}

describe('recording a voice message in the composer', () => {
  it('records, hands the words to the composer, and lets go of the microphone', async () => {
    const user = userEvent.setup();
    const { repo, onText } = mount(async () => 'Tolong semak stok minyak.');
    await user.click(await screen.findByRole('button', { name: 'Record a voice message' }));
    expect(screen.getByText('0:00')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(onText).toHaveBeenCalledWith('Tolong semak stok minyak.'));
    const [audio] = repo.transcribe!.mock.calls[0] as [Blob];
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect(track.stop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Record a voice message' })).toBeEnabled();
  });

  it('explains how to allow a refused microphone', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { onText } = mount(async () => 'never');
    await user.click(await screen.findByRole('button', { name: 'Record a voice message' }));
    expect(await screen.findByText(/Allow microphone access/)).toBeInTheDocument();
    expect(onText).not.toHaveBeenCalled();
  });

  it('asks to try again when nothing could be made out', async () => {
    const user = userEvent.setup();
    const { onText } = mount(async () => { throw new VoiceUnintelligible(); });
    await user.click(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));
    expect(await screen.findByText(/make that out/)).toBeInTheDocument();
    expect(onText).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('is not offered in the demo, which cannot transcribe', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
  });

  it('is not offered in the native app', () => {
    vi.spyOn(native, 'isNative').mockReturnValue(true);
    mount(async () => 'never');
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
  });

  it('is not offered where the browser cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    mount(async () => 'never');
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
  });
});
