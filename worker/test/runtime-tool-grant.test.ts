import { describe, expect, it } from 'vitest';
import { issueFullToolsGrant } from '../src/runtime/tool-grant';

const BUSINESS = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';

function decodeClaims(token: string): Record<string, unknown> {
  const [encoded] = token.split('.');
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

describe('full Hermes tool grant', () => {
  it('is wildcard-enabled, task-bound, and expires after five minutes', async () => {
    const grant = await issueFullToolsGrant('r'.repeat(64), BUSINESS, TASK, 1_800_000_000);
    const claims = decodeClaims(grant);

    expect(claims).toMatchObject({
      version: 1,
      businessId: BUSINESS,
      taskId: TASK,
      operations: ['*'],
      issuedAt: 1_800_000_000,
      expiresAt: 1_800_000_300,
    });
    expect(claims.nonce).toEqual(expect.any(String));
    expect(grant.split('.')).toHaveLength(2);
  });
});
