-- A connection may reference a credential held by the isolated vault instead
-- of owning ciphertext in the application schema. The id is metadata only;
-- aisar_app has no privilege on vault.secret and cannot follow it.

alter table connection
  add column if not exists vault_secret_id uuid;

create index if not exists idx_connection_vault_secret
  on connection (business_id, vault_secret_id)
  where vault_secret_id is not null;
