# Operator account removal

Account removal is an operator-only procedure, not a tenant or public API.
Resolve the exact user IDs and emails with read-only checks first. Review other
workspace members, active work and billing before authorizing removal. Do not
infer a domain-wide ban from an individual account removal request.

From `worker/`, explicitly provide the reviewed pairs:

```sh
node scripts/remove-blocked-accounts.mjs --apply UUID=email [UUID=email ...]
```

The script reads the existing private `~/.config/neon/owner-url` file, validates
the production database and installs migration 058. Do not put a connection
URL, password or customer records in shell arguments or logs.

Removal is a serializable transaction. It fails closed on changed identities,
other workspace members, active runs, paid grants, or unhandled user
dependencies. It requires a verified AES-256-GCM recovery snapshot before
deleting account, session, OAuth and preview-ledger records. Matching login
tokens and waitlist entries are removed, and access grants revoked. Businesses,
computers, files, facts, run results and task history are retained; nullable
fact-confirmation and run-requester links are detached rather than cascaded.

Recovery metadata is encrypted under the owner-only
`~/.config/jentera/offboarding-backups/` directory. Each `.json.enc` file is
verified by reading it back and decrypting it before deletion proceeds.
`recovery.key` is a separate owner-only file. Both are required for recovery;
never publish either, commit them, or restore a deleted identity automatically.
Restoration and lifting a block require an explicit operator decision.

## Resetting private test accounts for fresh signup

Account blocking is deliberately the default. When the operator explicitly
wants a private test account to register again, use the separate command:

```sh
node scripts/reset-test-accounts.mjs --apply UUID=email [UUID=email ...]
```

This uses the same production-target, exact-identity, serializable-transaction
and verified encrypted-backup checks. It refuses shared workspaces, active work,
Stripe-linked or paid workspaces, billing evidence, unsupported dependencies,
and existing account/identity blocks. It never lifts a ban.

The original account, OAuth links, sessions, login links and preview quota are
removed so normal verified sign-in creates a new identity and onboarding starts
fresh. Internal legacy allowlist grants may be removed only after confirming
the workspace is free, has no Stripe link and has no billing evidence. No
subscription is cancelled or refunded by this tool.

Old businesses, Sprites, files and completed runs remain untouched for recovery;
they are never assigned to the replacement identity. Private chat metadata is
backed up before removal, its completed runs detached from the deleted chat,
and the departed owner's connector intake marked revoked. Connector credentials
and external files are retained, not securely purged or remotely revoked.
Only use this for explicitly reviewed private testing, never as a customer
self-service reset or a way around the lifetime trial limit. Removing an
unbilled legacy grant matters: merely revoking it would correctly keep that
address out of the ordinary preview, making a fresh-signup test impossible.

Operator-only `account_block` and `account_identity_block` records survive
deletion. Database triggers reject blocked account creation/changes, magic-link
issuance, Google identity linking and new sessions, including from older Worker
versions. The app role cannot read or modify these registries. Current auth
routes translate the fixed denial into ordinary non-enumerating auth failures
without emailing the blocked address or exposing database records.

Gmail dots, plus aliases and `googlemail.com` normalize to the same mailbox;
other providers are case-normalized only. Existing Google subjects are blocked
even if their email changes. This does not identify a person using an unrelated
email or a different Google account. Do not claim a person-wide ban or use shared
IPs/device fingerprints to block unrelated customers.

Verification:

```sh
pnpm test test/account-blocks.test.ts
node --test scripts/offboarding-backup.test.mjs
pnpm typecheck
```
