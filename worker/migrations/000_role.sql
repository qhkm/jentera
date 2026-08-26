/* ============================================================
   The application role.

   Numbered 000 because it precedes every table: the default
   privileges below are what grant `aisar_app` access to tables that do
   not exist yet, so this must run before 001.

   Until now this role existed only in production, created by hand at a
   psql prompt. Nothing in the repository described it, which meant no
   test could reproduce the environment where the interesting bugs live
   — RLS is invisible to a superuser, so a suite run as the owner would
   have passed while production was wide open.

   Read from the live database rather than from memory, on 2026-08-26.
   ============================================================ */

-- The password is supplied by the caller. Production's lives only in
-- the Hyperdrive config; the test harness generates a throwaway.
\set app_password :app_password

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aisar_app') then
    create role aisar_app login;
  end if;
end
$$;

alter role aisar_app with password :'app_password';

/* Everything this role must NOT have. RLS is bypassed silently for
   superusers and for BYPASSRLS holders, and a table's owner is exempt
   unless the table is FORCE'd — so an application connecting as the
   owner leaves every policy in place and enforcing nothing. That is
   the failure this role exists to prevent, and it is invisible from
   inside the application. */
alter role aisar_app nosuperuser nocreatedb nocreaterole nobypassrls;

grant usage on schema public to aisar_app;

/* Tables created later inherit these. Note that sequences are NOT
   covered: a `bigserial` column would need its own USAGE grant, which
   is why auth_attempt uses an identity column instead. */
alter default privileges in schema public
  grant select, insert, update, delete on tables to aisar_app;

-- Anything already created before this file ran.
grant select, insert, update, delete on all tables in schema public to aisar_app;
