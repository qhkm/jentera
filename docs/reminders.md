# Personal reminders

All chat wording goes through the normal agent. There is no phrase-matching bypass.
The agent interprets natural-language dates using a supplied per-turn UTC timestamp
and emits a structured `jentera-reminder` JSON block in its final response. This is
a proposal protocol, not a native runtime tool or permission to write a reminder.
The app validates it and renders an editable confirmation card. The durable run ID
is the idempotency key; model-supplied IDs are ignored. Null dates remain blank for
clarification. Relative dates retain seconds; expired dates require correction.
The raw proposal is retained in the durable reply so reopening a chat can restore
the card, but hidden in the rendered reply. Telegram has no interactive card;
confirmation is in the app. One-time only; recurring work remains in Routines.

Confirmed reminders live in Postgres, not browser timers or the agent computer.
Routines → My personal reminders reads the server's pending list and supports
cancellation even when local chat history is gone. Reminders are personal, including
when requested from a shared chat: tenant and recipient checks protect reads/writes.

The existing one-minute scheduler calls `dispatchDueReminders` before draining the
push outbox. Row locking, inbox creation, push enqueue and the sent state share one
transaction. Late reminders are delivered, not discarded. `sent` means handed to
the inbox/outbox, not proof a device displayed the push. Permission, subscription,
push-provider configuration and device connectivity still govern push delivery.

## Release order

1. Apply `worker/migrations/040_reminders.sql` using the verified database-owner
   migration workflow. It adds the tenant-isolated reminder table, a bounded
   SECURITY DEFINER due-target scan and the `reminder_due` notification kind.
2. Deploy the Worker, then the frontend. This change does not require a runtime
   bundle release; agent instructions come from the Worker.
3. With a test account/device, confirm a reminder a few minutes ahead. Verify the
   pending list, one inbox entry, and device push. A successful queue test alone
   does not verify phone delivery. Test cancellation separately.

API: POST `/api/reminders` uses a client-generated UUID as the idempotency key;
GET lists the caller's pending reminders; GET/DELETE `/api/reminders/:id` checks
or cancels a caller-owned reminder. Retries must keep the original key and body.
Maximum 100 pending reminders per person; due time must be within the next year.
