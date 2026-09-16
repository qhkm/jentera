# Signed external report triggers — pilot

Deferred from launch on 16 September 2026. The implementation and tests are
preserved in [the deferred source pack](../../future/external-triggers/README.md),
outside active app/Worker build paths. Its UI, API wiring, discovery/flags and
migration were removed from launch, without reverting core recovery or other
launch work. Nothing was enabled, migrated or deployed to production.

The remainder records the archived pilot design and its pre-deferral verification,
not features available in the launch product. Restoration needs a separate
feature branch, fresh review/tests and explicit release/canary authorisation.

## Permission boundary

An owner grants an external service permission to request exactly one fixed
internal report: `business_summary`, `weekly_summary` or `approval_reminder`.
Reports use the existing deterministic SQL jobs, appear in Activity and notify
the authorising owner through the inbox/push outbox. There are no model calls,
runtime wake-ups, browser/network ports, customer messages, connector writes,
approvals granted, credentials returned or arbitrary task instructions.
Report results carry trusted `reportOnly` metadata; Activity renders their
content as data and cannot interpret embedded chat control fences as handoffs.

The main control-plane Worker generates a separate random 256-bit HMAC key per
trigger, shows it once to the authenticated owner and stores an AES-GCM sealed
envelope binding it to the trigger and business IDs. This is a service signing
key, not a customer's Google/browser/password credential and not a new general
vault capability. It never enters the agent runtime, chat, queue or logs.
The sender must store its key securely outside chat and client-side JavaScript.
Losing a create response requires revocation and a new trigger; list/retry does
not reveal or rotate the key.

## Owner API

Owner controls are discovered through the existing `/api/me` response only when
`EXTERNAL_TRIGGERS_MANAGEMENT_ENABLED=true`, an owner business is resolved and
API version 1 is supported. This schema-ready switch must remain unset until
migration `051` has been applied. It does not enable creation or incoming events.
Keep it on when pausing ingress so existing grants remain visible and revocable.
Demo/staff/older-backend sessions make no trigger requests. The UI is keyed by
the authenticated account and business; live endpoints recheck authorisation.

Creation uses a separate review step stating the exact fixed task, expiry in
Kuala Lumpur time (UTC+8), business-wide quota and lack of external actions.
Owners choose 1, 7 or 30 days; configuration remains immutable. The signing key
is masked, shown only in the successful one-time dialog and never written to
local/session storage or copied automatically. Closing, leaving the page or
changing account/business removes it. Explicit copy explains that the device
clipboard may be synced/read elsewhere; we do not claim to erase OS clipboards
or securely wipe JavaScript memory. Sender URLs must exactly match the trusted
configured HTTPS API origin and the new trigger ID; malformed responses fail
closed without rendering raw error text.

Requests are bounded to 15 seconds; failed/uncertain creation is not retried.
Metadata is refreshed for recovery, but an initially absent row after a timeout
is not treated as proof that the server transaction failed. The uncertain grant
must be revoked (or confirmed revoked/expired by a later read) before another
grant is created in that visit. There is no secret reveal/recovery endpoint.
Revocation has a separate confirmation with Cancel/Escape and keyboard focus
restoration; it remains usable while ingress is paused, including expired grants.

Session/bearer authentication resolves the business; request-supplied tenant IDs
are rejected. Only an owner may list, create or revoke. Writes additionally
require an exact configured `Origin` (including trusted native origins where
configured). All responses are private/no-store.

- `GET /api/external-triggers`: metadata, allowed tasks, availability and limits.
- `POST /api/external-triggers`: strict `{id,name,task,timeZone,expiresAt}`.
  `id` is a lowercase UUID; `timeZone` is `Asia/Kuala_Lumpur`; expiry must be in
  the future and no more than 30 days away. Returns `201`, metadata, fixed HTTPS
  URL and one-time `secret`. Duplicate IDs return `409` without secret recovery.
- `DELETE /api/external-triggers/:id`: irreversibly revokes and clears ciphertext;
  records the revoking owner. Idempotent and allowed even with the pilot off.
  Other tenants see `404` and staff cannot perform these operations.

Limits: three active triggers, 100 retained configurations and 20 accepted events
per UTC day across the entire business. Configuration changes require a new
grant; task/tenant/authoriser columns are not updateable by the API database role.

## Sender protocol

`POST https://api.jentera.ai/api/webhooks/external/:id`, no query parameters,
cookies, bearer credentials or browser Origin. Strict UTF-8 `application/json`
(optional `charset=utf-8`), no content encoding, actual body at most 2 KiB and
upload at most five seconds. Only `{ "eventId": "lowercase-UUID" }` is accepted.

Headers:

- `X-Jentera-Timestamp`: Unix seconds, within five minutes of server time.
- `X-Jentera-Signature`: `v1=` followed by lowercase hex HMAC-SHA256.

Decode the displayed secret as hex to 32 bytes. Sign this exact UTF-8 message,
with LF newlines and no trailing newline added:

```text
v1
POST
/api/webhooks/external/:id
<timestamp>
<exact request body>
```

The MAC is verified by WebCrypto. Version, method, path, timestamp and body are
bound; neither a callback URL nor an unsigned bearer token grants authority.
An accepted event returns `202 {ok:true,receipt:<eventId>,duplicate:false}`.
Identical retries return `200` with `duplicate:true`; changed body bytes for the
same ID return `409`. Re-sign the same bytes with a fresh timestamp when retrying
outside the freshness window; do not generate a new event ID to retry a task.
Never blindly retry `429`/`503`; honour Retry-After where present and use bounded
backoff. The response contains no report, run ID or business data.

## Database and failure controls

The business and authoriser come from the server-stored grant. Membership and
email verification are checked again at acceptance, alongside expiry,
revocation, pilot allowlist and platform access. Business-wide advisory locks
serialize acceptance/quota/create/revoke; owner membership rows are share-locked
during acceptance. A revoke that has returned prevents later acceptance.

Tenant-owned grants and receipts use FORCE RLS under `aisar_app`, with inherited
broad default table grants explicitly revoked. Composite foreign keys bind each
receipt to a trigger and run in the same business. A separate
private routing-metadata table (opaque ID, business ID, expiry, revocation only)
is maintained transactionally by a restricted database trigger. The API role
cannot directly read, list or write it. Its only pre-auth lookup is an exact-ID
security-definer function with fixed search path, no public EXECUTE and no
dependence on superuser/BYPASSRLS privileges. Current grant/secret validation then
runs in the resolved tenant transaction.

Run, structured report, receipt, notification and push outbox insertion commit
together. Failure rolls everything back, so retries cannot duplicate work or
lose a notification. Receipts are append-only to the API role and retained for
replay protection. The per-business quota is durable/global; existing WAF and
API rate-limit bindings provide an additional burst brake. Removing a report
only clears its receipt's run link; it cannot erase the receipt and permit
re-execution. The quota and receipt share one actual database acceptance clock,
so a lock wait across UTC midnight cannot misattribute the event to yesterday.
External ingress fails closed if the burst limiter is unavailable. Raw events, signatures,
credentials and database error details are not logged or returned.

## Release sequence and remaining work

1. Owner-facing creation/review/one-time-key/revocation controls are implemented
   locally. Verify mobile/desktop EN/BM layouts and owner permission transitions.
2. Release the frontend notification-kind compatibility and report-data handoff
   gating changes before enabling ingress; older clients reject unknown kinds
   and do not have the new report-data boundary.
3. Apply migration `051` using `pnpm db:migrate:external-triggers` with the
   reviewed production owner connection; the script checks database privileges
   and forced RLS in the same transaction. Do not use the obsolete D1 scripts.
4. Deploy the Worker with `EXTERNAL_TRIGGERS_ENABLED=false`/unset; advertise owner
   controls with `EXTERNAL_TRIGGERS_MANAGEMENT_ENABLED=true` only after step 3.
   Set both
   `EXTERNAL_TRIGGERS_ENABLED=true` and a specific comma-separated
   `EXTERNAL_TRIGGERS_BUSINESSES` allowlist only for an explicitly owner-approved
   bounded canary plan; start with one business, not a broader rollout.
5. Configure the chosen sender outside chat; test one accepted event, identical
   replay, bad signature and revocation. Keep broader rollout off until the
   canary passes; pause ingress/revoke if it fails. There is no production canary yet.

Remaining: production release/owner-approved canary, sender-specific adapters, alerting/retention cleanup,
per-source budgets and any future arbitrary-agent tasks. Agent invocation must
first have enforceable tool restrictions and external-data trust boundaries,
not merely prompt wording. Local access remains a different, deferred pilot.
This implementation is not an independent security audit, a compliance
certification or a promise of zero risk/liability.

## Local verification (16 September 2026)

- Frontend full suite: 101 files / 938 tests pass; final trigger-focused suite:
  45 tests pass, including the one-time warning's initial keyboard focus.
- Worker full suite: 90 files / 1,049 tests pass; both typechecks and the
  production frontend build pass. Shared permission rules govern discovery.
- Fictional browser checks pass for all eight mobile/desktop EN/BM dark/light
  cases (320–1440 px, including short screens), covering review/key/revocation,
  paused-pilot controls, keyboard focus, existing connectors/recovery/Markdown
  and core routes without overflow or browser-console errors.
- No production migration, deployment, enablement, sender provisioning or live
  canary was performed. The runtime/bootstrap pin and native assets are unchanged.

Security references checked during implementation:
[OWASP REST security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
and [WebCrypto verification](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify).
