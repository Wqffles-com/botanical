#!/bin/sh
# Produce /out/public. Prefer a built packages/web bundle when that package exists.
set -eu

out=/out/public
mkdir -p "$out"

if [ -f /src/packages/web/package.json ]; then
  echo "botanical: building packages/web"
  if [ ! -f /src/package.json ]; then
    echo "botanical: packages/web is present but the root package.json is missing" >&2
    exit 1
  fi
  cd /src
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    bun install --frozen-lockfile
  else
    echo "botanical: no bun.lock; installing the workspace without a frozen lockfile"
    bun install
  fi
  name=$(bun -e 'process.stdout.write(require("./packages/web/package.json").name)')
  if ! bun -e 'const p=require("./packages/web/package.json"); process.exit(p.scripts&&p.scripts.build?0:1)'; then
    echo "botanical: packages/web has no build script" >&2
    exit 1
  fi
  built=0
  if bun run --filter "$name" build; then
    built=1
  elif (cd /src/packages/web && bun run build); then
    built=1
  fi
  if [ "$built" -ne 1 ]; then
    echo "botanical: packages/web build failed" >&2
    exit 1
  fi
  if [ -d /src/packages/web/dist ]; then
    cp -a /src/packages/web/dist/. "$out/"
  elif [ -d /src/packages/web/build ]; then
    cp -a /src/packages/web/build/. "$out/"
  else
    echo "botanical: packages/web build produced neither dist/ nor build/" >&2
    exit 1
  fi
  exit 0
fi

echo "botanical: packages/web not in context; using the deploy status page"
cp -a /src/deploy/web/public/. "$out/"
