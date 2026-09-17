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
