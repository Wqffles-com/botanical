# syntax=docker/dockerfile:1
# Botanical web image.
#   docker build -f web.Dockerfile --target runtime-nginx .   (default)
#   docker build -f web.Dockerfile --target runtime-bun   .
#   docker build -f web.Dockerfile --target runtime-node  .
# packages/web is built when present; otherwise the deploy status page is served.
# Nginx proxies /api/, /health, and /ready and does not buffer (SSE-friendly).

ARG BUN_IMAGE=oven/bun:1.4-alpine
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${BUN_IMAGE} AS build
WORKDIR /src
COPY . .
RUN chmod +x deploy/scripts/*.sh && sh deploy/scripts/build-web.sh

FROM ${NODE_IMAGE} AS runtime-node
WORKDIR /app
RUN addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical
COPY deploy/web/static-server.mjs /app/static-server.mjs
COPY --from=build /out/public /app/public
RUN chown -R botanical:botanical /app
USER botanical
ENV PORT=8080 \
    WEB_ROOT=/app/public \
    API_UPSTREAM=http://server:8787 \
    HOME=/tmp
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/app/static-server.mjs"]
LABEL org.opencontainers.image.title="botanical-web" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT"

FROM ${BUN_IMAGE} AS runtime-bun
WORKDIR /app
USER root
RUN addgroup -S botanical \
  && adduser -S -D -H -h /tmp -G botanical botanical
COPY deploy/web/static-server.mjs /app/static-server.mjs
COPY --from=build /out/public /app/public
RUN chown -R botanical:botanical /app
USER botanical
ENV PORT=8080 \
    WEB_ROOT=/app/public \
    API_UPSTREAM=http://server:8787 \
    HOME=/tmp
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "/app/static-server.mjs"]
LABEL org.opencontainers.image.title="botanical-web" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT"

FROM ${NGINX_IMAGE} AS runtime-nginx
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/web/proxy-params.conf /etc/nginx/proxy-params.conf
COPY deploy/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /out/public /usr/share/nginx/html
ENV API_UPSTREAM=http://server:8787 \
    NGINX_RESOLVER=127.0.0.11 \
    PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
LABEL org.opencontainers.image.title="botanical-web" \
      org.opencontainers.image.source="https://github.com/Wqffles-com/botanical" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Botanical web (nginx)"
