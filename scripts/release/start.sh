#!/usr/bin/env bash
# Start Botanical from an unzipped release: the Bun API, then the Next.js web.
# Needs Bun >= 1.2, Node >= 20, and a reachable Postgres (see docker-compose.yml).
#
#   cp .env.example .env   # edit BOTANICAL_ENCRYPTION_KEY and DATABASE_URL
#   ./start.sh             # API on :8787 (loopback), web on :3000
#   ./start.sh server      # API only
#   ./start.sh web         # web only
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# The API reads BOTANICAL_PASSWORD. Accept the Compose-style BOTANICAL_PASSCODE too.
if [ -z "${BOTANICAL_PASSWORD:-}" ] && [ -z "${BOTANICAL_PASSWORD_HASH:-}" ] && [ -n "${BOTANICAL_PASSCODE:-}" ]; then
  export BOTANICAL_PASSWORD="$BOTANICAL_PASSCODE"
fi

export BOTANICAL_HOST="${BOTANICAL_HOST:-127.0.0.1}"
export BOTANICAL_PORT="${BOTANICAL_PORT:-8787}"
export BOTANICAL_WORKSPACE="${BOTANICAL_WORKSPACE:-$here/data}"
export BOTANICAL_MCP_CONFIG="${BOTANICAL_MCP_CONFIG:-$here/config/mcp.json}"
mkdir -p "$BOTANICAL_WORKSPACE"

run_server() {
  command -v bun >/dev/null 2>&1 || { echo "start: bun is required (https://bun.sh)" >&2; exit 1; }
  cd "$here/server/packages/server"
  exec bun src/serve.ts
}

run_web() {
  command -v node >/dev/null 2>&1 || { echo "start: node >= 20 is required" >&2; exit 1; }
  cd "$here/web"
  PORT="${WEB_PORT:-3000}" HOSTNAME="${WEB_HOST:-0.0.0.0}" NODE_ENV=production \
    exec node packages/web/server.js
}

case "${1:-all}" in
  server) run_server ;;
  web) run_web ;;
  all)
    ( run_server ) &
    server_pid=$!
    ( run_web ) &
    web_pid=$!
    trap 'kill "$server_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
    # Exit when either process stops (portable to macOS bash 3.2, no wait -n).
    while kill -0 "$server_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
      sleep 1
    done
    ;;
  *)
    echo "usage: ./start.sh [all|server|web]" >&2
    exit 2
    ;;
esac
