# syntax=docker/dockerfile:1
# Botanical web image. Next.js standalone output, listening on port 3000.
#   docker build -f web.Dockerfile -t botanical-web .
# BOTANICAL_API_URL is baked into rewrites at build time (Compose default:
# http://server:8787). Local `next dev` reads the same variable per request
# and defaults to http://127.0.0.1:8787.

ARG BUN_IMAGE=oven/bun:1.4.2-alpine
ARG NODE_IMAGE=node:22-alpine
ARG BOTANICAL_API_URL=http://server:8787

# Only package.json files, so a source edit leaves the install layer cached.
FROM ${BUN_IMAGE} AS manifests
WORKDIR /app
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

FROM ${BUN_IMAGE} AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat ca-certificates
COPY package.json bun.lock tsconfig.base.json ./
COPY --from=manifests /app/packages ./packages
# The cache mount keeps downloaded packages across builds and Compose projects.
RUN --mount=type=cache,id=botanical-bun,target=/var/cache/bun \
    BUN_INSTALL_CACHE_DIR=/var/cache/bun bun install --frozen-lockfile --backend=copyfile
COPY packages ./packages
COPY deploy/scripts/ensure-next-standalone.mjs deploy/scripts/ensure-next-standalone.mjs
COPY deploy/scripts/stage-next-standalone.sh deploy/scripts/stage-next-standalone.sh
# A checkout from before the LF attributes can still contain CR. Strip it
# before `sh` parses `set -eu` (`illegal option -`).
RUN sed -i 's/\r$//' deploy/scripts/stage-next-standalone.sh
ARG BOTANICAL_API_URL
ENV BOTANICAL_API_URL=${BOTANICAL_API_URL} \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
# .next/cache holds the Turbopack build cache, so a rebuild only recompiles
# what changed.
RUN --mount=type=cache,id=botanical-next,target=/app/packages/web/.next/cache,sharing=locked \
  bun deploy/scripts/ensure-next-standalone.mjs \
  && cd packages/web \
  && bun run build \
  && cd /app \
  && sh deploy/scripts/stage-next-standalone.sh

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat ca-certificates \
  && addgroup -S -g 1001 botanical \
  && adduser -S -D -H -h /tmp -u 1001 -G botanical botanical
COPY deploy/scripts/web-entrypoint.sh /entrypoint.sh
COPY --from=build --chown=botanical:botanical /out /app
RUN sed -i 's/\r$//' /entrypoint.sh \
  && chmod +x /entrypoint.sh
USER botanical
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HOME=/tmp
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
LABEL org.opencontainers.image.title="botanical-web" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical web (Next.js standalone)"
