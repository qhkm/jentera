# Procedure Lab: demonstration capture

## Goal

Let an owner explicitly teach Jentera a browser task by performing it once in
the existing Business Browser. The first slice observes the demonstration and
returns a review-only, versioned draft. It does not activate, replay, schedule,
or silently modify a procedure.

The owner-facing language is **Teach Jentera**. “Procedure Lab”, event capture,
CDP, request shapes, selectors and generated code remain implementation terms.

## First slice

1. The owner takes exclusive control of the business desktop.
2. They choose **Teach Jentera**, name the intended outcome, and explicitly
   start recording.
3. The runner observes the same persistent Chromium session while the owner
   drives it over VNC.
4. The owner stops recording and reviews a draft containing semantic browser
   steps and possible request-level connector candidates.
5. Hand-back resumes the existing Jentera browser boundary. A hand-back,
   reclaim, restart, or confirmed close cancels an unfinished recording.

This is intentionally ephemeral. A draft crosses the authenticated,
owner-only, `private, no-store` browser-control response and exists in the
current UI only. Durable procedure storage begins after the capture contract
has passed real demonstrations.

## Capture contract

The runner may retain in recording state for at most one active demonstration:

- objective, timestamps and an opaque recording id;
- normalized HTTPS origin and path templates;
- query names and typed placeholders, never query values;
- request method and resource class for document/XHR/fetch traffic;
- bounded JSON/form structure whose scalar values have already been replaced
  by typed slots or opaque `vault_or_browser_session` credential references;
- semantic element kind, role, input type and bounded accessible label; and
- click, first-input, change, submit and top-level navigation events.

The trusted runner may inspect a bounded request URL or body synchronously in
memory to parameterize it. The raw object is discarded before the event enters
recording state. It never persists or returns:

- typed values, clipboard contents, passwords or one-time codes;
- cookies, authorization-header values or any request/response header values;
- raw request or response bodies;
- screenshots, video, audio, pointer coordinates or raw selectors;
- URL query values, fragments or embedded URL credentials; or
- non-HTTPS locations.

Numeric, UUID-shaped, encoded and long opaque path segments are replaced with
templates. Password-field interactions are omitted entirely. Recording is
bounded to 400 events and 20 minutes; overflow marks the draft truncated.

The Worker reconstructs the allowed DTO field by field. It does not relay an
arbitrary runner response. This is a second boundary, not an assumption that
the private runner stayed correct.

## Draft schema

Version 1 is deliberately small:

- `navigate`, `input`, and `interact` browser steps;
- evidence ids linking each generated step to one observed event;
- request-shape connector candidates with model-safe query/body templates,
  which remain evidence rather than runnable connectors;
- explicit false flags for captured values, headers and bodies; and
- `review_required` activation.

No generated step is executable in this slice. A request candidate must never
be treated as permission to replay a private API. Every scalar becomes a typed
slot; credential-shaped fields become opaque references. Unknown, multipart,
or bodies larger than 32 KiB are marked `browser_only` instead of being guessed.

## Credential and model boundary

This follows the useful part of Akai's published model without copying its
claims: learn the server-call contract underneath an explicit demonstration,
prefer a reviewed connector over brittle screen replay, and stop when the
contract changes. Jentera's additional invariant is mechanical: credential
material does not enter a procedure draft or a model prompt.

At execution time, ordinary inputs are supplied to typed slots. Authentication
is fulfilled after the planning/model boundary using either the existing
persistent browser session or an opaque vault secret selected by Control. A
short-lived, tenant-and-run-bound grant authorizes the connector operation; it
does not reveal the credential. Passwords, cookies, bearer tokens, API keys and
one-time codes are never substituted into model-visible text. Team members use
their own credential binding rather than sharing one recorded login.

The current slice produces the parameterized contract only. It does not yet
deposit new browser credentials, mint connector-scoped grants, or execute the
captured request.

Public references used for the product boundary:

- [How Akai works](https://www.akai.run/) — explicit demonstration, underlying
  server calls, connector-first execution, per-user credentials and review.
- [Akai control model](https://www.akai.run/blog/the-control-model-behind-every-akai-workflow/)
  — deliberate recording, deterministic steps, approval gates, checkpoints and
  stop-and-escalate behavior.

## Next gates

The owner-visible execution and audit contract is specified separately in
[`2026-09-22-procedure-observability.md`](2026-09-22-procedure-observability.md).
It must land before supervised execution.

1. Exercise capture against a synthetic site, then a real Bukku demonstration
   using non-production records.
2. Measure missing, duplicated and incorrectly grouped steps.
3. Add narration as a separately consented transcript, not always-on audio.
4. Compile observations into typed procedure steps with inputs, outputs,
   assertions, decisions and approval boundaries.
5. Store immutable demonstrations and versioned drafts in tenant-scoped
   Control storage with explicit retention and deletion.
6. Add supervised replay. Stop on drift or uncertainty; never guess a target.
7. Compare owner corrections and propose a new version. Historical replay and
   owner approval are required before activation.
8. Promote repeated browser work to reviewed connector calls only when the
   credential, provider-policy, idempotency and response-contract boundaries
   are understood.

## Release boundary

This slice changes the runner bundle, Worker browser-control allowlist/DTO, and
the app together. Ship in that order through the runtime release process: push
the bundle commit, pin it with `ship-runtime.sh`, deploy the Worker contract,
then publish the app. Older runtimes safely omit `procedureCapture`, so the UI
does not offer teaching until the new capability is actually present.
