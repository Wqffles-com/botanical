# Portable Botanical server image. Build from the repo root:
#   docker build -f packages/server/Dockerfile -t botanical-server packages/server
FROM oven/bun:1.2
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
ENV BOTANICAL_HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health'); if (!r.ok) process.exit(1)"
CMD ["bun", "src/serve.ts"]
