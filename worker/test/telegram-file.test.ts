import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTelegramFile, TelegramFileTooLarge } from '../src/connectors/telegram';

const TOKEN = '123456789:AAsecret';
afterEach(() => vi.unstubAllGlobals());

function telegram(meta: unknown, file: Response | Error) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/getFile')) return new Response(JSON.stringify(meta));
    if (file instanceof Error) throw file;
    return file;
  }));
  return calls;
}

describe('downloading a file the owner sent', () => {
  it('asks Telegram where the file is, then fetches its bytes', async () => {
    const calls = telegram({ ok: true, result: { file_path: 'voice/file_7.oga', file_size: 3 } },
      new Response(new Uint8Array([1, 2, 3])));
    expect(await downloadTelegramFile(TOKEN, 'AwAC')).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([
      `https://api.telegram.org/bot${TOKEN}/getFile`,
      `https://api.telegram.org/file/bot${TOKEN}/voice/file_7.oga`,
    ]);
  });

  it('refuses a file over the limit before downloading it', async () => {
    const calls = telegram({ ok: true, result: { file_path: 'x', file_size: 21 } }, new Response('never'));
    await expect(downloadTelegramFile(TOKEN, 'AwAC', 20)).rejects.toBeInstanceOf(TelegramFileTooLarge);
    expect(calls).toHaveLength(1);
  });

  /* The file URL is the token. A failed fetch must not carry it into a log. */
  it.each([
    [{ ok: false, description: `bad token ${TOKEN}` }, new Response('x')],
    [{ ok: true, result: { file_path: 'x' } }, new Error(`connect failed https://api.telegram.org/file/bot${TOKEN}/x`)],
    [{ ok: true, result: { file_path: 'x' } }, new Response('gone', { status: 404 })],
  ])('never puts the token in an error', async (meta, file) => {
    telegram(meta, file);
    const error = await downloadTelegramFile(TOKEN, 'AwAC').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('AAsecret');
  });
});
