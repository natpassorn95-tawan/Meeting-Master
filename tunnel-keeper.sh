#!/usr/bin/env bash
# Self-healing tunnel keeper for Meeting Master.
# Keeps a cloudflared quick-tunnel alive; whenever it dies or stops delivering,
# it restarts the tunnel, updates PUBLIC_BASE_URL, restarts the API server, and
# re-registers the LINE webhook — so the webhook + button links keep working.
#
# Run:  bash tunnel-keeper.sh   (leave it running; logs to /tmp/mm_keeper.log)
set -u
cd "$(dirname "$0")"
TOKEN=$(grep '^LINE_CHANNEL_ACCESS_TOKEN=' .env | cut -d= -f2-)
PORT=8899
log() { echo "$(date '+%F %T') $*" | tee -a /tmp/mm_keeper.log; }

start_server() {
  pkill -f "meeting-master/server/index.js" 2>/dev/null
  lsof -ti:$PORT 2>/dev/null | xargs kill 2>/dev/null
  sleep 1
  node server/index.js > /tmp/mm_api.log 2>&1 &
}

set_webhook() { # $1 = base url
  curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"endpoint\":\"$1/api/line/webhook\"}" \
    https://api.line.me/v2/bot/channel/webhook/endpoint >/dev/null
}

webhook_ok() { # $1 = base url ; true if LINE can reach it
  curl -s -m 15 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"endpoint\":\"$1/api/line/webhook\"}" \
    https://api.line.me/v2/bot/channel/webhook/test | grep -q '"success":true'
}

while true; do
  pkill -f cloudflared 2>/dev/null; sleep 2
  : > /tmp/mm_tunnel.log
  cloudflared tunnel --url http://localhost:$PORT --protocol http2 > /tmp/mm_tunnel.log 2>&1 &
  CF=$!

  URL=""
  for _ in $(seq 1 30); do
    # Exclude api.trycloudflare.com — that host only appears in the provisioning
    # POST (and its error line); the real quick-tunnel is a random subdomain.
    URL=$(grep -Eo "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/mm_tunnel.log | grep -v '://api\.' | head -1)
    if [ -n "$URL" ] && grep -q "Registered tunnel connection" /tmp/mm_tunnel.log; then break; fi
    sleep 1
  done
  if [ -z "$URL" ]; then log "no tunnel URL — retrying"; kill $CF 2>/dev/null; sleep 3; continue; fi

  # macOS sed in-place
  sed -i '' "s#PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$URL#" .env
  start_server
  sleep 4
  set_webhook "$URL"
  log "tunnel UP: $URL (server restarted, webhook re-registered)"

  # Health loop: if the tunnel stops delivering, heal.
  while kill -0 $CF 2>/dev/null; do
    sleep 60
    if ! webhook_ok "$URL"; then log "health check FAILED ($URL) — healing"; kill $CF 2>/dev/null; break; fi
  done
  log "tunnel down — restarting"
done
