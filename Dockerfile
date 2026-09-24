# syntax=docker/dockerfile:1
# Botanical API image (Bun). Build from the repo root:
#   docker build -t botanical-server .
# Compose runs migrations before listen. See deploy/scripts/server-entrypoint.sh.

ARG BUN_IMAGE=oven/bun:1.4.2-alpine

FROM ${BUN_IMAGE} AS install
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile --production

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
RUN apk add --no-cache ca-certificates su-exec \
  && addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical \
  && mkdir -p /data /config \
  && chown botanical:botanical /data
COPY --from=install /app /app
COPY deploy/scripts/server-entrypoint.sh /entrypoint.sh
COPY config/mcp.json /config/mcp.json
RUN chmod +x /entrypoint.sh
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    BOTANICAL_HOST=0.0.0.0 \
    BOTANICAL_WORKSPACE=/data \
    BOTANICAL_MCP_CONFIG=/config/mcp.json \
    HOME=/tmp
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
LABEL org.opencontainers.image.title="botanical-server" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical API on Bun"
