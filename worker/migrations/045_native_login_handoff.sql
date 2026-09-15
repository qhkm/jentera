-- Preserve the app-generated state and PKCE challenge across an email
-- round-trip. They are not secrets, but keeping them in server state means a
-- modified magic-link URL cannot replace the app instance the code is bound
-- to. Both values are present together or not at all.
alter table login_token
  add column if not exists native_state text,
  add column if not exists native_code_challenge text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'login_token_native_handoff_pair'
  ) then
    alter table login_token add constraint login_token_native_handoff_pair
      check (
        (native_state is null and native_code_challenge is null) or
        (native_state is not null and native_code_challenge is not null and
         char_length(native_state) between 16 and 128 and
         char_length(native_code_challenge) between 43 and 128)
      );
  end if;
end $$;
