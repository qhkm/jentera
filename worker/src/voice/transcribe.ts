/**
 * Voice notes, heard in the worker. Hermes transcribes only on its own
 * Telegram gateway, which a Jentera bot does not use, so the audio is turned
 * into text before the agent is asked. The audio is not kept.
 * Settings measured on 26 September
 * (docs/superpowers/plans/2026-09-26-telegram-voice-notes.md).
 */
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

const INITIAL_PROMPT =
  'Mesej suara pemilik perniagaan di Malaysia, dalam Bahasa Melayu, English atau campuran. ' +
  'A Malaysian business owner voice note in Malay, English or both.';

/** What Whisper says over silence or noise. A note that is only one of these
    is treated as unheard: an owner asked to type it loses a few seconds, an
    agent acting on "Thank you." answers a message nobody sent. */
const STOCK_PHRASES = new Set([
  'thank you', 'thanks', 'thank you for watching', 'thanks for watching',
  'terima kasih', 'terima kasih kerana menonton', 'you', 'bye',
]);

export type Heard = { text: string } | { unintelligible: true };

export async function transcribeVoice(ai: Ai, audio: Uint8Array): Promise<Heard> {
  const run = ai.run as unknown as (model: string, input: Record<string, unknown>) => Promise<unknown>;
  const result = await run.call(ai, WHISPER_MODEL, {
    audio: base64(audio),
    vad_filter: true,
    condition_on_previous_text: false,
    initial_prompt: INITIAL_PROMPT,
  }) as { text?: unknown } | null;
  const text = typeof result?.text === 'string' ? result.text.trim() : '';
  const bare = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  if (!bare || STOCK_PHRASES.has(bare)) return { unintelligible: true };
  return { text };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
