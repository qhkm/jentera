import type { Env } from '../env';
import { callVault, VaultUnavailable } from './client';

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
