#!/usr/bin/env bash
set -Eeuo pipefail

cd /app/uts-housing-api
if [[ -z "${FRONTEND_ORIGIN:-}" ]]; then export FRONTEND_ORIGIN="${RENDER_EXTERNAL_URL:-}"; fi
if [[ -z "${PUBLIC_BASE_URL:-}" ]]; then export PUBLIC_BASE_URL="$FRONTEND_ORIGIN"; fi
FRONTEND_ORIGIN="${FRONTEND_ORIGIN%/}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
if [[ -z "$FRONTEND_ORIGIN" || -z "$PUBLIC_BASE_URL" ]]; then
  echo 'Set FRONTEND_ORIGIN and PUBLIC_BASE_URL to the public HTTPS website address.' >&2
  exit 1
fi

# The migration command uses an advisory lock and verifies checksums. A failed
# migration prevents the web service from accepting requests.
node dist/prisma/migrate.js

PORT=3001 HOST=127.0.0.1 node dist/src/server.js &
api_pid=$!
PORT="${PORT:-10000}" SITE_DIR=/app/site node /app/deploy/render-gateway.mjs &
gateway_pid=$!

stop() {
  kill "$api_pid" "$gateway_pid" 2>/dev/null || true
  wait "$api_pid" "$gateway_pid" 2>/dev/null || true
}
trap stop EXIT TERM INT
set +e
wait -n "$api_pid" "$gateway_pid"
status=$?
set -e
exit "$status"
