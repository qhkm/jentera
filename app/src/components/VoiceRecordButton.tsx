import { CircleNotch, Microphone, Stop } from '@phosphor-icons/react';
import { useToast } from '@/components/Toast';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useT } from '@/i18n/I18nProvider';
import { isNative } from '@/lib/native';
import { useRepository } from '@/lib/repo';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The composer's mic. The words land in the message box for the owner to
    check and send; nothing is sent from here. Not offered in the demo, in the
    native shell (which has no microphone permission yet), or where the
    browser cannot record. */
export function VoiceRecordButton({ onText, disabled = false }: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const repo = useRepository();
  const t = useT();
  const toast = useToast();
  const transcribe = repo.transcribe?.bind(repo);
  const recorder = useVoiceRecorder({
    transcribe: transcribe ?? (async () => ''),
    onText,
    onError: (failure) => toast(t(`ask.voice.${failure}`), 'error'),
  });
  if (!transcribe || isNative() || !recorder.supported) return null;

  const recording = recorder.state === 'recording';
  const transcribing = recorder.state === 'transcribing';
  const label = t(recording ? 'ask.voice.stop' : transcribing ? 'ask.voice.transcribing' : 'ask.voice.start');
  return (
    <>
      <button
        type="button"
        className={`ask-attach-button ask-voice-button${recording ? ' is-recording' : ''}`}
        aria-label={label}
        title={label}
        aria-pressed={recording}
        disabled={disabled || transcribing}
        onClick={() => { if (recording) recorder.stop(); else void recorder.start(); }}
      >
        {recording
          ? <Stop size={15} weight="fill" aria-hidden="true" />
          : transcribing
            ? <CircleNotch className="ask-voice-spinner" size={15} aria-hidden="true" />
            : <Microphone size={15} aria-hidden="true" />}
        <span>{recording ? clock(recorder.seconds) : t(transcribing ? 'ask.voice.transcribingShort' : 'ask.toolbar.voice')}</span>
      </button>
      <span className="sr-only" role="status">
        {recording ? t('ask.voice.recording') : transcribing ? t('ask.voice.transcribing') : ''}
      </span>
    </>
  );
}
