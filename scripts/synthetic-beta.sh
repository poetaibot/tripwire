#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-}"
WEBHOOK_URL="${WEBHOOK_URL:-https://webhook.site/b4ce7921-8dd7-4d48-ba73-138f5c65e3b7}"
ROUNDS="${ROUNDS:-6}"
SLEEP_SECS="${SLEEP_SECS:-65}"

if [[ -z "$API_KEY" ]]; then
  echo "Missing API_KEY env var"
  exit 1
fi

mkdir -p /home/claw/.openclaw/workspace/tripwire/logs
LOG="/home/claw/.openclaw/workspace/tripwire/logs/synthetic-beta-$(date +%F-%H%M%S).log"

echo "[start] $(date -Is) rounds=$ROUNDS sleep=$SLEEP_SECS" | tee -a "$LOG"

create_watch () {
  local payload="$1"
  curl -sS -X POST "$BASE_URL/v1/watches" \
    -H 'content-type: application/json' \
    -H "x-api-key: $API_KEY" \
    -d "$payload"
}

# create three baseline watches
W1=$(create_watch "{\"type\":\"http_status\",\"targetUrl\":\"https://example.com\",\"webhookUrl\":\"$WEBHOOK_URL\",\"maxLatencyMs\":5000}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("watch",{}).get("id",""))')
W2=$(create_watch "{\"type\":\"http_status\",\"targetUrl\":\"https://httpstat.us/503\",\"webhookUrl\":\"https://httpbin.org/status/500\",\"maxLatencyMs\":3000}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("watch",{}).get("id",""))')
W3=$(create_watch "{\"type\":\"json_threshold\",\"targetUrl\":\"https://worldtimeapi.org/api/timezone/Etc/UTC\",\"webhookUrl\":\"$WEBHOOK_URL\",\"field\":\"unixtime\",\"operator\":\"gt\",\"threshold\":0}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("watch",{}).get("id",""))')

echo "[watches] stable=$W1 fail=$W2 threshold=$W3" | tee -a "$LOG"

for i in $(seq 1 "$ROUNDS"); do
  echo "[round $i] $(date -Is)" | tee -a "$LOG"
  for W in "$W1" "$W2" "$W3"; do
    curl -sS "$BASE_URL/v1/watches/$W/events" -H "x-api-key: $API_KEY" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print(len(d.get("events",[])))' \
      | awk -v w="$W" '{print "events " w " " $1}' | tee -a "$LOG"
  done
  sleep "$SLEEP_SECS"
done

# cleanup: pause all created watches
for W in "$W1" "$W2" "$W3"; do
  curl -sS -X PATCH "$BASE_URL/v1/watches/$W" -H 'content-type: application/json' -H "x-api-key: $API_KEY" -d '{"active":false}' >/dev/null
  echo "paused $W" | tee -a "$LOG"
done

echo "[done] $(date -Is) log=$LOG" | tee -a "$LOG"
