#!/bin/sh
# Drop root after fixing the workspace volume, then start Bun or Node.
set -eu

if [ "$(id -u)" = "0" ]; then
  if [ -n "${BOTANICAL_WORKSPACE:-}" ] && [ -d "${BOTANICAL_WORKSPACE}" ]; then
    chown botanical:botanical "${BOTANICAL_WORKSPACE}" || true
  fi
  if command -v su-exec >/dev/null 2>&1 && id botanical >/dev/null 2>&1; then
    exec su-exec botanical "$0" "$@"
  fi
fi

mode="${1:-bun}"

if [ "$mode" = "node" ]; then
  echo "botanical: node runtime (deploy bootstrap)"
  cd /app
  exec node server.mjs
fi

if [ "${BOTANICAL_FORCE_BOOTSTRAP:-0}" != "1" ] && [ -f /app/RUNTIME_KIND ] && [ "$(cat /app/RUNTIME_KIND)" = "monorepo" ]; then
  cd /app/repo
  if bun -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts["db:migrate"]?0:1)'; then
    echo "botanical: running db:migrate"
    bun run db:migrate
  fi
  if bun -e 'const p=require("./packages/server/package.json"); process.exit(p.scripts&&p.scripts.start?0:1)'; then
    echo "botanical: starting packages/server"
    cd /app/repo/packages/server
    exec bun run start
  fi
  echo "botanical: packages/server has no start script; using the deploy bootstrap" >&2
fi

echo "botanical: bun runtime (deploy bootstrap) mode=${DEPLOYMENT_MODE:-unset}"
exec bun /app/deploy/server/src/index.ts
