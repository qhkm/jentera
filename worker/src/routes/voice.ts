/**
 * A recording from the app's composer, turned into text. The app puts the
 * text in the message box for the owner to check and send; nothing here
 * starts a run, and the audio is not kept. Any member may use it.
 */
import type { Env } from '../env';
import { admitPaidAgentRun } from '../request-guard';
import { hasBusiness, resolveTenant } from '../tenancy';
import { transcribeVoice, VOICE_MAX_BYTES } from '../voice/transcribe';

export const VOICE_TRANSCRIBE_PATH = '/api/voice/transcribe';

/** What browsers record: WebM or OGG Opus (Chrome, Firefox, Android) and MP4
    AAC (Safari, iPhone). All three measured on Workers AI on 27 Sep. */
const AUDIO = /^audio\/(?:webm|ogg|mp4|mpeg|aac|x-m4a)(?:\s*;.*)?$/i;

export async function handleVoice(
  request: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (url.pathname !== VOICE_TRANSCRIBE_PATH) return null;
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { ...cors, 'Cache-Control': 'private, no-store' } });
  if (request.method !== 'POST') return json({ ok: false, err: 'Method not allowed.' }, 405);
  const identity = await resolveTenant(env, request);
  if (!hasBusiness(identity)) return json({ ok: false, err: 'Sign in to use voice.' }, 401);
  if (!AUDIO.test(request.headers.get('Content-Type') ?? '')) {
    return json({ ok: false, err: 'Send an audio recording.' }, 415);
  }
  if (Number(request.headers.get('Content-Length') ?? 0) > VOICE_MAX_BYTES) {
    return json({ ok: false, err: 'That recording is too long. Keep it under ten minutes.' }, 413);
  }
  if (!await admitPaidAgentRun(env, [`voice:${identity.userId}`])) {
    return json({ ok: false, err: 'Too many recordings at once. Try again in a minute.' }, 429);
  }
  const audio = new Uint8Array(await request.arrayBuffer());
  if (!audio.byteLength) return json({ ok: false, err: 'That recording was empty.' }, 400);
  if (audio.byteLength > VOICE_MAX_BYTES) {
    return json({ ok: false, err: 'That recording is too long. Keep it under ten minutes.' }, 413);
  }
  let heard: Awaited<ReturnType<typeof transcribeVoice>>;
  try {
    heard = await transcribeVoice(env.AI, audio);
  } catch {
    /* The model's error text can name hosts; it stays out of the answer. */
    console.warn('[voice] transcription failed');
    return json({ ok: false, err: 'Could not transcribe that just now. Try again, or type it.' }, 502);
  }
  if ('unintelligible' in heard) {
    return json({ ok: false, code: 'UNINTELLIGIBLE', err: 'Couldn’t make that out.' }, 422);
  }
  return json({ ok: true, text: heard.text });
}
