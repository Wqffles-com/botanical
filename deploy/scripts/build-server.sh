#!/bin/sh
# Assemble /out/bun and /out/node from the deploy bootstrap.
# When the monorepo server package is in the build context, the Bun image
# runs that package instead of the bootstrap.
set -eu

mkdir -p /out/bun/deploy/server /out/bun/public /out/node/public

cp -a /src/deploy/server/src /out/bun/deploy/server/src
cp -a /src/deploy/server/package.json /out/bun/deploy/server/package.json
cp -a /src/deploy/server/node_modules /out/bun/deploy/server/node_modules
cp -a /src/deploy/web/public/. /out/bun/public/
cp -a /src/deploy/scripts/entrypoint.sh /out/bun/entrypoint.sh

cd /src/deploy/server
bun build src/index.ts --target=node --outfile=/out/node/server.mjs --packages=external
cp -a node_modules /out/node/node_modules
cp -a package.json /out/node/package.json
cp -a /src/deploy/web/public/. /out/node/public/
cp -a /src/deploy/scripts/entrypoint.sh /out/node/entrypoint.sh
printf '%s\n' bootstrap > /out/node/RUNTIME_KIND

if [ -f /src/package.json ] && [ -f /src/packages/server/package.json ]; then
  echo "botanical: monorepo server package found"
  cd /src
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    bun install --frozen-lockfile
  else
    echo "botanical: no bun.lock; installing the workspace without a frozen lockfile"
    bun install
  fi
  if bun -e 'const p=require("./packages/server/package.json"); process.exit(p.scripts&&p.scripts.build?0:1)'; then
    echo "botanical: building packages/server"
    name=$(bun -e 'process.stdout.write(require("./packages/server/package.json").name)')
    if bun run --filter "$name" build; then
      :
    else
      (cd /src/packages/server && bun run build)
    fi
  fi
  mkdir -p /out/bun/repo
  cp -a /src/package.json /out/bun/repo/package.json
  cp -a /src/packages /out/bun/repo/packages
  if [ -d /src/node_modules ]; then
    cp -a /src/node_modules /out/bun/repo/node_modules
  fi
  for extra in bun.lock bun.lockb tsconfig.json tsconfig.base.json bunfig.toml; do
    if [ -f "/src/$extra" ]; then
      cp -a "/src/$extra" "/out/bun/repo/$extra"
    fi
  done
  printf '%s\n' monorepo > /out/bun/RUNTIME_KIND
else
  echo "botanical: packages/server not in context; image runs the deploy bootstrap"
  printf '%s\n' bootstrap > /out/bun/RUNTIME_KIND
fi
