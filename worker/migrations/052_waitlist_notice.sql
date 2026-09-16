-- One row per address per announcement. This is the record that stops a
-- second send: the route claims nothing up front, it writes a row only
-- after Resend has accepted the message, so a refused address stays
-- unmarked and the next run reaches it.
create table if not exists waitlist_notice (
  email text not null references waitlist_entry(email) on delete cascade,
  notice_key text not null check (notice_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  sent_at timestamptz not null default now(),
  primary key (email, notice_key)
);
-- Default table privileges grant CRUD to aisar_app; an explicit GRANT alone
-- would not remove those inherited defaults. Delivery evidence is append-only.
revoke all on waitlist_notice from public;
revoke update, delete, truncate, references, trigger on waitlist_notice from aisar_app;
grant select, insert on waitlist_notice to aisar_app;
