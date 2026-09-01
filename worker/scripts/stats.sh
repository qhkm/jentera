#!/usr/bin/env bash
# Read-only production stats for the Jentera Neon database.
#
# Connects as neondb_owner deliberately: RLS scopes every tenant table to
# app.business_id, so an aisar_app connection sees nothing outside a
# transaction that withTenant has set up. Owner bypasses RLS, which is what a
# cross-tenant count needs — and why the session is pinned read-only below.
#
#   ./worker/scripts/stats.sh              # summary
#   ./worker/scripts/stats.sh users
#   ./worker/scripts/stats.sh runs 20
#   ./worker/scripts/stats.sh sql "select count(*) from work_record"
#
# Auth comes from neonctl (already logged in), or set AISAR_NEON_OWNER_URL to
# skip the lookup.
set -euo pipefail

PROJECT_ID="${AISAR_NEON_PROJECT_ID:-red-haze-10375483}"

# default_transaction_read_only makes every statement in this session refuse to
# write. The guard is the server's, not a regex over the query text.
export PGOPTIONS='-c default_transaction_read_only=on'

conn() {
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then
    printf '%s' "$AISAR_NEON_OWNER_URL"
    return
  fi
  neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner
}

CS="$(conn)"
q() { psql "$CS" -X -q -v ON_ERROR_STOP=1 "$@"; }

cmd="${1:-summary}"
shift || true

case "$cmd" in
summary)
  q -c "
    select
      (select count(*) from app_user)                                        as users,
      (select count(*) from app_user where email_verified)                   as verified,
      (select count(*) from app_user
         where created_at > now() - interval '24 hours')                     as new_24h,
      (select count(*) from app_user
         where created_at > now() - interval '7 days')                       as new_7d,
      (select count(*) from business)                                        as businesses,
      (select count(*) from business where setup_done)                       as setup_done,
      (select count(distinct business_id) from run)                          as biz_with_runs,
      (select count(*) from run)                                             as runs,
      (select count(*) from connection where status = 'connected')           as connections;
  "
  ;;

users)
  q -c "
    select
      u.email,
      u.created_at                                                as joined,
      u.last_seen_at                                              as last_seen,
      b.name                                                      as business,
      b.playbook_key                                              as playbook,
      b.plan,
      b.setup_done,
      (select count(*) from run r  where r.business_id = b.id)     as runs,
      (select count(*) from connection c
         where c.business_id = b.id and c.status = 'connected')    as conns
    from app_user u
    left join membership m on m.user_id = u.id
    left join business b   on b.id = m.business_id
    order by u.created_at;
  "
  ;;

runs)
  limit="${1:-20}"
  q -c "
    select
      r.created_at, b.name as business, r.kind, r.status,
      r.trigger_shape as trigger, r.runtime, r.model,
      round(extract(epoch from (r.ended_at - r.started_at))::numeric, 1) as secs
    from run r
    join business b on b.id = r.business_id
    order by r.created_at desc
    limit $limit;
  "
  ;;

runtimes)
  q -c "
    select
      b.name as business, a.provider, a.provider_name, a.status,
      a.desired_release, a.observed_release, a.last_ready_at,
      left(coalesce(a.last_error, ''), 60) as last_error
    from agent_runtime a
    join business b on b.id = a.business_id
    where a.deleted_at is null
    order by a.created_at;
  "
  ;;

usage)
  q -c "
    select
      b.name as business,
      count(*)                                        as calls,
      sum(u.input_tokens)                             as in_tok,
      sum(u.output_tokens)                            as out_tok,
      round(sum(u.cost_microusd) / 1e6, 4)            as usd
    from runtime_usage u
    join business b on b.id = u.business_id
    group by b.name
    order by usd desc nulls last;
  "
  ;;

sql)
  [[ $# -ge 1 ]] || { echo "usage: stats.sh sql \"<query>\"" >&2; exit 2; }
  q -c "$1"
  ;;

*)
  /usr/bin/sed -n '2,16p' "$0"
  exit 2
  ;;
esac
