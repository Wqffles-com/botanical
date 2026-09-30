# syntax=docker/dockerfile:1
# Botanical API image (Bun). Build from the repo root:
#   docker build -t botanical-server .
# Compose runs migrations before listen. See deploy/scripts/server-entrypoint.sh.

ARG BUN_IMAGE=oven/bun:1.4.2-alpine

# Only package.json files, so a source edit leaves the install layer cached.
FROM ${BUN_IMAGE} AS manifests
WORKDIR /app
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

FROM ${BUN_IMAGE} AS install
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY --from=manifests /app/packages ./packages
# The cache mount keeps downloaded packages across builds and Compose projects.
RUN --mount=type=cache,id=botanical-bun,target=/var/cache/bun \
    BUN_INSTALL_CACHE_DIR=/var/cache/bun bun install --frozen-lockfile --production --backend=copyfile
COPY packages ./packages

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
# Alpine stays the base: Grok's Linux build is a static binary, Claude publishes
# a musl build, and Codex publishes a musl build. Claude's musl binary needs
# libgcc, libstdc++, and the system ripgrep (its bundled rg is glibc). git backs
# the git_* agent tools.
RUN alpine_ver="$(cut -d. -f1,2 /etc/alpine-release)" \
  && if ! grep -q '/community' /etc/apk/repositories; then \
       echo "https://dl-cdn.alpinelinux.org/alpine/v${alpine_ver}/community" >> /etc/apk/repositories; \
     fi \
  && apk add --no-cache ca-certificates su-exec libgcc libstdc++ ripgrep git \
  && addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical \
  && mkdir -p /data /config /opt/botanical-cli/bin /home/botanical \
  && chown -R botanical:botanical /data /opt/botanical-cli /home/botanical
COPY --from=install /app /app
COPY deploy/scripts/server-entrypoint.sh /entrypoint.sh
COPY config/mcp.json /config/mcp.json
# A checkout from before the LF attributes can still contain CR.
RUN sed -i 's/\r$//' /entrypoint.sh \
  && chmod +x /entrypoint.sh
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    BOTANICAL_HOST=0.0.0.0 \
    BOTANICAL_WORKSPACE=/data \
    BOTANICAL_MCP_CONFIG=/config/mcp.json \
    HOME=/tmp \
    PATH="/opt/botanical-cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    USE_BUILTIN_RIPGREP=0
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
LABEL org.opencontainers.image.title="botanical-server" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical API on Bun"
