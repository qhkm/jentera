// Cross-implementation derive tool for the FMCV verifier contract test.
// Mirrors worker/src/runtime/openrouter-keys.ts deriveFmcvRuntimeCredential
// EXACTLY (payload key order matters: v, rid, limitUsd, limitReset).
// Usage: node derive_key.mjs <controlSecret> <runtimeName>
const LIMIT_USD = 5;
const FMCV_DERIVATION_CONTEXT = 'jentera-fmcv-runtime-key:v1';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function derive(controlSecret, runtimeName) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    v: 1,
    rid: runtimeName,
    limitUsd: LIMIT_USD,
    limitReset: 'monthly',
  })));
  const signingKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(controlSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', signingKey,
    new TextEncoder().encode(`${FMCV_DERIVATION_CONTEXT}:${payload}`),
  ));
  return `sk-jentera-v1.${payload}.${base64Url(signature)}`;
}

const [secret, rid] = process.argv.slice(2);
if (!secret || !rid) {
  console.error('usage: node derive_key.mjs <controlSecret> <runtimeName>');
  process.exit(2);
}
derive(secret, rid).then((key) => console.log(key)).catch((e) => { console.error(e); process.exit(1); });
