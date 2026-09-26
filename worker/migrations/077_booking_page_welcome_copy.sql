alter table booking_settings
  add column if not exists welcome_title text,
  add column if not exists welcome_message text;
