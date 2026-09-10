-- Token caps become optional. Owners were told they have US$5 of credits a
-- month; the default 2,000,000-input-token cap was a second limit nobody
-- had been told about, and it stopped a heavy user at $2.28 on 2026-09-10.
-- Cost and runtime hours remain the caps. A row may still set a token cap
-- explicitly (the checks stay); null means none, and null is the default.
alter table runtime_budget
  alter column monthly_input_tokens drop not null,
  alter column monthly_input_tokens set default null,
  alter column monthly_output_tokens drop not null,
  alter column monthly_output_tokens set default null;

update runtime_budget
   set monthly_input_tokens = null,
       monthly_output_tokens = null,
       updated_at = now()
 where monthly_input_tokens is not null or monthly_output_tokens is not null;
