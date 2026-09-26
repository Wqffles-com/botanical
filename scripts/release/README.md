# Botanical release

Prebuilt Botanical: the Bun API (`server/`) and the Next.js standalone web app (`web/`).

## Requirements

- Bun 1.2 or newer (API)
- Node.js 20 or newer (web)
- Postgres 15+ (or Docker, for the bundled `docker-compose.yml`)

## Run

```sh
cp .env.example .env        # set BOTANICAL_PASSWORD, provider keys, DATABASE_URL
docker compose up -d        # Postgres on 127.0.0.1:5433 (skip if you have one)
./start.sh                  # API on 127.0.0.1:8787, web on http://localhost:3000
```

The API applies Postgres migrations on boot. Leave `DATABASE_URL` empty to run with
an in-memory store (data is lost on restart).

`./start.sh server` or `./start.sh web` starts one process. Health check:
`curl http://127.0.0.1:8787/api/health`.

## Notes

- The web build proxies `/api/*` to `http://127.0.0.1:8787`. That target is baked in at
  build time; run the API on that address or rebuild with `BOTANICAL_API_URL` set.
- `server/node_modules` holds production dependencies installed on Linux x64. They are
  plain JavaScript; if something is missing, run `bun install --production` in `server/`.
- To build container images instead, use the Dockerfiles and `docker-compose.yml` in the
  source repository.
