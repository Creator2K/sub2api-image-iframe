#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_ENTRY="$PWD/dist/backend/server.js"
LOG_FILE="$PWD/app.log"

if pgrep -f "$APP_ENTRY" >/dev/null; then
  echo "sub2api-image-iframe is already running"
  pgrep -af "$APP_ENTRY"
  exit 0
fi

if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 10485760 ]; then
  mv "$LOG_FILE" "$PWD/app.log.1"
fi

setsid env \
  HOME="$PWD/.home" \
  XDG_DATA_HOME="$PWD/.local/share" \
  XDG_CACHE_HOME="$PWD/.cache" \
  COREPACK_HOME="$PWD/.corepack" \
  IMAGE_APP_ENV_FILE="$PWD/.env" \
  node "$APP_ENTRY" >> "$LOG_FILE" 2>&1 < /dev/null &

echo "sub2api-image-iframe started"
