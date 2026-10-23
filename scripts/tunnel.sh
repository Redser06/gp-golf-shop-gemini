#!/usr/bin/env bash
# Quick Cloudflare tunnel for The Augusta Collection on port 8942.
set -euo pipefail

PORT="${PORT:-8942}"
CACHE_DIR="$HOME/.cache/gp-golf-shop-gemini"
mkdir -p "$CACHE_DIR"
PIDFILE="$CACHE_DIR/tunnel.pid"
LOGFILE="$CACHE_DIR/tunnel.log"

if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && echo "Tunnel stopped."
  else
    echo "No tunnel running."
  fi
  rm -f "$PIDFILE"
  exit 0
fi

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  EXISTING_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGFILE" | head -1 || true)"
  if [ -n "$EXISTING_URL" ] && curl -s -o /dev/null -m 4 "$EXISTING_URL/api/health"; then
    echo "Tunnel already running (pid $(cat "$PIDFILE"))"
    echo "$EXISTING_URL"
    exit 0
  else
    echo "Tunnel process running (pid $(cat "$PIDFILE")) but URL unreachable — restarting..."
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    sleep 1
  fi
fi

if ! curl -s -o /dev/null -m 4 "http://127.0.0.1:${PORT}/api/health"; then
  echo "ERROR: Nothing listening on 127.0.0.1:${PORT}. Start server first: node server.js" >&2
  exit 1
fi

: > "$LOGFILE"
cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

URL=""
for _ in $(seq 1 40); do
  sleep 1
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGFILE" | head -1 || true)"
  if [ -n "$URL" ]; then break; fi
done

if [ -z "$URL" ]; then
  echo "ERROR: Cloudflare tunnel timed out after 40s. Log:" >&2
  tail -20 "$LOGFILE" >&2
  exit 1
fi

echo "$URL"
echo "Tunnel active (pid $(cat "$PIDFILE")) — Stop with: bash scripts/tunnel.sh --stop"
