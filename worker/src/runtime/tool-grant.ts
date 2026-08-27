const GRANT_TTL_SECONDS = 5 * 60;

export interface RuntimeToolGrantClaims {
  version: 1;
  businessId: string;
  taskId: string;
  operations: string[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Mint a run-scoped capability token using the per-runtime secret. V1 grants
 * deliberately carry an empty operation set: Hermes may reason, but every
 * external action remains exclusively behind AISAR's policy gateway.
 */
export async function issueNoToolsGrant(
  runnerKey: string,
  businessId: string,
  taskId: string,
  now = Math.floor(Date.now() / 1_000),
): Promise<string> {
  const claims: RuntimeToolGrantClaims = {
    version: 1,
    businessId,
    taskId,
    operations: [],
    issuedAt: now,
    expiresAt: now + GRANT_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(runnerKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
