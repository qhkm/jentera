#!/usr/bin/env bash
# reply-latency.sh — the numbers behind docs/reply-latency.md, reproducible.
#
#   reply-latency.sh db [days]        completed replies by channel and model:
#                                     queue wait, model time, total (p50/p90)
#   reply-latency.sh models [sprite]  per-call latency of each routed model
#                                     through the worker model proxy, measured
#                                     from a sprite with its own credentials
#   reply-latency.sh continuity [sprite]
#                                     two-turn probe against the sprite's Hermes:
#                                     proves (or disproves) session memory
#
# db needs psql and AISAR_NEON_OWNER_URL (or a logged-in neonctl). models and
# continuity need the sprite CLI; they spend a few cents of that business's
# model budget, so default to the Kitakod Ventures sprite.
set -uo pipefail

CMD="${1:-}"
ARG="${2:-}"
DEFAULT_SPRITE="aisar-b-c679d9df0aaa77ba1ec7"
PROJECT_ID="${AISAR_NEON_PROJECT_ID:-red-haze-10375483}"

neon_url() {
  if [[ -n "${AISAR_NEON_OWNER_URL:-}" ]]; then printf '%s' "$AISAR_NEON_OWNER_URL"; return; fi
  neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner
}

case "$CMD" in
  db)
    DAYS="${ARG:-7}"
    CS="$(neon_url)" || exit 1
    echo "== completed replies, last $DAYS days: intake to reply (run.started_at -> ended_at)"
    psql "$CS" -X -q -c "
      select coalesce(trigger_shape,'?') as channel, model, count(*) as runs,
        round(percentile_cont(0.5) within group (order by extract(epoch from ended_at-started_at))::numeric,0) as total_p50_s,
        round(percentile_cont(0.9) within group (order by extract(epoch from ended_at-started_at))::numeric,0) as total_p90_s,
        round(max(extract(epoch from ended_at-started_at))::numeric,0) as max_s
      from run
      where started_at > now() - interval '$DAYS days' and kind = 'ask' and status = 'completed'
      group by 1,2 order by runs desc"
    echo "== split: queue wait (work.requested -> work.started) vs model time (work.started -> work.completed)"
    psql "$CS" -X -q -c "
      with t as (
        select r.id, r.trigger_shape, r.model,
          min(e.created_at) filter (where e.type = 'work.requested') as req,
          min(e.created_at) filter (where e.type = 'work.started') as sta,
          max(e.created_at) filter (where e.type = 'work.completed') as done
        from run r join run_event e on e.run_id = r.id
        where r.started_at > now() - interval '$DAYS days' and r.kind = 'ask' and r.status = 'completed'
        group by 1,2,3)
      select trigger_shape as channel, model, count(*) as runs,
        round(percentile_cont(0.5) within group (order by extract(epoch from sta-req))::numeric,1) as wait_p50_s,
        round(percentile_cont(0.9) within group (order by extract(epoch from sta-req))::numeric,1) as wait_p90_s,
        round(percentile_cont(0.5) within group (order by extract(epoch from done-sta))::numeric,1) as model_p50_s,
        round(percentile_cont(0.9) within group (order by extract(epoch from done-sta))::numeric,1) as model_p90_s
      from t where sta is not null and done is not null
      group by 1,2 order by runs desc"
    ;;

  models)
    SPRITE="${ARG:-$DEFAULT_SPRITE}"
    echo "== per-call latency through the worker model proxy, from $SPRITE (2 calls each, 'reply OK')"
    sprite exec -o aisar -s "$SPRITE" -- bash -c '
      set -u
      key=$(awk -F= "/^OPENROUTER_API_KEY=/{print \$2}" /home/sprite/aisar/hermes.env)
      base=$(awk -F= "/^OPENROUTER_BASE_URL=/{print \$2}" /home/sprite/aisar/hermes.env)
      models=$(awk -F= "/^AISAR_(MODEL|DEEP_MODEL|CANDIDATE_MODEL)_NAMES?=/{print \$2}" /home/sprite/aisar/runtime.env | tr "," "\n" | awk "NF && !seen[\$0]++")
      probe() {
        for i in 1 2; do
          t=$(curl -s -m 120 -o /tmp/rl.$$ -w "%{http_code} %{time_total}" -X POST "$base/chat/completions" \
            -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
            -d "{\"model\":\"$1\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word OK.\"}],\"max_tokens\":40$2}")
          detail=$(python3 -c "
import json
d=json.load(open(\"/tmp/rl.$$\"))
if \"error\" in d: print(\"ERROR \"+json.dumps(d[\"error\"])[:90])
else:
  c=(d.get(\"choices\") or [{}])[0].get(\"message\",{}); u=d.get(\"usage\") or {}
  print(\"reasoning_chars=\"+str(len(c.get(\"reasoning_content\") or c.get(\"reasoning\") or \"\"))+\" completion_tokens=\"+str(u.get(\"completion_tokens\")))" 2>/dev/null)
          printf "%-26s %-16s http=%s secs=%s  %s\n" "$1" "${3:-as configured}" $t "$detail"
        done
      }
      for m in $models; do
        probe "$m" "" ""
        probe "$m" ",\"reasoning\":{\"effort\":\"low\"}" "reasoning low"
      done
      rm -f /tmp/rl.$$
    ' < /dev/null
    ;;

  continuity)
    SPRITE="${ARG:-$DEFAULT_SPRITE}"
    echo "== two turns on one fresh session id against Hermes on $SPRITE"
    sprite exec -o aisar -s "$SPRITE" -- bash -c '
      set -u
      key=$(awk -F= "/^API_SERVER_KEY=/{print \$2}" /home/sprite/aisar/hermes.env)
      origin=$(awk -F= "/^HERMES_ORIGIN=/{print \$2}" /home/sprite/aisar/runtime.env)
      sid="probe:continuity:$(date +%s)"
      run() {
        id=$(curl -s -m 20 -X POST "$origin/v1/runs" -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
          -d "{\"input\":$1,\"session_id\":\"$sid\",\"instructions\":\"Answer in at most five words. Do not use tools.\"}" \
          | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get(\"run_id\") or d.get(\"id\"))")
        for i in $(seq 1 40); do
          st=$(curl -s -m 10 "$origin/v1/runs/$id" -H "Authorization: Bearer $key")
          case "$(printf "%s" "$st" | python3 -c "import json,sys; print(json.load(sys.stdin).get(\"status\",\"?\"))" 2>/dev/null)" in
            completed|failed|cancelled) break ;;
          esac
          sleep 2
        done
        printf "%s" "$st" | python3 -c "import json,sys; d=json.load(sys.stdin); print(\"  status=\"+str(d.get(\"status\"))+\" output=\"+repr((d.get(\"output\") or \"\")[:80]))"
      }
      echo "turn 1: remember teal";  run "\"Remember this: my favourite colour is teal. Reply with just OK.\""
      echo "turn 2: recall (Teal = memory works)"; run "\"What is my favourite colour? Answer with one word.\""
    ' < /dev/null
    ;;

  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
