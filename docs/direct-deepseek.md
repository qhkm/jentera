# Direct DeepSeek model routing

Jentera's Worker forwards to `https://api.deepseek.com/v1` using the
`DEEPSEEK_API_KEY` Worker secret. Runtime credentials and the runtime-facing
Jentera proxy URL are unchanged; no vendor key is sent to the frontend or VM.
`AISAR_MODEL_PROVIDER=openrouter` remains the runtime's compatibility adapter,
not the selected upstream service.

The canonical model is `deepseek-flash` (V4.1 Flash). The proxy translates
existing V4 Flash runtime aliases and OpenRouter-style reasoning options.
Quick disables thinking; Deep enables high reasoning. Native tool reasoning
is preserved. Legacy tool history without `reasoning_content` continues with
thinking disabled rather than failing validation or fabricating reasoning.

Budget estimates conservatively use peak cache-miss prices: $0.30/M input,
$1.20/M output. They are not the provider's exact invoice (cache hits and
off-peak calls can cost less). Existing historical gateway model prices remain.

References:
- https://www.deepseek.com/en/news/deepseek-v4-1-flash/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/guides/thinking_mode/

Rollback: restore the previous Worker version/configuration; keep the old
`FMCV_UPSTREAM_KEY` secret for that purpose. Do not rotate `AISAR_MODEL_KEY`,
which signs tenant runtime credentials. The old gateway was returning HTTP 500
on 13 September, so verify a real completion before rolling traffic back.
