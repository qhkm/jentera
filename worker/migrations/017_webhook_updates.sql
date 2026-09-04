/* ============================================================
   Remember which webhook options a connection last registered.

   Telegram records `allowed_updates` at registration time. A
   webhook registered before callback_query support shipped still
   delivers only `message` updates — approval taps never arrive —
   while the webhook itself looks healthy and the URL is right.

   This marker stores the update set we last registered
   (`message|callback_query`). NULL means the connection predates
   this column, so its webhook may be stale.

   The receive path heals on the next authenticated update:
   re-registering there is safe because the update's secret token
   just proved the connection is real, and needs no signed-in
   owner — the webhook secret and bot credential are already
   authenticated server-side.
   ============================================================ */

alter table connection add column if not exists webhook_updates text;
