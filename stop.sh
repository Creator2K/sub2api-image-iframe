#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_ENTRY="$PWD/dist/backend/server.js"

if ! pgrep -f "$APP_ENTRY" >/dev/null; then
  echo "sub2api-image-iframe is not running"
  exit 0
fi

pkill -f "$APP_ENTRY"
echo "sub2api-image-iframe stopped"
