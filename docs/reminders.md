# Personal reminders

Signed-in web/PWA chat recognizes direct English/BM reminder commands and opens a
confirmation card instead of starting an agent task. The user reviews the message
and explicitly selects the date/time in Asia/Kuala_Lumpur. Dates in natural-language
requests are not parsed yet. This flow is one-time only; recurring work remains in
Routines. Telegram and unrecognized phrasing receive agent guidance to use the app;
the agent must not claim an internal cron job will send app push.

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
