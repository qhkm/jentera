/* Give the four starter roles distinct faces. Migration 065 necessarily
   backfilled `original` for every pre-existing row when it introduced the
   avatar column, which made the production roster look duplicated. */
update specialist_profile
   set avatar = case profile_key
     when 'operations' then 'purple'
     when 'customers' then 'pink'
     when 'growth' then 'yellow'
     when 'records' then 'orange'
     else avatar
   end,
       updated_at = now()
 where profile_key in ('operations', 'customers', 'growth', 'records')
   and avatar = 'original';
