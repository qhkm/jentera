# AISAR agent runner

The narrow per-business HTTP service placed in front of Hermes. The Sprite URL routes to
the runner on port 8080; Hermes listens only on `127.0.0.1:8642`.

The runner provides liveness, authenticated detailed readiness, idempotent task start,
status, and cancellation. Its small state file survives a process restart and contains
only AISAR task ids, Hermes run ids, statuses, and a hash of the task lease—never the
plaintext lease or an API key.

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

This runner does not yet proxy Hermes event streams or approvals. More importantly,
instructions are not a security boundary: production bootstrap remains disabled until
Hermes tools and Sprite egress are proven unable to bypass the AISAR tool gateway.

`bin/hermes-service.sh` and `bin/runner-service.sh` are the Sprite service
entrypoints. Both read a mode-0600 environment file instead of embedding credentials
in service definitions. `bin/configure-dev-sprite.sh` exists only for manual smoke
environments; production provisioning must write the two control-plane-generated keys.
`bin/smoke-sprite.sh` checks both public liveness and authenticated readiness from
inside a Sprite without printing either credential.
`bin/browser-smoke.mjs` is a model-free Chromium launch and DOM check for the pinned
Sprite image; it is diagnostic, not part of the runner service.
