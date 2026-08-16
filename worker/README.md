# aisar-api — the executor behind the tool contract

A Cloudflare Worker implementing the same tool contract the client already speaks. The app runs fine without it; set `VITE_API_URL` and approvals plus execution move server-side.

```bash
pnpm install
pnpm db:local          # apply schema.sql to the local D1
pnpm dev               # http://localhost:8788
pnpm typecheck
```

## What is real, and what is not

**Real and tested:** the HTTP contract, the risk gate, the approval queue in D1, the append-only audit log, business scoping, and the single-execution guarantee.

**Not real:** outbound calls to providers. `src/connectors.ts` is the boundary — every connector returns "not wired to a live provider yet". Executing against WhatsApp, Google or Shopee needs OAuth app registrations and per-tenant tokens that must be created in each provider's console first. That is the only thing standing between this and production.

To go live for one connector: register the app, `wrangler secret put ITS_SECRET`, and replace that connector's `execute` body. Nothing upstream changes.

## The rule this enforces

Anything above low risk is queued for a human and never executed on the agent's say-so. Risk comes from the op, not the caller:

| Risk | Ops | Behaviour |
|---|---|---|
| high | `send` `pay` `cancel` `refund` | queue for approval |
| medium | `update` `book` | queue for approval |
| low | `read` `list` `export` | execute immediately |

`TOOL_RISK` in `src/index.ts` mirrors `src/lib/data/risk.ts` in the app. **Keep the two in step** — the client uses its copy to predict behaviour, but the server's copy is the one that governs.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/tools/call` | Queue or execute, per risk |
| GET | `/api/approvals?business=&status=` | List, scoped to one business |
| POST | `/api/approvals/:id/decide` | Approve (executes) or reject |
| GET | `/api/health` | Liveness |

### Single execution

`decideApproval` updates with `WHERE id = ? AND status = 'pending'` and checks `meta.changes`. Two concurrent approvals of the same row cannot both execute — the second matches no rows and gets a 409. This is the guarantee that matters most, since approving is what actually sends things to customers.

Verified locally:

```
POST /api/tools/call  {op:"send"}   → queued, risk=high, not executed
POST /api/tools/call  {op:"read"}   → executed immediately (low risk)
POST /api/approvals/:id/decide      → reaches executor
POST /api/approvals/:id/decide      → HTTP 409, "not pending"
GET  /api/approvals?business=other  → [] (scoping holds)
```

## Deploying

```bash
npx wrangler d1 create aisar          # paste the id into wrangler.toml
pnpm db:remote                        # apply the schema
npx wrangler deploy
```

Then set `VITE_API_URL` in the app to the deployed URL and add its origin to `ALLOWED_ORIGINS`.

## Before it faces the internet

Not done here, and required before this handles anyone's real business:

- **No authentication.** Every endpoint is open, and `business` is caller-supplied — anyone could read or approve another tenant's queue. Needs real auth and a server-derived tenant id.
- **No rate limiting.**
- **No webhook verification** for inbound provider callbacks.

The schema and routing are shaped to accept these; none of them are written yet.
