/* ============================================================
   Store the webhook secret instead of deriving it.

   009 derived it with an HMAC of the connection id under
   CREDENTIAL_KEY. That was neat and wrong: rotating CREDENTIAL_KEY —
   which the key_version column exists to make possible — would change
   every derived secret while Telegram carried on presenting the old
   one. Every webhook would start failing its check, and the symptom
   would be silence, since a rejected update still answers 200.

   A stored random secret has none of that coupling. It is also what
   makes the connection testable end to end: an operator can post a
   real update to the endpoint and see it handled, which a derived
   secret nobody can reproduce made impossible.
   ============================================================ */

alter table connection add column if not exists webhook_secret text;
