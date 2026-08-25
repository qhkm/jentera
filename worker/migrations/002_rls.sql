-- Slice 1, task 4: row-level security.
--
-- Defence in depth beneath the data-access layer. The application already
-- scopes every query through withTenant(); this makes the application
-- being WRONG insufficient to leak data.
--
-- Deliberately NOT applied to session, app_user, login_token or
-- membership: resolveTenant() reads those before a tenant is known, so a
-- policy keyed on app.business_id would return nothing and lock every
-- user out of their own sign-in.
--
-- Idempotent.

alter table business enable row level security;
drop policy if exists business_tenant on business;
create policy business_tenant on business
  using (id = nullif(current_setting('app.business_id', true), '')::uuid);

-- FORCE matters: without it, a table owner bypasses its own policy
-- silently. The app connects as aisar_app (non-owner) so this is belt
-- and braces, but a future migration run as the owner would otherwise
-- see every row and nothing would say so.
alter table business force row level security;
