-- Aggregate launch monitoring only: no email addresses, chat text or credentials.
-- The caller pins the production owner session read-only with a statement timeout.
with customer_users as (
  select id, created_at, email_verified from app_user
  where lower(email::text) not in (
    'qhkmdev90@gmail.com', 'akukauhamba@gmail.com',
    'qaiyyumhakimi@gmail.com', 'qimicoffee@gmail.com'
  )
  and lower(email::text) not like '%@example.invalid'
  and regexp_replace(lower(coalesce(name, '')), '[[:space:]_-]+', '', 'g') <> 'aisarai'
), customer_businesses as (
  select b.* from business b
  where exists (select 1 from membership m join customer_users u on u.id=m.user_id
    where m.business_id=b.id and m.role='owner')
  and not exists (select 1 from membership m where m.business_id=b.id and m.role='owner'
    and not exists (select 1 from customer_users u where u.id=m.user_id))
  and regexp_replace(lower(b.name), '[[:space:]_-]+', '', 'g') <> 'aisarai'
), customer_runs as (
  select r.* from run r join customer_businesses b on b.id=r.business_id
), customer_usage as (
  select u.* from runtime_usage u join customer_businesses b on b.id=u.business_id
), day_boundary as (
  select date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur')
    at time zone 'Asia/Kuala_Lumpur' as starts_at
), today_runs as (
  select r.* from customer_runs r, day_boundary d where r.created_at>=d.starts_at
), today_usage as (
  select u.* from customer_usage u, day_boundary d where u.created_at>=d.starts_at
)
select jsonb_build_object(
  'observed_at', now(),
  'database', current_database(),
  'role', current_user,
  'read_only', current_setting('default_transaction_read_only'),
  'window', jsonb_build_object('timezone', 'Asia/Kuala_Lumpur',
    'starts_at', (select starts_at from day_boundary),
    'definition', 'calendar day, not cumulative since launch'),
  'accounts', jsonb_build_object(
    'all', (select count(*) from app_user),
    'customers', (select count(*) from customer_users),
    'verified_customers', (select count(*) from customer_users where email_verified),
    'new_today', (select count(*) from customer_users, day_boundary where created_at>=starts_at),
    'new_last_hour', (select count(*) from customer_users where created_at>=now()-interval '1 hour')
  ),
  'businesses', jsonb_build_object(
    'customers', (select count(*) from customer_businesses),
    'setup_done', (select count(*) from customer_businesses where setup_done),
    'active_today', (select count(distinct business_id) from today_runs)
  ),
  'runs_today', jsonb_build_object(
    'total', (select count(*) from today_runs),
    'completed', (select count(*) from today_runs where status='completed'),
    'failed', (select count(*) from today_runs where status='failed'),
    'cancelled', (select count(*) from today_runs where status='cancelled'),
    'working', (select count(*) from today_runs where status='working'),
    'queued', (select count(*) from today_runs where status='queued'),
    'needs_approval', (select count(*) from today_runs where status='needs_approval'),
    'failed_last_hour', (select count(*) from customer_runs
      where status='failed' and ended_at>=now()-interval '1 hour'),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
      from (select kind, count(*) n from today_runs group by kind) kinds)
  ),
  'trial', jsonb_build_object(
    'accounts_started', (select count(*) from chat_preview_account p
      join customer_users u on u.id=p.user_id where p.requests_used>0),
    'accounts_at_limit', (select count(*) from chat_preview_account p
      join customer_users u on u.id=p.user_id where p.requests_used=10),
    'requests_used', (select coalesce(sum(p.requests_used),0) from chat_preview_account p
      join customer_users u on u.id=p.user_id),
    'requests_created_today', (select count(*) from chat_preview_request p
      join customer_users u on u.id=p.user_id, day_boundary d
      where p.created_at>=d.starts_at and p.status='created'),
    'intake_failed_today', (select count(*) from chat_preview_request p
      join customer_users u on u.id=p.user_id, day_boundary d
      where p.created_at>=d.starts_at and p.status='failed')
  ),
  'payments', jsonb_build_object(
    'checkouts_today', (select count(*) from billing_checkout c
      join customer_businesses b on b.id=c.business_id, day_boundary d
      where c.created_at>=d.starts_at and c.stripe_session_id is not null),
    'verified_payments_today', (select count(*) from billing_payment p
      join customer_businesses b on b.id=p.business_id, day_boundary d
      where p.created_at>=d.starts_at),
    'verified_myr_today', (select coalesce(sum(p.amount_minor),0)/100.0 from billing_payment p
      join customer_businesses b on b.id=p.business_id, day_boundary d
      where p.created_at>=d.starts_at and p.currency='myr'),
    'active_paid_businesses', (select count(*) from customer_businesses
      where stripe_subscription_status='active' and stripe_paid_through>now()
      and not stripe_billing_review)
  ),
  'ai_usage_today', jsonb_build_object(
    'measured_rows', (select count(*) from today_usage where finalization_method='measured'),
    'measured_usd', (select coalesce(sum(cost_microusd),0)/1000000.0
      from today_usage where finalization_method='measured'),
    'estimated_rows', (select count(*) from today_usage where finalization_method='estimated'),
    'estimated_usd', (select coalesce(sum(cost_microusd),0)/1000000.0
      from today_usage where finalization_method='estimated'),
    'input_tokens', (select coalesce(sum(input_tokens),0)
      from today_usage where finalization_method='measured'),
    'output_tokens', (select coalesce(sum(output_tokens),0)
      from today_usage where finalization_method='measured'),
    'note', 'Application-recorded AI usage; not provider invoices or Sprite infrastructure spend'
  ),
  'created_to_run_started_seconds', (select jsonb_build_object(
    'samples', count(*),
    'median', round((percentile_cont(0.5) within group
      (order by extract(epoch from started_at-created_at)))::numeric,1),
    'p95', round((percentile_cont(0.95) within group
      (order by extract(epoch from started_at-created_at)))::numeric,1),
    'note', 'Run lifecycle timing only; not time to first model thinking or first token'
    ) from today_runs where started_at is not null and started_at>=created_at),
  'stale_due_tasks', (select count(*) from runtime_task t
    join customer_businesses b on b.id=t.business_id left join run r on r.id=t.run_id
    where t.status in ('queued','leased') and t.available_at<=now()
    and t.updated_at<now()-interval '15 minutes'
    and (t.status='queued' or t.lease_expires_at<now())
    and coalesce(r.status,'')<>'needs_approval'),
  'runtime_errors', (select count(*) from agent_runtime a
    join customer_businesses b on b.id=a.business_id
    where a.deleted_at is null and a.status='error')
);
