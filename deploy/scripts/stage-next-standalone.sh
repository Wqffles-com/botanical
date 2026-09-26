#!/bin/sh
# Copy the Next standalone server into /out, including static assets.
# Monorepo builds (outputFileTracingRoot = repo root) nest server.js under
# packages/web/. A package-local trace leaves it at the standalone root.
set -eu

cd /app

standalone="packages/web/.next/standalone"
static_dir="packages/web/.next/static"

if [ ! -d "$static_dir" ]; then
  echo "botanical: next build did not emit ${static_dir}" >&2
  exit 1
fi

rm -rf /out
mkdir -p /out

if [ -f "${standalone}/packages/web/server.js" ]; then
  cp -a "${standalone}/." /out/
  mkdir -p /out/packages/web/.next
  rm -rf /out/packages/web/.next/static
  cp -a "$static_dir" /out/packages/web/.next/static
  if [ -d packages/web/public ]; then
    rm -rf /out/packages/web/public
    cp -a packages/web/public /out/packages/web/public
  fi
  printf '%s\n' "packages/web/server.js" > /out/SERVER_JS
elif [ -f "${standalone}/server.js" ]; then
  cp -a "${standalone}/." /out/
  mkdir -p /out/.next
  rm -rf /out/.next/static
  cp -a "$static_dir" /out/.next/static
  if [ -d packages/web/public ]; then
    rm -rf /out/public
    cp -a packages/web/public /out/public
  fi
  printf '%s\n' "server.js" > /out/SERVER_JS
else
  echo "botanical: standalone server.js not found under ${standalone}" >&2
  find "$standalone" -name server.js -print 2>/dev/null | head -n 20 >&2 || true
  exit 1
fi

echo "botanical: staged Next standalone ($(cat /out/SERVER_JS))"
