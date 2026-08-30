import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  clients: [] as { begin: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[],
  postgres: vi.fn(),
}));

vi.mock('postgres', () => ({
  default: state.postgres,
}));

import { withTenant, withUser } from '../src/db';
import type { Env } from '../src/env';

const env = {
  HYPERDRIVE: { connectionString: 'postgres://request-local.test/database' },
} as Env;

beforeEach(() => {
  state.clients.length = 0;
  state.postgres.mockReset();
  state.postgres.mockImplementation(() => {
    const tx = vi.fn(async () => []);
    const client = {
      begin: vi.fn(async (fn: (input: typeof tx) => Promise<unknown>) => fn(tx)),
      end: vi.fn(async () => undefined),
    };
    state.clients.push(client);
    return client;
  });
});

describe('Worker database client lifetime', () => {
  it('creates and closes a distinct client for every user-scoped call', async () => {
    await withUser(env, async () => 'first');
    await withUser(env, async () => 'second');

    expect(state.postgres).toHaveBeenCalledTimes(2);
    expect(state.clients).toHaveLength(2);
    expect(state.clients[0]).not.toBe(state.clients[1]);
    expect(state.clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
  });

  it('closes a tenant client even when the transaction callback fails', async () => {
    await expect(withTenant(env, '11111111-1111-4111-8111-111111111111', async () => {
      throw new Error('route failed');
    })).rejects.toThrow('route failed');

    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].end).toHaveBeenCalledWith({ timeout: 1 });
  });
});
