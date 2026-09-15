#!/usr/bin/env bash
# browser-latency.sh — where the time goes in business-browser take control.
#
#   browser-latency.sh net [sprite-host]   network legs: this device to the API
#                                          edge, and this device to a sprite
#   browser-latency.sh db [n]              the two Neon round trips every input
#                                          event pays, timed n times (default 20)
#   browser-latency.sh sprite [sprite]     the runner's own HTTP floor, network
#                                          removed: local status calls inside the
#                                          sprite. Not Chrome — see its section.
#   browser-latency.sh frames [run-id]     observed frame cadence on a live
#                                          preview stream (needs a session)
#
# Why this exists: raising the screencast frame rate is one constant
# (`interval` in runner/src/browser-preview-stream.mjs), but frame rate is only
# one term of what a person feels when they drive the browser. Measure before
# tuning anything — the first two guesses made here were both wrong.
#
# MEASURED 2026-09-15 from the owner's browser, signed in, against production,
# ten samples each, median:
#
#   GET /api/me             97 ms   edge + resolveTenant (session verify)
#   GET /api/notifications 100 ms   the above + a real tenant transaction
#   GET /api/browser       297 ms   the above + credentials + the sprite hop
#
# So the tenant transaction costs about 3 ms on the margin in a placed route,
# not the ~60 ms CLAUDE.md records for one in the queue consumer — and caching
# the runner credentials, which this header used to recommend, would save
# roughly nothing. The ~195 ms that /api/browser adds over /api/notifications is
# essentially all worker-to-sprite round trip.
#
# That is the lever for take control: a per-event HTTPS request to the sprite,
# paid on every click and keystroke. A persistent connection would remove it —
# see docs/plans/2026-09-10-business-runtime-durable-object.md. Frame rate and
# database work are both noise beside it.
#
# net and frames need nothing but curl. db needs psql and AISAR_NEON_OWNER_URL
# (or a logged-in neonctl). sprite needs the sprite CLI. frames needs a real
# owner session — see its section below.
#
# Caveat that applies to every number here: these are measured from a developer
# machine, not from the Cloudflare colo that actually runs the worker.
#
# For db that makes them a FLOOR, not a ceiling, which is the opposite of what
# you might expect. Measured 2026-09-15 from Malaysia: 15.4 ms for the session
# query and 15.0 ms for the tenant transaction, against the ~60 ms CLAUDE.md
# records for a tenant transaction in a placed route. psql reports execution
# only — no Hyperdrive, no pool acquisition, no Worker overhead — and \timing
# excludes connection setup. So the gap between 15 ms here and 60 ms there is
# the part of the cost this script cannot see, and production is the number to
# plan against. docs/reply-latency.md makes the same point for replies.
set -euo pipefail

CMD="${1:-help}"
ARG="${2:-}"
DEFAULT_SPRITE="aisar-b-c679d9df0aaa77ba1ec7"
DEFAULT_SPRITE_HOST="aisar-b-c679d9df0aaa77ba1ec7-bzzpg.sprites.app"
API="${AISAR_API_ORIGIN:-https://api.jentera.ai}"
PROJECT_ID="${AISAR_NEON_PROJECT_ID:-red-haze-10375483}"
CURL=/usr/bin/curl   # rtk rewrites curl output into a schema; this needs bytes

neon_url() {
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then printf '%s' "$AISAR_NEON_OWNER_URL"; return; fi
  neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner
}

# Median of stdin, one number per line. Deliberately not the mean: one cold DNS
# lookup or one Neon cold start would otherwise dominate a short run.
median() { sort -n | awk '{v[NR]=$1} END {if (NR==0) {print "n/a"; exit} print (NR%2) ? v[(NR+1)/2] : (v[NR/2]+v[NR/2+1])/2}'; }

case "$CMD" in
  net)
    HOST="${ARG:-$DEFAULT_SPRITE_HOST}"
    echo "== this device -> API edge ($API), 5 samples"
    for _ in 1 2 3 4 5; do
      $CURL -s -o /dev/null -m 15 -w '%{time_starttransfer}\n' "$API/api/me" || echo 99
    done | tee /dev/stderr | median | awk '{printf "   median round trip: %.0f ms\n", $1*1000}'

    echo "== this device -> sprite ($HOST), 5 samples"
    echo "   a 302 is expected and fine: the sprites proxy rejects us before the runner."
    for _ in 1 2 3 4 5; do
      $CURL -s -o /dev/null -m 15 -w '%{time_starttransfer}\n' "https://$HOST/v1/browser" || echo 99
    done | tee /dev/stderr | median | awk '{printf "   median round trip: %.0f ms\n", $1*1000}'
    echo
    echo "The worker->sprite leg is not this number: the worker runs in a Cloudflare"
    echo "colo, not here. This is the closest proxy available without a session."
    ;;

  db)
    N="${ARG:-20}"
    CS="$(neon_url)" || exit 1

    echo "== per-event query 1 of 2: session verification (resolveTenant -> verifySession)"
    echo "   no transaction; one round trip"
    for _ in $(seq 1 "$N"); do
      psql "$CS" -X -q -A -t -c "\timing on" -c "
        select s.user_id from session s
          join app_user u on u.id = s.user_id
         where s.revoked_at is null and s.expires_at > now()
         limit 1" 2>/dev/null | sed -n 's/^Time: \([0-9.]*\) ms$/\1/p'
    done | median | awk '{printf "   median: %.1f ms\n", $1}'

    echo "== per-event query 2 of 2: the tenant transaction for runner credentials"
    echo "   BEGIN, set app.business_id, select from agent_runtime, COMMIT"
    BIZ="$(psql "$CS" -X -q -A -t -c "select business_id from agent_runtime where provider_url is not null limit 1")"
    if [[ -z "$BIZ" ]]; then echo "   no provisioned runtime found; skipping"; exit 0; fi
    for _ in $(seq 1 "$N"); do
      psql "$CS" -X -q -A -t -c "\timing on" -c "
        begin;
        set local app.business_id = '$BIZ';
        select business_id, status, provider_url, runner_key_version
          from agent_runtime where business_id = '$BIZ';
        commit;" 2>/dev/null | sed -n 's/^Time: \([0-9.]*\) ms$/\1/p' |
        awk '{s += $1} END {if (NR) print s}'   # the whole transaction, not one statement
    done | median | awk '{printf "   median: %.1f ms\n", $1}'
    echo
    echo "Both run on every click and keystroke in take control. Measured in-browser"
    echo "against production, though, the tenant transaction costs only ~3 ms on the"
    echo "margin (97 ms for /api/me vs 100 ms for /api/notifications), so caching the"
    echo "credentials is not the win it looks like here. The sprite hop is: see the"
    echo "header."
    ;;

  sprite)
    SPRITE="${ARG:-$DEFAULT_SPRITE}"
    echo "== runner HTTP floor, network removed: 10 local status calls inside $SPRITE"
    # The key is read from the live runner process and used only as a header.
    # It is never printed: this output is pasted into issues and commits.
    sprite exec -o aisar -s "$SPRITE" -- bash -c '
      set -euo pipefail
      pid=$(pgrep -f "node.*server.mjs" | head -1)
      if [[ -z "$pid" ]]; then echo "runner not running"; exit 1; fi
      key=$(tr "\0" "\n" < /proc/$pid/environ | sed -n "s/^AISAR_RUNNER_KEY=//p")
      if [[ -z "$key" ]]; then echo "no AISAR_RUNNER_KEY in the runner environment"; exit 1; fi
      for _ in $(seq 1 10); do
        curl -s -o /dev/null -m 10 -w "%{time_starttransfer}\n" \
          -H "X-Aisar-Runner-Key: $key" http://127.0.0.1:8080/v1/browser || echo 99
      done
    ' < /dev/null | median | awk '{printf "   median: %.0f ms\n", $1*1000}'
    echo
    echo "This is the runner's own overhead and nothing more. status() returns"
    echo "in-memory state (business-browser.mjs:159) and never reaches CDP, so Chrome's"
    echo "apply-and-render cost is NOT in this number. Measuring that needs a real"
    echo "command against a held control lease, which means a live owner session and a"
    echo "production browser: use frames, and drive it yourself."
    ;;

  frames)
    RUN="${ARG:-}"
    if [[ -z "${AISAR_SESSION_COOKIE:-}" || -z "$RUN" ]]; then
      cat <<'USAGE'
frames needs a live owner session and a run whose browser is open.

  1. Sign in on jentera.ai as the owner and start a task that opens the browser.
  2. In devtools, Application -> Cookies -> copy the aisar_session value.
  3. export AISAR_SESSION_COOKIE=<that value>
  4. browser-latency.sh frames <run-id>

The stream is NDJSON, one frame object per line, and it runs for 45 seconds
before the runner closes it (duration in runner/src/browser-preview-stream.mjs).
USAGE
      exit 1
    fi
    CONTROL="$(uuidgen | tr 'A-Z' 'a-z')"
    echo "== observed frame cadence, 20 seconds"
    $CURL -sN -m 25 -X POST "$API/api/browser" \
      -H "Content-Type: application/json" \
      -H "Origin: https://jentera.ai" \
      -H "Cookie: aisar_session=$AISAR_SESSION_COOKIE" \
      -d "{\"action\":\"preview-stream\",\"controlId\":\"$CONTROL\",\"runId\":\"$RUN\"}" \
      | awk '
        BEGIN { prev = 0; n = 0 }
        {
          "date +%s%3N" | getline now; close("date +%s%3N")
          if (prev) { gap = now - prev; total += gap; if (gap > max) max = gap; n++ }
          prev = now
        }
        END {
          if (n == 0) { print "   no frames: the browser may not be open on this run"; exit }
          printf "   frames: %d  mean gap: %.0f ms  slowest gap: %d ms  effective: %.1f fps\n", n+1, total/n, max, 1000/(total/n)
        }'
    echo
    echo "Compare the mean gap against interval=100 in browser-preview-stream.mjs."
    echo "It will be larger: the delay is added after the frame read and the write,"
    echo "so the period is interval plus work, not interval."
    ;;

  *)
    sed -n '2,29p' "$0"
    ;;
esac
