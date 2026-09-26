alter table booking_settings
  add column if not exists brand_color text not null default '#4aebb5',
  add column if not exists logo_key text,
  add column if not exists logo_content_type text,
  add column if not exists logo_updated_at timestamptz;

alter table booking_settings drop constraint if exists booking_settings_brand_color_check;
alter table booking_settings add constraint booking_settings_brand_color_check
  check (brand_color ~ '^#[0-9a-fA-F]{6}$');

alter table booking_settings drop constraint if exists booking_settings_logo_content_type_check;
alter table booking_settings add constraint booking_settings_logo_content_type_check
  check (logo_content_type is null or logo_content_type in ('image/png', 'image/jpeg', 'image/webp'));

alter table booking_settings drop constraint if exists booking_settings_logo_complete_check;
alter table booking_settings add constraint booking_settings_logo_complete_check
  check ((logo_key is null and logo_content_type is null and logo_updated_at is null)
      or (logo_key is not null and logo_content_type is not null and logo_updated_at is not null));
