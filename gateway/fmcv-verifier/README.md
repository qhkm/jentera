# FMCV gateway verifier (B3 re-land)

LiteLLM `CustomAuthHandler` that accepts Jentera **virtual credentials**
(`sk-jentera-v1.<payload>.<signature>`) derived by the aisar worker's
`deriveFmcvRuntimeCredential` (worker/src/runtime/openrouter-keys.ts).

The signature is HMAC-SHA256 over `"jentera-fmcv-runtime-key:v1:" + payload`
with the **control secret**. Payload claims: `{"v":1,"rid":"aisar-b-<20hex>",
"limitUsd":5,"limitReset":"monthly"}`. Verification is stateless — no DB.

## Threat model / properties

- The control secret is the worker's `AISAR_MODEL_KEY` (≥32 chars). It is the
  ONLY thing that can mint or verify a derived key.
- Runtimes only ever hold their own derived key — the control secret never
  enters a runtime.
- The gateway enforces the embedded $5/month tenant ceiling via
  `UserAPIKeyAuth(max_budget=5, budget_duration="1mo", user_id=rid)`.
- Rotating `AISAR_MODEL_KEY` rotates every derived credential on the next
  reconciliation (worker `runtimeModelKeyNeedsRotation`).
- Non-`sk-jentera-v1.*` tokens fall through to LiteLLM's default auth, so the
  master key and existing virtual keys keep working.

## Deploy (on the LiteLLM host, e.g. 47.254.200.226)

1. Copy this directory next to the LiteLLM config:
   `scp -r gateway/fmcv-verifier <host>:/etc/litellm/`
2. Export the control secret in the LiteLLM service env — it MUST equal the
   worker's `AISAR_MODEL_KEY` (wrangler secret, ≥32 chars):
   `JENTERA_FMCV_CONTROL_SECRET=<value>`
3. Add to the LiteLLM `config.yaml`:
   ```yaml
   litellm_settings:
     custom_auth: custom_auth.user_api_key_auth
   ```
4. Restart the LiteLLM proxy and confirm it boots (auth module import errors
   fail startup loudly — that's intentional).
5. Run the live synthetic test below.

## Live synthetic test (after deploy)

```bash
# on the Mac/CI, with a ≥32-char secret equal to the worker's AISAR_MODEL_KEY:
SECRET='<control secret>'
KEY=$(cd gateway/fmcv-verifier && node derive_key.mjs "$SECRET" 'aisar-b-<20hex>')

# 1) auth works against the real gateway
curl -s -o /dev/null -w '%{http_code}\n' https://router.fmcv.my/v1/models \
  -H "Authorization: Bearer $KEY"                      # expect 200

# 2) chat completion smoke
curl -s https://router.fmcv.my/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}' \
  | head -c 300

# 3) tampered key is rejected
BAD="${KEY%?}x"; curl -s -o /dev/null -w '%{http_code}\n' \
  https://router.fmcv.my/v1/models -H "Authorization: Bearer $BAD"   # expect 401
```

## Local cross-implementation contract test (no host needed)

```bash
cd gateway/fmcv-verifier && ./test_contract.sh
```
Derives a key with Node (worker's WebCrypto algorithm), verifies with Python
(HMAC), and asserts wrong-secret and tampered keys are rejected.

## Keeping in sync

- `DERIVATION_CONTEXT` / payload shape / limits MUST match the worker
  (`worker/src/runtime/openrouter-keys.ts`). The contract test catches drift
  on the derived-key format; `test/` in the worker pins derivation behavior.
- Changes to `deriveFmcvRuntimeCredential` signature input ⇒ update
  `derive_key.mjs` accordingly.
