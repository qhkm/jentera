import { describe, expect, it, vi } from 'vitest';
import { transcribeVoice, WHISPER_MODEL } from '../src/voice/transcribe';

type FakeAi = Ai & { run: ReturnType<typeof vi.fn> };
const ai = (text: unknown): FakeAi => ({ run: vi.fn(async () => ({ text })) }) as unknown as FakeAi;
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);

describe('transcribing a voice note', () => {
  it('sends the audio as sent, with silence filtering and a Malay/English hint', async () => {
    const fake = ai(' Tolong ingatkan saya esok pukul 8 pagi. ');
    expect(await transcribeVoice(fake, OGG)).toEqual({ text: 'Tolong ingatkan saya esok pukul 8 pagi.' });
    const [model, input] = fake.run.mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe(WHISPER_MODEL);
    expect(input).toMatchObject({ audio: btoa('OggS\x01\x02\x03'), vad_filter: true, condition_on_previous_text: false });
    expect(String(input.initial_prompt)).toMatch(/Melayu/);
    expect(input).not.toHaveProperty('language');
  });

  /* Measured 26 Sep: four seconds of silence read "Thank you." with VAD off. */
  it.each(['', '   ', 'Thank you.', 'Terima kasih.', 'Thanks for watching!', null])(
    'calls %j unintelligible', async (text) => {
      expect(await transcribeVoice(ai(text), OGG)).toEqual({ unintelligible: true });
    });

  it('encodes audio larger than one call stack of arguments', async () => {
    const big = new Uint8Array(200_000).fill(65);
    const fake = ai('ok');
    await transcribeVoice(fake, big);
    const [, input] = fake.run.mock.calls[0] as [string, { audio: string }];
    expect(atob(input.audio).length).toBe(200_000);
  });
});
