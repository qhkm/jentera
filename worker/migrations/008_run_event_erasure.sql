/* ============================================================
   Append-only was too strong: it also blocked erasure.

   007 refused UPDATE and DELETE on run_event so the trace could not be
   doctored after the fact. Refusing DELETE outright turned out to mean
   a business with any history could never be deleted at all — the
   cascade from `business` fires this same row-level trigger — so
   closing an account, or honouring an erasure request under the PDPA,
   was impossible.

   The two acts are not equally dangerous, and the difference is
   detectability:

   - Editing an event leaves NO trace. The row simply says something
     else than it did, and nothing anywhere disagrees. That has to stay
     impossible.
   - Deleting an event leaves a GAP. seq is contiguous per run, so a
     missing 4 between 3 and 5 is visible to anyone who looks. Removing
     one inconvenient event is therefore self-reporting, and deleting
     a whole run or business is a legitimate operation that should not
     require disabling a trigger in production.

   So: UPDATE stays refused forever, DELETE is allowed.
   ============================================================ */

create or replace function run_event_immutable() returns trigger as $$
begin
  raise exception 'run_event is append-only (attempted % on run_event)', tg_op;
end;
$$ language plpgsql;

drop trigger if exists run_event_no_update on run_event;

create trigger run_event_no_update
  before update on run_event
  for each row execute function run_event_immutable();
