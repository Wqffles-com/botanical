# Placeholder Botanical server. Serves GET /health; does not open Postgres yet.
FROM oven/bun:1.4.2

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV PORT=8787
ENV BOTANICAL_MODE=self-host
EXPOSE 8787

CMD ["bun", "run", "--filter", "@botanical/server", "start"]
