import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';
import { VoiceUnintelligible } from '@/lib/voice';

afterEach(() => vi.unstubAllGlobals());

describe('transcribing a recording from the composer', () => {
  it('sends the recording as it was recorded and returns the words', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, text: 'Tolong semak stok.' }));
    vi.stubGlobal('fetch', fetch);
    const recording = new Blob(['abc'], { type: 'audio/webm;codecs=opus' });
    expect(await new RemoteRepository().transcribe(recording)).toBe('Tolong semak stok.');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/voice\/transcribe$/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: recording });
    expect(new Headers(init.headers).get('Content-Type')).toBe('audio/webm;codecs=opus');
  });

  it('says when nothing could be made out, and passes any other refusal on in its own words', async () => {
    const recording = new Blob(['x'], { type: 'audio/mp4' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'UNINTELLIGIBLE' }, { status: 422 })));
    await expect(new RemoteRepository().transcribe(recording)).rejects.toBeInstanceOf(VoiceUnintelligible);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, err: 'Too many recordings at once.' }, { status: 429 })));
    await expect(new RemoteRepository().transcribe(recording)).rejects.toThrow('Too many recordings at once.');
  });
});
