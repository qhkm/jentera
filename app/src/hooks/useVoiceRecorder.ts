import { useCallback, useEffect, useRef, useState } from 'react';
import { recordingType, VOICE_MAX_SECONDS, VoiceUnintelligible } from '@/lib/voice';

export type RecorderState = 'idle' | 'recording' | 'transcribing';
export type RecorderFailure = 'denied' | 'unintelligible' | 'failed';

/** Records from the microphone, sends the recording to be heard, and hands
    back its words. The microphone is released as soon as recording stops. */
export function useVoiceRecorder({ transcribe, onText, onError, maxSeconds = VOICE_MAX_SECONDS }: {
  transcribe: (audio: Blob) => Promise<string>;
  onText: (text: string) => void;
  onError: (failure: RecorderFailure) => void;
  maxSeconds?: number;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const latest = useRef({ transcribe, onText, onError });
  latest.current = { transcribe, onText, onError };

  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

  const release = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!supported || recorder.current) return;
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      latest.current.onError('denied');
      return;
    }
    stream.current = media;
    const type = recordingType(MediaRecorder.isTypeSupported?.bind(MediaRecorder));
    const next = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    next.onstop = () => {
      release();
      recorder.current = null;
      const audio = new Blob(chunks, { type: next.mimeType || type || chunks[0]?.type || 'audio/webm' });
      setState('transcribing');
      latest.current.transcribe(audio)
        .then((text) => latest.current.onText(text))
        .catch((error: unknown) => latest.current.onError(error instanceof VoiceUnintelligible ? 'unintelligible' : 'failed'))
        .finally(() => setState('idle'));
    };
    recorder.current = next;
    setSeconds(0);
    next.start();
    setState('recording');
    const began = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - began) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 250);
  }, [supported, maxSeconds, release, stop]);

  /* Leaving the page mid-recording must not leave the microphone on. */
  useEffect(() => () => {
    if (recorder.current) {
      recorder.current.onstop = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
    }
    release();
  }, [release]);

  return { state, seconds, supported, start, stop };
}
