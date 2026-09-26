import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTelegramFile, TelegramFileTooLarge } from '../src/connectors/telegram';
import { vaultTelegramCredential } from '../src/vault/telegram';
import { testEnv } from './harness';

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

/* A vault-held bot's token never reaches the Worker, so the vault fetches the
   file and hands back the bytes (aisar-vault POST /v1/telegram/<id>/file). */
describe('downloading a file for a vault-held bot', () => {
  const SECRET = '44444444-4444-4444-8444-444444444444';
  const BUSINESS = '11111111-1111-4111-8111-111111111111';
  function vault(response: Response) {
    const calls: { path: string; body: unknown; token: string | null }[] = [];
    const env = testEnv({
      VAULT_INTERNAL_TOKEN: 'vault-internal-test',
      VAULT: { fetch: async (request: Request) => {
        calls.push({ path: new URL(request.url).pathname, body: await request.json(), token: request.headers.get('X-Vault-Internal') });
        return response;
      } } as never,
    });
    return { credential: vaultTelegramCredential(env, BUSINESS, SECRET), calls };
  }

  it('asks the vault for the bytes, sending ids and the cap only', async () => {
    const { credential, calls } = vault(new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
    expect(await downloadTelegramFile(credential, 'AwAC', 1000)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual([{
      path: `/v1/telegram/${SECRET}/file`, body: { businessId: BUSINESS, fileId: 'AwAC', maxBytes: 1000 },
      token: 'vault-internal-test',
    }]);
  });

  it('reads the vault’s 413 as too large, and any other refusal as a failed download', async () => {
    await expect(downloadTelegramFile(vault(Response.json({ ok: false }, { status: 413 })).credential, 'AwAC', 1000))
      .rejects.toBeInstanceOf(TelegramFileTooLarge);
    const failed = await downloadTelegramFile(vault(Response.json({ ok: false }, { status: 502 })).credential, 'AwAC', 1000)
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(TelegramFileTooLarge);
  });

  it('refuses more bytes than it asked for, whatever the vault sends', async () => {
    const { credential } = vault(new Response(new Uint8Array(21)));
    await expect(downloadTelegramFile(credential, 'AwAC', 20)).rejects.toBeInstanceOf(TelegramFileTooLarge);
  });
});
