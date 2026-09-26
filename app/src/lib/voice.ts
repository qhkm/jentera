/** Recording a voice message in the composer. The server hears up to ten
    minutes (`VOICE_MAX_BYTES` and Whisper, worker/src/voice/transcribe.ts). */
export const VOICE_MAX_SECONDS = 600;

/** The server heard nothing it could write down: silence, or noise. */
export class VoiceUnintelligible extends Error {
  constructor() {
    super('Could not make that out');
    this.name = 'VoiceUnintelligible';
  }
}

/** What to ask the browser to record in: Opus where it can (Chrome, Firefox,
    Android), MP4 AAC on Safari and iPhone. All three were measured on Workers
    AI on 27 Sep. Undefined lets the browser choose. */
export function recordingType(isTypeSupported?: (type: string) => boolean): string | undefined {
  if (!isTypeSupported) return undefined;
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => isTypeSupported(type));
}
