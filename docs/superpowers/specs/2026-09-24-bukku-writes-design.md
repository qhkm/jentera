# Bukku writes behind the owner's approval

Status: design, 24 September 2026. No code, no migration, no deployment.
Every decision below was taken with the owner in one session. The Bukku API
facts were read from the published OpenAPI specs at
`developers.bukku.my/specs/bukku-{sales,contacts}-api.yaml` the same day. The
field requirements marked **provisional** wait on the staging check in step 1
of the rollout.

## Why

The 23 September comparison with OpenMausBot recorded "the agent cannot reach
Bukku" (`docs/todo.md`, `docs/openmausbot-comparison.md`). **Half of that was
wrong.** The pinned Hermes (`v2026.9.22`) ships a Jentera plugin,
`plugins/jentera/tools.py`. Its `business_records` tool calls
`POST /v1/runtime/connector` with `connector: "Bukku", op: "list"` and reads
invoices and contacts. The search that missed it looked only in this
repository, and Hermes lives in `qhkm/hermes-agent`.

What was right, and what this design closes:

1. **The owner's permissions do not govern Bukku.**
   `routes/runtime-connector.ts` decides with the fixed `riskOf` table
   (`risk.ts`), not `policyFor` (`policy.ts`). An owner who sets `list` to
   Ask me or Blocked still has Bukku read automatically. Google Calendar
   obeys the same control. This is the "two vocabularies" bug `policy.ts`
   was written to end.
2. **Nothing can write to Bukku.**
   - The executor in `connectors.ts` reads only.
   - The route answers 403 `needs_approval` ("cannot be asked for from here
     yet") to anything above low risk, instead of queueing an approval.
   - The decide route in `routes/repo.ts` can execute only Calendar
     `create_event` and Telegram `send_message`.

## Decisions taken with the owner

| Question | Decision |
|---|---|
| Which writes | Draft a quotation, draft an invoice, add a customer contact, record a payment received. All four. |
| How they appear on the Permissions screen | Two new controls, "Create quotations, invoices and contacts" and "Record payments received", so payment recording can be blocked on its own |
| Document state after approval | **Draft in Bukku.** Quotations, invoices and payments are created with `status: draft`. The owner finalises them in Bukku, so nothing posts, nothing counts as owed and nothing reaches MyInvois until they do. Contacts have no status and are created as they are. |
| Whether an owner can let writes run without asking | **No. Bukku writes always ask.** The two new controls offer Ask me and Blocked only. |
| Where the agent's tool lives | **Approach A: a tool in the Hermes Jentera plugin**, beside `business_records`. Not a runner CLI wrapper (B), and not a block in the reply for the app to parse (C). |

Approach A was chosen for three reasons:

- Reads and writes stay in one place.
- The input is structured and checked, not JSON typed into a shell command.
- No instructions are added to every turn.
- It is the only one of the three that works the same on Telegram and in
  the app.

Its costs are a Hermes tag and a runtime release.

## Scope

In:

- Reads follow `policyFor`.
- The four writes, each queued for the owner's approval and executed as a
  Bukku draft on Approve.
- The two Permissions controls.
- The approval cards.
- Owner notifications.
- The `business_records` read gains contact ids.

Not in version 1:

- Approve and Decline buttons in Telegram. Approval happens in the app, and
  the agent says so.
- Editing a proposal in Jentera. The draft is edited in Bukku.
- Emailing a quotation or invoice to the customer through Bukku. That is a
  `send`, and it needs its own decision.
- Credit notes, refunds, purchase documents, products and stock.
- Posting (`ready`) documents from Jentera.

## Design

### 1. Permissions

Two new operations join `OPERATIONS` in `worker/src/policy.ts` and
`app/src/lib/permissions.ts`. The existing test fails if the two lists
disagree.

| Operation | English | Bahasa Malaysia | Default | Choices offered |
|---|---|---|---|---|
| `record_create` | Create quotations, invoices and contacts | Cipta sebut harga, invois dan kenalan | Ask me | Ask me, Blocked |
| `record_payment` | Record payments received | Rekod bayaran diterima | Ask me | Ask me, Blocked |

Both are active controls, in `PRIVATE_OPERATIONS`, not the dormant
`CUSTOMER_OPERATIONS`.

`GOVERNED_BY` gains:

| Key | Permission |
|---|---|
| `bukku:list` | `list` |
| `bukku:read` | `read` |
| `bukku:create_quote` | `record_create` |
| `bukku:create_invoice` | `record_create` |
| `bukku:create_contact` | `record_create` |
| `bukku:record_payment` | `record_payment` |

There are two enforcement points, and both are needed:

- The policies route refuses `automatic` for either new operation, with 400.
- `policyFor` reads a stored `automatic` on either as `approval`. That is
  belt and braces against a row written some other way.

A setting that shows Automatic but asks anyway is exactly the kind of
control that silently does nothing, which `policy.ts` exists to prevent.

`action_policy.op` has no check constraint (`003_state.sql`), so there is
**no migration**.

### 2. The agent's tool: `propose_business_record`

The tool is new, in `plugins/jentera/tools.py` in `qhkm/hermes-agent`, and is
registered beside `business_records`. It is available only where
`business_records` is, meaning a Jentera runtime credential is present.

Arguments are checked in the tool before any call:

| Field | For | Rule |
|---|---|---|
| `kind` | all | `quotation`, `invoice`, `contact` or `payment` |
| `customer` | quotation, invoice, payment | A name or email as the owner said it, 1–120 chars. Never a Bukku id. |
| `lines` | quotation, invoice | 1–50 of `{description 1–200, quantity > 0, unit_price ≥ 0}` |
| `date` | quotation, invoice, payment | `YYYY-MM-DD`, optional. Defaults to today in Malaysia. |
| `title`, `notes` | quotation, invoice | Optional, ≤ 120 and ≤ 1000 chars |
| `invoice` | payment | The invoice number, e.g. `INV-00042` |
| `amount` | payment | > 0, two decimals |
| `name` | contact | 1–120 chars |
| `email`, `phone` | contact | Optional, and checked for format |

The call sends `{connector: "Bukku", op, args, runId}` to
`/v1/runtime/connector`, where `op` is one of `create_quote`,
`create_invoice`, `create_contact` or `record_payment`. The answer is a
single sentence the agent relays, for example: "Drafted for the owner's
approval. They can approve it in Jentera → Activity."

`business_records` gains contact ids in its contact list. The new tool does
not need them, but an agent should not have to guess which of two "Ali"s the
owner means.

### 3. The Worker's write path

This is `routes/runtime-connector.ts`. The tenant comes from the runtime
credential alone, as it does today.

1. **Permission.**
   - The agent names the connector `Bukku`, which is the `EXECUTORS` key
     and the `connection.connector` value. The route maps it to the policy
     key `bukku` in one place.
   - The approval row is written with `connector 'bukku'`, and the app card
     and the dispatch table both read `bukku`.
   - `bukku:read` is mapped so that the executor's existing `read` op is
     not silently blocked by the unmapped-action rule.
   - Run `policyFor(tx, 'bukku', op)`.
   - Blocked answers 403 `blocked` with a sentence the agent can relay.
   - Reads (`list`) that are not `automatic` answer 403 `APPROVAL_REQUIRED`
     or `BLOCKED`, as Calendar's `/events` does.
2. **Validation.** The server repeats every rule in the table above; it
   never trusts the plugin. The currency is MYR. The 4 KB argument cap is
   raised to 16 KB for writes only.
3. **Resolution.** The Worker turns names into Bukku ids with the stored
   token, via `connectors/bukku.ts`:
   - **Customer.** `GET /contacts?search=`. Exactly one match is used. None,
     or more than one, answers 409 with the candidates by name. For example:
     "Two contacts match 'Ali': Kedai Ali, Ali Trading. Ask the owner which."
   - **Payment's invoice.** `GET /sales/invoices` for that customer, matched
     by number. The invoice must exist, belong to that customer, be `ready`
     and not be fully paid. An amount above the outstanding balance is
     refused.
   - **Accounts (provisional).** If staging shows that invoice or quotation
     lines need `account_id`, or that a payment needs a deposit account,
     the Worker reads the company's default sales account and default bank
     account from Bukku's lists API. If a default cannot be determined, it
     refuses with a sentence rather than guessing an account.
4. **Queue.** One `approval` row is written with these fields:
   - `connector 'bukku'`
   - `op`
   - `risk 'medium'`
   - `expires_at now() + 7 days`
   - `args` holding both the readable request (names, lines, totals) and
     the resolved ids, plus `connectionId`, `runId` and `requestKey`

   So the owner approves exactly what will be sent. `requestKey` is the
   sha256 of the resolved request. Under an advisory lock, a pending,
   approved or executed row with the same key is returned instead of
   creating a second one, as Calendar's `requestId` does.
5. **Tell the owners.** Every owner gets an `approval_requested`
   notification, sent at once with `deliverPendingPushes`. The run trace
   gets `action.proposed`, carrying `{connector, op}` and nothing about
   amounts or customers.
6. **Answer** 202 `{ok, approvalId, status: 'needs_approval', message}`. A
   duplicate answers 200 with the existing row's status.

### 4. The approval card

This is `app/src/routes/views/ApprovalInbox.tsx`, beside the Telegram and
Calendar cards. The card is written for people and never shows raw JSON.
English and Malay copy come from `i18n/pages.ts`.

- **Quotation:** **Quotation draft for Kedai Ali**, then one line per item
  (`20 × Kotak kertas @ RM12.00`), then `Total RM240.00 · 24 Sep 2026`, then
  "Created as a draft in Bukku. You finalise it there."
- **Invoice:** the same layout, headed **Invoice draft for …**.
- **Contact:** **New Bukku contact: Kedai Ali**, then the email and phone
  when given.
- **Payment:** **Record RM500.00 received from Kedai Ali**, then "Against
  INV-00042 (RM800.00 outstanding) · 24 Sep 2026 · as a draft".

The only actions are **Approve** and **Decline**. After a decision the card
shows the outcome, for example "Draft QT-00012 created in Bukku. Open Bukku
to finalise it", or the failure reason.

An approval of a connector or operation the app does not know still renders
as a generic card: its operation and connector, with Approve and Decline. It
never disappears.

### 5. Execution on Approve

This happens in the decide route (`routes/repo.ts`). It is owner-only
(`approvals.decide`) and runs once, through the existing conditional
`update … where status = 'pending'`.

- **Expired first.** If `expires_at < now()`, the row becomes `expired` and
  the answer says so. Nothing reaches Bukku for a request that has gone
  stale.
- **Dispatch.** The decide route calls `executeApproved(env, businessId,
  approval)` from a small table in `connectors.ts`, keyed `connector:op`,
  instead of adding a third hand-written branch. Telegram and Calendar keep
  their current code. Moving them onto the table is a later refactor, not
  part of this design.
- **Bukku call.** It re-reads the token inside the tenant transaction by the
  stored `connectionId`, and refuses if that connection is no longer
  connected. Then it `POST`s the create endpoint:
  - `/sales/quotes`, `/sales/invoices` or `/sales/payments`, each with
    `status: 'draft'`;
  - or `/contacts`.

  It sends the resolved ids and nothing the model wrote beyond the checked
  fields.
- **Success.** The approval becomes `executed`, with `result: {id, number}`.
  The trace gets `action.executed {connector, op, ok: true}`, and the
  connection is marked healthy.
- **Failure.** The approval becomes `failed`, with an owner-facing reason.
  - A 401 marks the connection expired: "Bukku rejected the saved token —
    reconnect Bukku".
  - A 403 marks it a problem.
  - A provider body never reaches the screen.
  - **Nothing retries automatically.** A financial write retried blind is
    how duplicates are made, and the owner can ask again.
- **Decline.** The approval becomes `rejected`, and the trace gets
  `approval.rejected`.

## Rollout

Each step is safe if the next never ships.

1. **Staging check (the owner provides access).**
   - Create a company on Bukku staging (`api.staging.bukku.dev`, which the
     spec lists as the staging server) and an API token.
   - A script, `worker/scripts/bukku-staging-check.mjs`, creates one of
     each document as a draft.
   - It records which line and payment fields are actually required.

   The provisional parts of section 3 are settled here, and the spec is
   amended before code depends on them. The script is run by hand and never
   in CI, because it writes to a real, if staging, Bukku.
2. **App deploy.**
   - The two new controls.
   - The four cards and the generic fallback.
   - Fetch and rebase before `deploy.sh`, so it cannot roll back live work.
3. **Worker deploy.**
   - The write path and execution, with reads on `policyFor`.
   - Before deploying, check production for owners whose `list` policy is
     not automatic: `select op, policy, count(*) from action_policy where
     op in ('read','list') group by 1, 2`. Their Bukku reads start asking,
     which is correct, and they will notice.
4. **Hermes.**
   - `propose_business_record` and contact ids in `business_records` go into
     `qhkm/hermes-agent`.
   - A new tag in `vYYYY.M.P` form; a suffix fails every bootstrap.
   - `HERMES_TAG` and `HERMES_COMMIT` are bumped in
     `worker/src/runtime/hermes-pin.ts`.
   - `ship-runtime.sh --dry-run`, then the release.

   Until this lands, the agent has no write tool, and nothing else changes.
5. **Live check.**
   - Reconnect Kitakod's Bukku, which is disconnected today.
   - Ask in chat for a quotation.
   - The card should appear. After Approve, a draft should be in Bukku with
     the number the card shows.
   - Then decline one, and confirm Bukku is untouched.

## Testing

Tests are written first.

**Worker** (real Postgres; arrange as owner, assert as `aisar_app`):

- Every write op under Blocked and Ask me.
- A stored `automatic` on the new ops reads as `approval`.
- The policies route refuses `automatic` for them.
- Reads refused under Ask me and Blocked, and allowed under Automatic.
- Resolution:
  - no contact, several contacts;
  - an invoice not the customer's;
  - an invoice already paid;
  - an amount above the balance.
- The same request twice gives one row.
- Approve creates a draft. A fake Bukku asserts the exact body, including
  `status: 'draft'`, and the number is stored.
- Bukku 401 leaves the connection expired and the approval `failed`, with
  no retry.
- Decline, and expiry at 7 days.
- A staff member cannot decide.
- `policy.test.ts` covers the new keys.

**Bukku client:** a fake fetch asserts the path, headers (`Company-Subdomain`)
and body for each create, and that the token never appears in an error
message.

**App:**

- The two controls offer exactly Ask me and Blocked.
- Each card kind renders in English and Malay.
- An unknown approval renders the generic card.

**Hermes:** plugin tests beside `tests/plugins/jentera/test_business_records.py`
cover the argument rules and the request each kind sends.

## Housekeeping in the same work

- `docs/todo.md`: rewrite the Bukku row. The agent does read Bukku, and the
  real gaps are the two in "Why".
- `docs/openmausbot-comparison.md`: correct the first gap the same way.

## Open questions, answered by the staging check

- Do line items without a `product_id` need `account_id`? If so, which
  account is the company's default sales account, and how do we read it?
- Does a payment need a deposit account? If so, where is the default read
  from?
- Does `POST /contacts` require a contact type? That would be customer or
  supplier.
- Does a draft payment still record the link to the invoice, so that
  finalising it in Bukku marks the invoice paid?
