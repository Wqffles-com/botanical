# syntax=docker/dockerfile:1
# Botanical server image.
#   docker build --target runtime-bun  .   (default; project runtime)
#   docker build --target runtime-node .
# When packages/server and a root package.json are in the context, the Bun
# image starts that package. Otherwise it starts the deploy bootstrap.

ARG BUN_IMAGE=oven/bun:1.4-alpine
ARG NODE_IMAGE=node:22-alpine

FROM ${BUN_IMAGE} AS bootstrap-deps
WORKDIR /src/deploy/server
COPY deploy/server/package.json deploy/server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM ${BUN_IMAGE} AS build
WORKDIR /src
COPY . .
COPY --from=bootstrap-deps /src/deploy/server/node_modules ./deploy/server/node_modules
RUN chmod +x deploy/scripts/*.sh && sh deploy/scripts/build-server.sh

FROM ${NODE_IMAGE} AS runtime-node
WORKDIR /app
USER root
RUN apk add --no-cache su-exec \
  && addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical \
  && mkdir -p /data \
  && chown botanical:botanical /data
COPY --from=build /out/node /app
RUN chmod +x /app/entrypoint.sh
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    HOME=/tmp \
    WEB_ROOT=/app/public \
    SERVE_WEB=0 \
    BOTANICAL_WORKSPACE=/data
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node"]
LABEL org.opencontainers.image.title="botanical-server" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical server on Node"

FROM ${BUN_IMAGE} AS runtime-bun
WORKDIR /app
USER root
RUN apk add --no-cache su-exec \
  && addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical \
  && mkdir -p /data \
  && chown botanical:botanical /data
COPY --from=build /out/bun /app
RUN chmod +x /app/entrypoint.sh
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    HOME=/tmp \
    WEB_ROOT=/app/public \
    SERVE_WEB=0 \
    BOTANICAL_WORKSPACE=/data
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=10 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["bun"]
LABEL org.opencontainers.image.title="botanical-server" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical server on Bun"
