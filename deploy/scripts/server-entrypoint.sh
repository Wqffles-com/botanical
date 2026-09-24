#!/bin/sh
# Own the workspace volume, apply Postgres migrations, then start the API as
# the unprivileged botanical user. Signals go to the server (exec).
set -eu

normalize_mode() {
  raw="${BOTANICAL_DEPLOYMENT_MODE:-${DEPLOYMENT_MODE:-SELF_HOST}}"
  mode=$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  case "$mode" in
    SELF_HOST | SELFHOST) mode="SELF_HOST" ;;
    SAAS) mode="SAAS" ;;
    *)
      echo "botanical: DEPLOYMENT_MODE must be SELF_HOST or SAAS (got ${raw})" >&2
      exit 1
      ;;
  esac
  export BOTANICAL_DEPLOYMENT_MODE="$mode"
  export DEPLOYMENT_MODE="$mode"
}

normalize_mode

if [ -z "${BOTANICAL_PASSWORD:-}" ] && [ -z "${BOTANICAL_PASSWORD_HASH:-}" ]; then
  if [ -z "${BOTANICAL_PASSCODE:-}" ]; then
    echo "botanical: set BOTANICAL_PASSCODE or BOTANICAL_PASSWORD" >&2
    exit 1
  fi
  export BOTANICAL_PASSWORD="$BOTANICAL_PASSCODE"
fi

if [ "$(id -u)" = "0" ]; then
  workspace="${BOTANICAL_WORKSPACE:-/data}"
  mkdir -p "$workspace"
  chown botanical:botanical "$workspace" || true
  if ! command -v su-exec >/dev/null 2>&1; then
    echo "botanical: su-exec is missing from the image" >&2
    exit 1
  fi
  exec su-exec botanical "$0"
fi

if [ -n "${BOTANICAL_MCP_CONFIG:-}" ] && [ ! -f "${BOTANICAL_MCP_CONFIG}" ]; then
  echo "botanical: BOTANICAL_MCP_CONFIG=${BOTANICAL_MCP_CONFIG} is not a file" >&2
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ]; then
  echo "botanical: applying database migrations"
  cd /app
  attempt=0
  until bun run db:migrate; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      echo "botanical: migrations failed" >&2
      exit 1
    fi
    echo "botanical: migration attempt ${attempt} failed; retrying"
    sleep 1
  done
fi

cd /app/packages/server
exec bun src/serve.ts
