# Jentera agent runner

The narrow per-business HTTP service placed in front of Hermes. The Sprite URL routes to
the runner on port 8080; Hermes listens only on `127.0.0.1:8642`.

The runner provides liveness, authenticated detailed readiness, idempotent task start,
status, cancellation, and a filtered Hermes presentation stream. Every start additionally requires a five-minute HMAC grant
bound to that business and task. The grant permits the pinned Hermes tool bundle. Its
small state file survives a process restart and contains only Jentera task ids, Hermes run
ids, statuses, and hashes of task leases and grant nonces—never plaintext values or an
API key.

Required environment:

```text
AISAR_BUSINESS_ID
AISAR_RUNNER_KEY
AISAR_RUNTIME_RELEASE
HERMES_API_KEY
```

Optional:

```text
PORT=8080
HERMES_ORIGIN=http://127.0.0.1:8642
AISAR_RUNNER_STATE=/var/lib/aisar/runner-state.json
```

Verify locally with `npm test`. No package installation is required.

The runner is Hermes's sole run-event subscriber and exposes bounded `message.delta`
text plus native-style tool-start/tool-completion presentation events from process memory.
It discards reasoning, approvals, full tool arguments/results, unknown events, and
terminal transcripts before they cross the runtime boundary. A streaming
think-tag scrubber also removes inline reasoning split across arbitrary model chunks,
matching Hermes's native gateway filter. None of the stream is written to the state file.
It does not yet proxy Hermes-native approvals, so tools which pause for native approval
cannot currently be resumed through Telegram. The bootstrap configures
`platform_toolsets.api_server` to `hermes-api-server` plus its explicit Home Assistant
opt-in, verifies that it covers the full pinned release, and makes `toolMode: full-tools` part of authenticated
readiness. The control plane rejects a runtime that does not attest that mode. Every
production runtime is isolated per business and receives grants bound to one task.

`bin/hermes-service.sh` and `bin/runner-service.sh` are the Sprite service
entrypoints. Both read a mode-0600 environment file instead of embedding credentials
in service definitions. `bin/configure-dev-sprite.sh` exists only for manual smoke
environments; production provisioning must write the two control-plane-generated keys.
`bin/smoke-sprite.sh` checks both public liveness and authenticated readiness from
inside a Sprite without printing either credential.
`bin/browser-smoke.mjs` is a model-free Chromium launch and DOM check for the pinned
Sprite image; it is diagnostic, not part of the runner service.

## Development VRS model setup

The `jentera` development Sprite currently uses Jentera VRS through Hermes's custom
OpenAI-compatible provider with `ds4-flash`. `bin/configure-vrs.py` writes only the
provider configuration and an environment-variable reference; it never writes the model
credential into Hermes's config file.

`bin/install-vrs-env.sh` is a manual development helper for installing that credential
into the Sprite's mode-0600 runtime environment. Its input file is base64-encoded only to
make shell transfer unambiguous—base64 is **not encryption**. Keep the transfer file mode
0600, remove it immediately after installation, and never commit it. Production bootstrap
must obtain a dedicated Jentera VRS credential from the control plane's encrypted secret
store instead of copying a credential from another project.

After restarting Hermes and the runner, `bin/task-smoke-sprite.sh` submits a real,
connectivity task, waits for completion, and replays the request to verify the
runner's idempotency behavior.

The currently configured VRS endpoint is plain HTTP on a public IP. It is suitable only
for this non-customer development smoke: prompts, results, and the bearer credential do
not have transport encryption. Do not enable customer traffic until VRS is available
through HTTPS or an authenticated private tunnel/network path.

## Reproducible Sprite bootstrap

`bin/provision-sprite.sh` is the trusted operator entrypoint for an internal canary. Run
it from the repository root with the business id, release, control-plane-generated runner
and Hermes keys, and VRS settings in the environment. It deterministically names one
Sprite per business, uploads the narrow runtime bundle and a mode-0600 transfer, then
invokes `bin/bootstrap-runtime.sh` inside the Sprite.

The in-Sprite bootstrap pins Hermes to tag `v2026.8.19` and commit
`fcbd1076a93841fa88855acce810e342a5b78101`, verifies the upstream installer's SHA-256,
writes the runtime environment atomically, configures OpenRouter without inlining its
key, enforces the full pinned API-server tool profile, applies the reviewed `nanoid` security override,
requires a clean high-severity production dependency audit, recreates both services,
proves authenticated readiness and Chromium, and creates a baseline checkpoint.
Repeating it reconciles the same Sprite rather than creating a second one.

Both scripts refuse an HTTP VRS endpoint by default. `AISAR_ALLOW_INSECURE_VRS=1` exists
only to reproduce the current non-customer `jentera` smoke and must never be set by a
production provisioner. The Worker implements the same bootstrap protocol for each
business after onboarding, using an immutable public bundle commit. It remains fail-closed
behind production-bootstrap, secure transport, provisioning, provider-credential, and
global execution gates. This operator path remains useful for a non-customer smoke;
normal customer provisioning is created durably by onboarding completion.
