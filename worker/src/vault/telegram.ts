import type { Env } from '../env';
import { callVault, callVaultRaw, VaultUnavailable } from './client';

export type TelegramCredential = string | {
  kind: 'vault';
  env: Env;
  businessId: string;
  secretId: string;
};

export function vaultTelegramCredential(
  env: Env,
  businessId: string,
  secretId: string,
): TelegramCredential {
  return { kind: 'vault', env, businessId, secretId };
}

export function isVaultTelegramCredential(
  credential: TelegramCredential,
): credential is Exclude<TelegramCredential, string> {
  return typeof credential !== 'string';
}

export async function callVaultTelegram(
  credential: Exclude<TelegramCredential, string>,
  method: 'GET' | 'POST',
  path: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const upstream = await callVault<unknown>(
    credential.env,
    `/v1/telegram/${credential.secretId}/call`,
    {
      method: 'POST',
      body: {
        businessId: credential.businessId,
        method,
        path,
        ...(payload ? { payload } : {}),
      },
    },
  );
  return new Response(JSON.stringify(upstream.body), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** A file the paired owner sent a vault-held bot, fetched by the vault: the
    answer is the bytes (200), 413 over `maxBytes`, or a JSON refusal. The
    token, the file URL and Telegram's file path stay in the vault. */
export async function fetchVaultTelegramFile(
  credential: Exclude<TelegramCredential, string>,
  fileId: string,
  maxBytes: number,
): Promise<Response> {
  return callVaultRaw(credential.env, `/v1/telegram/${credential.secretId}/file`, {
    method: 'POST',
    body: { businessId: credential.businessId, fileId, maxBytes },
  });
}

export async function bindVaultTelegramChat(
  credential: TelegramCredential,
  chatId: number,
): Promise<void> {
  if (!isVaultTelegramCredential(credential)) return;
  const upstream = await callVault<{ ok?: boolean; err?: string }>(
    credential.env,
    `/v1/telegram/${credential.secretId}/bind`,
    { method: 'POST', body: { businessId: credential.businessId, chatId } },
  );
  if (upstream.status !== 200 || !upstream.body.ok) {
    throw new VaultUnavailable(upstream.body.err ?? 'Secure Telegram pairing failed');
  }
}
