import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRepository } from '@/lib/repo/remote';

const DEPOSIT = 'https://aisar-vault-deposit.qhkmdev90.workers.dev/v1/deposits/redeem';
const TOKEN = `123456789:${'A'.repeat(35)}`;

describe('RemoteRepository Telegram vault deposit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends the token only to the direct vault endpoint', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/connections/telegram/deposit-ticket') {
        return Response.json({
          ok: true,
          ticket: 'ticket-id.ticket-secret',
          businessId: '11111111-1111-4111-8111-111111111111',
          expiresAt: '2026-09-16T12:00:00.000Z',
          depositUrl: DEPOSIT,
        });
      }
      if (url === DEPOSIT) {
        return Response.json({ ok: true, receipt: 'ticket-id.receipt-secret' }, { status: 201 });
      }
      if (url === '/api/connections/telegram/complete') {
        return Response.json({
          ok: true,
          connection: {
            id: 'connection-id', connector: 'telegram', method: 'vault_bot_token',
            status: 'connected', displayName: '@alpha_bot', externalId: '123456789',
            connectedAt: '2026-09-16T12:00:00.000Z', lastOkAt: null, lastError: null,
            paired: false, pairingUrl: 'https://t.me/alpha_bot?start=opaque', vaultProtected: true,
          },
        });
      }
      return Response.json({ ok: false, err: 'not found' }, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);

    const connection = await new RemoteRepository().connectTelegram(TOKEN);
    expect(connection).toMatchObject({ connector: 'telegram', vaultProtected: true });
    expect(fetch).toHaveBeenCalledTimes(3);

    const calls = fetch.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const ticketBody = String(calls[0][1]?.body);
    const depositBody = String(calls[1][1]?.body);
    const completeBody = String(calls[2][1]?.body);
    expect(ticketBody).not.toContain(TOKEN);
    expect(depositBody).toContain(TOKEN);
    expect(completeBody).not.toContain(TOKEN);
    expect(calls[1][1]).toMatchObject({
      method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    expect(completeBody).toContain('ticket-id.receipt-secret');
  });

  it('refuses an unexpected deposit origin before releasing the token', async () => {
    const fetch = vi.fn(async () => Response.json({
      ok: true,
      ticket: 'ticket-id.ticket-secret',
      businessId: '11111111-1111-4111-8111-111111111111',
      expiresAt: '2026-09-16T12:00:00.000Z',
      depositUrl: 'https://evil.example/v1/deposits/redeem',
    }));
    vi.stubGlobal('fetch', fetch);

    await expect(new RemoteRepository().connectTelegram(TOKEN))
      .rejects.toThrow(/secure Telegram deposit is unavailable/i);
    expect(fetch).toHaveBeenCalledOnce();
    const calls = fetch.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    expect(String(calls[0][1]?.body)).not.toContain(TOKEN);
  });
});
