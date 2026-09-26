#!/usr/bin/env bash
# Build the Bun API and the Next.js standalone web app, then pack both into
# dist/botanical-<version>.zip. Run from the repo root after `bun install`.
#
#   bash scripts/release/package.sh [version]
#
# Env:
#   BOTANICAL_API_URL  Rewrite target baked into the web build
#                      (default http://127.0.0.1:8787, the API started by start.sh).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

version=${1:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}
name="botanical-${version}"
out="$root/dist"
stage="$out/$name"

# Server-side workspace packages the API needs at runtime.
server_pkgs=(agent-runtime core db mcp providers server tools tools-shell tools-web)

rm -rf "$stage" "$out/$name.zip"
mkdir -p "$stage/server/packages" "$stage/web" "$stage/config"

echo "==> web: next build (standalone)"
(
  cd packages/web
  BOTANICAL_API_URL="${BOTANICAL_API_URL:-http://127.0.0.1:8787}" \
    NEXT_TELEMETRY_DISABLED=1 bun run build
)
standalone="packages/web/.next/standalone"
if [ ! -f "$standalone/packages/web/server.js" ]; then
  echo "package: expected $standalone/packages/web/server.js" >&2
  exit 1
fi
cp -a "$standalone/." "$stage/web/"
mkdir -p "$stage/web/packages/web/.next"
cp -a packages/web/.next/static "$stage/web/packages/web/.next/static"
if [ -d packages/web/public ]; then
  cp -a packages/web/public "$stage/web/packages/web/public"
fi

echo "==> server: stage sources"
cp tsconfig.base.json "$stage/server/"
cp bun.lock "$stage/server/"
for pkg in "${server_pkgs[@]}"; do
  mkdir -p "$stage/server/packages/$pkg"
  (
    cd "packages/$pkg"
    # Everything tracked except tests; untracked files (node_modules, .env) stay out.
    git ls-files | grep -Ev '(^|/)(test|tests)/|\.test\.ts$|(^|/)\.env$' \
      | tar -cf - -T - | tar -xf - -C "$stage/server/packages/$pkg"
  )
done
# Root manifest limited to the staged workspaces.
bun -e '
  const [src, dst, ...pkgs] = process.argv.slice(1);
  const pkg = JSON.parse(await Bun.file(src).text());
  pkg.workspaces = pkgs.map((p) => `packages/${p}`);
  pkg.scripts = {
    start: "bun run --cwd packages/server start",
    "db:migrate": "bun run --filter @botanical/db migrate",
  };
  delete pkg.devDependencies;
  await Bun.write(dst, JSON.stringify(pkg, null, 2) + "\n");
' package.json "$stage/server/package.json" "${server_pkgs[@]}"

echo "==> server: install production dependencies"
(
  cd "$stage/server"
  # Drop e2e/web from the lockfile (versions stay pinned), then install prod deps.
  bun install --lockfile-only
  bun install --production --linker hoisted
  bun -e 'await import("./packages/server/src/serve.ts"); console.log("server entry resolves")'
)

echo "==> release files"
cp config/mcp.json "$stage/config/mcp.json"
cp config/mcp.example.json "$stage/config/mcp.example.json"
cp scripts/release/env.example "$stage/.env.example"
cp scripts/release/docker-compose.yml "$stage/docker-compose.yml"
cp scripts/release/start.sh "$stage/start.sh"
cp scripts/release/README.md "$stage/README.md"
cp LICENSE "$stage/LICENSE"
chmod +x "$stage/start.sh"
printf '%s\n' "$version" > "$stage/VERSION"

echo "==> zip"
(cd "$out" && zip -qry "$name.zip" "$name")
ls -lh "$out/$name.zip"
echo "$out/$name.zip"
