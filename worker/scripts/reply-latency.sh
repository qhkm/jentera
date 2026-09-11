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
#   reply-latency.sh eval-questions [n]
#                                     write n real prompts to stdout as JSONL,
#                                     taken verbatim from runtime_task.payload
#                                     so the replay asks what production asked
#   reply-latency.sh eval <file.jsonl> [sprite]
#                                     replay each prompt against every model in
#                                     AISAR_EVAL_MODELS, session-less, and emit
#                                     one JSONL result per prompt per model
#   reply-latency.sh eval-sheet <results.jsonl>
#                                     a blind scoring sheet: pairs shuffled, the
#                                     model hidden behind A/B, key at the bottom
#
# db and eval-questions need psql and AISAR_NEON_OWNER_URL (or a logged-in
# neonctl). models, continuity and eval need the sprite CLI; they spend a few
# cents of that business's model budget, so default to the Kitakod Ventures
# sprite.
#
# eval calls Hermes directly, so those calls are metered by the proxy but are
# not runs: they bypass the run ledger and the $5 admission check. And a
# session-less replay is easier than production, where Telegram sessions carry
# history. Both caveats belong beside any verdict drawn from it.
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
      models=$(awk -F= "/^AISAR_(MODEL|DEEP_MODEL|CANDIDATE_MODEL)_NAMES?=/{print \$2}" /home/sprite/aisar/runtime.env \
        | tr "," "\n" \
        | tr -d "\047\042" \
        | awk "NF && !seen[\$0]++")
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

  eval-questions)
    # Real prompts, not reconstructed ones. runtime_task.payload keeps the
    # exact instructions and input the worker built for app-chat runs, so
    # taking them verbatim is more faithful than re-rendering
    # prepareHermesAgent here — and cannot drift from it. Telegram payloads
    # are scrubbed at completion, so those questions are not available this
    # way; add them by hand with instructions copied from any row here.
    LIMIT="${ARG:-40}"
    CS="$(neon_url)" || exit 1
    psql "$CS" -X -q -A -t -c "
      select json_build_object(
               'id', left(md5(payload->>'input'), 8),
               'question', regexp_replace(payload->>'input', '^.*User request: ', '', 's'),
               'instructions', payload->>'instructions',
               'input', payload->>'input')::text
        from (
          select distinct on (payload->>'input') payload, created_at
            from runtime_task
           where payload ? 'input' and payload ? 'instructions'
           order by payload->>'input', created_at desc
        ) t
       order by created_at desc
       limit $LIMIT"
    ;;

  eval)
    FILE="$ARG"
    SPRITE="${3:-$DEFAULT_SPRITE}"
    MODELS="${AISAR_EVAL_MODELS:-MiniMax-M2.7-highspeed,deepseek-v4-flash}"
    if [[ -z "$FILE" || ! -r "$FILE" ]]; then
      echo "eval needs a readable questions JSONL (see eval-questions)" >&2
      exit 2
    fi
    B64="$(base64 < "$FILE" | tr -d '\n')"
    echo "== replaying $(wc -l < "$FILE" | tr -d ' ') prompts against [$MODELS] on $SPRITE" >&2
    # The questions ride in as base64 so no quoting of user text reaches the
    # remote shell. Results go to stdout as JSONL; progress to stderr.
    sprite exec -o aisar -s "$SPRITE" -- bash -c '
      set -u
      key=$(awk -F= "/^API_SERVER_KEY=/{print \$2}" /home/sprite/aisar/hermes.env)
      origin=$(awk -F= "/^HERMES_ORIGIN=/{print \$2}" /home/sprite/aisar/runtime.env)
      printf "%s" "'"$B64"'" | base64 -d > /tmp/eval.$$.jsonl
      MODELS="'"$MODELS"'" ORIGIN="$origin" KEY="$key" FILE="/tmp/eval.$$.jsonl" python3 -c "
import json, os, time, urllib.request

origin, key = os.environ[\"ORIGIN\"], os.environ[\"KEY\"]
models = [m.strip() for m in os.environ[\"MODELS\"].split(\",\") if m.strip()]

def call(path, payload=None):
    req = urllib.request.Request(
        origin + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={\"Authorization\": \"Bearer \" + key, \"Content-Type\": \"application/json\"},
        method=\"POST\" if payload is not None else \"GET\")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

for line in open(os.environ[\"FILE\"]):
    line = line.strip()
    if not line:
        continue
    q = json.loads(line)
    for model in models:
        started = time.time()
        row = {\"id\": q.get(\"id\"), \"question\": q.get(\"question\"), \"model\": model}
        try:
            # No session_id on purpose: neither model may inherit history.
            run = call(\"/v1/runs\", {\"input\": q[\"input\"], \"instructions\": q[\"instructions\"], \"model\": model})
            run_id = run.get(\"run_id\") or run.get(\"id\")
            state = {}
            for _ in range(150):
                state = call(\"/v1/runs/\" + str(run_id))
                if state.get(\"status\") in (\"completed\", \"failed\", \"cancelled\", \"expired\"):
                    break
                time.sleep(2)
            row.update(status=state.get(\"status\"), output=state.get(\"output\"),
                       usage=state.get(\"usage\"), seconds=round(time.time() - started, 1))
        except Exception as err:  # noqa: BLE001 — a probe must not stop at one bad run
            row.update(status=\"error\", error=str(err)[:200],
                       seconds=round(time.time() - started, 1))
        print(json.dumps(row), flush=True)
        print(\"  \" + str(row[\"id\"]) + \" \" + model + \" -> \" + str(row.get(\"status\")) +
              \" \" + str(row.get(\"seconds\")) + \"s\", file=__import__(\"sys\").stderr, flush=True)
"
      rm -f /tmp/eval.$$.jsonl
    ' < /dev/null
    ;;

  eval-sheet)
    FILE="$ARG"
    if [[ -z "$FILE" || ! -r "$FILE" ]]; then
      echo "eval-sheet needs a readable results JSONL (see eval)" >&2
      exit 2
    fi
    # Blind on purpose. The founder is the judge and knows which model is on
    # trial, so showing the label would decide the verdict before reading it.
    python3 - "$FILE" <<'PY'
import json, random, sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
by_question = defaultdict(list)
for row in rows:
    by_question[(row.get("id"), row.get("question"))].append(row)

random.seed(20260910)
key = []
print("# Blind scoring sheet\n")
print("Score each answer: grounded (invented anything? a single fabrication fails "
      "the answer), correct where checkable, adequate (answers the question, right "
      "language, phone-shaped), tool discipline (researched when it should have, "
      "not when the facts sufficed). Then pick A or B, or tie.\n")
for n, ((qid, question), answers) in enumerate(sorted(by_question.items()), 1):
    if len(answers) < 2:
        continue
    random.shuffle(answers)
    print(f"## {n}. {question}\n")
    for label, row in zip("AB", answers):
        status = row.get("status")
        output = (row.get("output") or row.get("error") or "").strip() or "(no answer)"
        # Status but not seconds: a 4s answer beside a 46s one names the model
        # to anyone who has read the per-call probes. Latency is measured on
        # its own axis, in the results JSONL and the live table.
        print(f"**{label}** — {status}\n")
        # Quote every line, or a multi-line answer escapes the blockquote and
        # the sheet stops being readable at exactly the long answers that
        # most need reading.
        for chunk in output.splitlines():
            print(f"> {chunk}" if chunk.strip() else ">")
        print()
        key.append((n, label, row.get("model")))
    print("Grounded: A / B / both / neither  ")
    print("Correct: A / B / both / neither  ")
    print("Adequate: A / B / both / neither  ")
    print("Tool discipline: A / B / both / neither  ")
    print("**Preferred: A / B / tie**\n")

print("\n---\n\n## Key (read after scoring)\n")
for n, label, model in key:
    print(f"{n}{label}: {model}")
PY
    ;;

  *)
    sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
