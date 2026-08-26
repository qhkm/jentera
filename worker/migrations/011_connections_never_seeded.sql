/* ============================================================
   Tell "no connections" apart from "not set up yet".

   `connections` defaulted to '[]' and was NOT NULL, so a business that
   had never been through onboarding and one whose owner had
   deliberately disconnected everything looked identical. The client
   seeds defaults when the list is empty, so the second case was read
   as the first: disconnect everything, reload, and it all comes back.

   Null now means never seeded. An empty array means a choice.

   `channels` on this same table already worked this way, with a
   comment in the client saying "Empty means 'never chosen', not 'chose
   nothing'". Connections needed the same distinction and did not have
   it.
   ============================================================ */

alter table business alter column connections drop default;
alter table business alter column connections drop not null;

/* Existing rows hold '[]' and are indistinguishable either way. There
   is one real business and it has never disconnected anything, so
   treating them as never-seeded restores the intended behaviour rather
   than freezing a wrong state. */
update business set connections = null where connections = '[]'::jsonb;
