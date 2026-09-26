alter table booking_settings
  add column if not exists page_theme text not null default 'dark';

alter table booking_settings drop constraint if exists booking_settings_page_theme_check;
alter table booking_settings add constraint booking_settings_page_theme_check
  check (page_theme in ('dark', 'light'));

