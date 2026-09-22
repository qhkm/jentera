#!/usr/bin/env bash
# dev-db.sh — the local Postgres the Worker talks to during development.
#
# Hyperdrive has no local target of its own: `wrangler dev` comes up happily
# with nothing behind the binding, and the first query is where you find out.
# This builds that target — a real database on this machine, every migration
# applied in order, and the `aisar_app` role with production's privileges —
# then prints the two commands that use it.
#
# It is NOT the test database. `pnpm test` starts its own throwaway container
# per run and tears it down; this one persists, because a development database
# you have signed into is worth keeping between restarts.
#
# The role matters more than the schema. `aisar_app` is created nosuperuser
# and nobypassrls here for the same reason it is in production: RLS is
# invisible to a superuser, so a local Worker connecting as the owner would
# behave correctly while production leaked. Connect as `aisar_app` or the
# local environment is not reproducing the one that has the bugs.
#
# Usage:
#   worker/scripts/dev-db.sh            # create it, or bring an existing one up to date
#   worker/scripts/dev-db.sh --reset    # drop it first; every row goes
#   worker/scripts/dev-db.sh --url      # print the connection string and exit
#
# The password below is a fixed local-only string. It is not a secret and must
# never appear in a Hyperdrive config: production's lives only there.

set -euo pipefail

DB=aisar_dev
APP_PASSWORD=local_dev_only_password
HOST=127.0.0.1
PORT=5432
RESET=0
URL_ONLY=0

usage() { sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "dev-db: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --url) URL_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "dev-db: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done

URL="postgres://aisar_app:${APP_PASSWORD}@${HOST}:${PORT}/${DB}"
if [[ $URL_ONLY == 1 ]]; then echo "$URL"; exit 0; fi

# Homebrew keeps versioned Postgres off PATH. Prefer whatever is already
# there, so a machine with its own install is not overridden.
if ! command -v psql >/dev/null 2>&1; then
  for prefix in /opt/homebrew/opt/postgresql@16 /opt/homebrew/opt/postgresql@15 /usr/local/opt/postgresql@16; do
    [[ -x "$prefix/bin/psql" ]] && { PATH="$prefix/bin:$PATH"; break; }
  done
fi
command -v psql >/dev/null 2>&1 || die "psql is not installed (brew install postgresql@16)"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$ROOT/worker/migrations"
[[ -d "$MIGRATIONS" ]] || die "no migrations at $MIGRATIONS"

step "server"
if ! pg_isready -q -h "$HOST" -p "$PORT" 2>/dev/null; then
  command -v brew >/dev/null 2>&1 || die "no Postgres on ${HOST}:${PORT} and no brew to start one"
  brew services start postgresql@16 >/dev/null || die "could not start postgresql@16"
  for _ in $(seq 1 30); do
    pg_isready -q -h "$HOST" -p "$PORT" 2>/dev/null && break
    perl -e 'select(undef,undef,undef,1)'
  done
fi
pg_isready -q -h "$HOST" -p "$PORT" || die "Postgres is not accepting connections on ${HOST}:${PORT}"
echo "accepting connections on ${HOST}:${PORT}"

step "owner role"
psql -q -h "$HOST" -p "$PORT" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'owner') then
    create role owner login superuser password 'owner';
  end if;
end $$;
SQL
echo "owner present"

step "database $DB"
if [[ $RESET == 1 ]]; then
  dropdb --if-exists -h "$HOST" -p "$PORT" "$DB"
  echo "dropped $DB"
fi
if ! psql -h "$HOST" -p "$PORT" -d postgres -At -c "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  createdb -h "$HOST" -p "$PORT" -O owner "$DB"
  echo "created $DB"
else
  echo "$DB already exists (--reset to start over)"
fi
# citext carries app_user.email and is not installed by default.
psql -q -U owner -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -c "create extension if not exists citext"

step "migrations"
# In order, and all of them: they are not individually idempotent, so a
# database that already has them is left alone rather than re-applied.
applied=$(psql -U owner -h "$HOST" -p "$PORT" -d "$DB" -At \
  -c "select count(*) from information_schema.tables where table_schema='public'")
if [[ "$applied" -gt 1 ]]; then
  echo "schema already present ($applied tables); --reset to rebuild it"
else
  count=0
  for file in "$MIGRATIONS"/*.sql; do
    psql -q -U owner -h "$HOST" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 \
      -v app_password="$APP_PASSWORD" -f "$file" >/dev/null \
      || die "migration failed: $(basename "$file")"
    count=$((count + 1))
  done
  echo "applied $count migrations"
fi

step "the role the Worker connects as"
# Proof, not assumption: a superuser here would pass every RLS test locally
# and tell you nothing about production.
privileges=$(psql -U owner -h "$HOST" -p "$PORT" -d "$DB" -At \
  -c "select rolsuper::text || ' ' || rolbypassrls::text from pg_roles where rolname='aisar_app'")
[[ "$privileges" == "false false" ]] || die "aisar_app has superuser or bypassrls ($privileges); RLS would not be enforced"
PGPASSWORD="$APP_PASSWORD" psql -U aisar_app -h "$HOST" -p "$PORT" -d "$DB" -At -c "select 1" >/dev/null \
  || die "aisar_app cannot sign in"
echo "aisar_app signs in, is not a superuser, does not bypass RLS"

cat <<EOF

Ready. Two terminals:

  cd worker
  WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='$URL' pnpm dev

  cd app
  VITE_API_URL=http://localhost:8787 pnpm dev

The Hyperdrive variable is a process variable, not a .dev.vars entry: without
it on the command line the Worker starts with nothing behind the binding.

No RESEND_API_KEY here, so a magic link is logged rather than delivered — the
password door is the one that works end to end locally. No TURNSTILE_SECRET,
so that check is skipped rather than refusing every door.
EOF
