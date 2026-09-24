# Deploy Botanical

One codebase, two operating modes. `DEPLOYMENT_MODE=SELF_HOST` is a personal server you run. `DEPLOYMENT_MODE=SAAS` is the same images on hosts Botanical operates. Accounts and subscription billing are not turned on. The license stays MIT.

The MVP stack is Docker Compose, project name **`botanical-mvp`**:

| Service | Role | Inside the network | Published on the host |
|---------|------|--------------------|------------------------|
| `web` | Next.js (standalone) | `3000` | `${WEB_BIND:-0.0.0.0}:${WEB_PORT:-3000}` |
| `server` | Bun API, passcode, provider keys | `8787` | `127.0.0.1:${SERVER_PORT:-8788}` |
| `postgres` | Postgres 17 | `5432` | `127.0.0.1:${POSTGRES_PORT:-5433}` |

Those host ports are the defaults so this project does not bind 8080, 8787, or 5432. A different Compose project can keep using those.

Model calls leave the server for OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, or a custom OpenAI-compatible base URL. Keys stay in the server environment. The browser never receives them.

There is no default model. A profile is chosen in the product for each chat. `BOTANICAL_PROFILES` only lists what can be chosen. `mock` is the local echo profile and needs no provider key.

## Self-host quickstart

Requires Docker and Compose v2.24 or newer (the SaaS file uses `depends_on: !reset`).

```sh
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
cp .env.example .env
```

Edit `.env`. Set a long `BOTANICAL_PASSCODE`. Change `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL` before anyone else can reach the host. The host in `DATABASE_URL` is `postgres` (the Compose service) and the port in that URL is **5432**. `POSTGRES_PORT` is only the port published on the machine (default **5433**).

```sh
docker compose up --build -d
curl -fsS http://127.0.0.1:8788/api/health
```

Open `http://localhost:3000`. The web container is Next.js on port 3000 inside and, with the default `WEB_PORT`, on port 3000 on the host.

`/api/*` on the web origin is rewritten to the API at build time (`BOTANICAL_API_URL`, default `http://server:8787` on the Compose network). Changing that URL means rebuilding the web image.

Unlock check, through the web origin:

```sh
curl -fsS -c /tmp/botanical.cookies -H 'content-type: application/json' \
  -d '{"passcode":"YOUR_PASSCODE"}' \
  http://127.0.0.1:3000/api/auth/login
curl -fsS -b /tmp/botanical.cookies http://127.0.0.1:3000/api/auth/me
```

The API also accepts `"password"` in that JSON body. Leave `BOTANICAL_PASSWORD` empty to use `BOTANICAL_PASSCODE` (the entrypoint copies it). If both are set, `BOTANICAL_PASSWORD` is the one the API checks. `BOTANICAL_PASSWORD_HASH` (argon2) wins over either plaintext.

Logs and shutdown:

```sh
docker compose logs -f server web
docker compose down
```

`docker compose down` keeps the Postgres volume and the file workspace. `docker compose down -v` deletes both.

On boot the server container:

1. Normalizes `DEPLOYMENT_MODE` / `BOTANICAL_DEPLOYMENT_MODE` to `SELF_HOST` or `SAAS`.
2. Chowns the workspace volume (`/data`) and drops to the `botanical` user.
3. Runs `bun run db:migrate` when `DATABASE_URL` is set (Drizzle migrations in `packages/db`, then guards and bootstrap SQL). Retries for about 30 seconds if Postgres is not ready yet.
4. Starts `packages/server` (`bun src/serve.ts`) on port 8787.

`GET /api/health` (also `/health` and `/ready` on this server) is the liveness check. It includes `deploymentMode`. Migrations finish before the process listens, so a healthy container has already migrated.

If `DATABASE_URL` is set and `packages/db` does not export the HTTP `createStore`, the process exits instead of silently using memory. Unset `DATABASE_URL` only for a throwaway in-memory run.

### Local dev without Compose

From the repo root, after `bun install`:

```sh
bun run dev
```

That starts the API (`packages/server`, port 8787) and `next dev` (port 3000) together. Next proxies `/api` to `http://127.0.0.1:8787` unless `BOTANICAL_API_URL` is set. Point `DATABASE_URL` at a Postgres you can reach and run `bun run db:migrate` once before relying on persistence.

`bun run build` builds every workspace package that defines `build` (the web package runs `next build`). `bun run typecheck` and `bun run test` do the same for `typecheck` and `test`.

### Images

```sh
docker build -t botanical-server .
docker build -f web.Dockerfile -t botanical-web .
```

The server image is multi-stage: install production dependencies with Bun, then a runtime stage that keeps the workspace source and runs the entrypoint. The web image installs the workspace, runs `next build` with `output: "standalone"`, and copies that server onto `node:22-alpine`. The runtime listens on **3000**. `packages/web/next.config.ts` must keep `output: "standalone"`. The image build injects that setting when a Next config is present and forgot it.

Override base images with `BUN_IMAGE` and `NODE_IMAGE`. Pin digests on a host you do not rebuild yourself.

## Environment

Copy from [.env.example](../.env.example). Do not commit `.env`.

| Key | Required | Purpose |
|-----|----------|---------|
| `DEPLOYMENT_MODE` | yes | `SELF_HOST` or `SAAS` |
| `BOTANICAL_PASSCODE` | yes | Web → server gate. Copied to `BOTANICAL_PASSWORD` when that is empty |
| `DATABASE_URL` | yes for Postgres | Host `postgres`, port `5432`, on the Compose network |
| `BOTANICAL_SESSION_SECRET` | SaaS | Cookie signing secret. Change the example before a shared deploy |
| `BOTANICAL_PUBLIC_ORIGIN` | recommended | Public web origin. Pair `https://` with `BOTANICAL_COOKIE_SECURE=true` |
| `OPENAI_API_KEY` | no | GPT |
| `ANTHROPIC_API_KEY` | no | Claude |
| `XAI_API_KEY` | no | Grok |
| `DEEPSEEK_API_KEY` | no | DeepSeek |
| `OPENROUTER_API_KEY` | no | OpenRouter |
| `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` | no | OpenAI-compatible host. Both are required before that profile is listed |
| `CUSTOM_OPENAI_BASE_URL` / `CUSTOM_OPENAI_API_KEY` | no | Legacy aliases of `OPENAI_COMPAT_*` |
| `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` / `SERPER_API_KEY` | no | Built-in web search |
| `SEARXNG_URL` / `SEARXNG_API_KEY` | no | SearXNG search |
| `BOTANICAL_MCP_CONFIG` | no | MCP JSON inside the server container (`/config/mcp.json`) |

Postgres passwords in the URL must be URL-encoded. Keep `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` the same when you use the bundled database.

### MCP

Compose mounts `BOTANICAL_MCP_CONFIG_FILE` (default `./config/mcp.json`) onto `/config/mcp.json` read-only, and sets `BOTANICAL_MCP_CONFIG` to that path. The committed file has an empty server list. The workspace volume is mounted at `/data` (`BOTANICAL_WORKSPACE`).

`BOTANICAL_MCP_SERVERS` (inline JSON) overrides the file when it is non-empty. `BOTANICAL_MCP_DISABLED=1` connects nothing.

The file accepts the current `servers` array and a Claude Desktop-style `mcpServers` map. A stdio server runs inside the API container. `bunx` is on `PATH` (the image is Bun). Example, not enabled in the default file:

```json
{
  "servers": [
    {
      "id": "filesystem",
      "transport": "stdio",
      "command": "bunx",
      "args": ["--bun", "@modelcontextprotocol/server-filesystem", "/data"]
    }
  ]
}
```

Do not commit tokens. Prefer `BOTANICAL_MCP_CONFIG_FILE` pointing at a file outside git, or `${ENV}` placeholders that the MCP loader expands from the server environment.

## TLS

The web port speaks HTTP. On a VPS, publish the UI only to loopback and terminate TLS in front:

```sh
# .env
WEB_BIND=127.0.0.1
BOTANICAL_PUBLIC_ORIGIN=https://botanical.example.com
BOTANICAL_COOKIE_SECURE=true
```

Caddy on the host:

```caddy
botanical.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Leave Postgres on `127.0.0.1` and do not publish `5433` in a cloud security group. The API publish is already loopback. Browsers talk to `web`. Provider keys and the passcode must not cross the internet in cleartext.

## Data, backups, upgrades

Named volumes (prefixed with the project name): `botanical-mvp_botanical_pg` and `botanical-mvp_botanical_workspace` (file and shell jail at `/data`).

```sh
docker compose exec postgres pg_dump -U botanical -d botanical > botanical.sql
```

Restore into an empty volume:

```sh
docker compose exec -T postgres psql -U botanical -d botanical < botanical.sql
```

The file workspace is local disk. Run one server replica against that volume.

Upgrade:

```sh
git pull
docker compose up --build -d
```

Init SQL under `deploy/postgres/init/` runs only the first time the Postgres volume is created. It sets the database timezone to UTC. Application tables come from `packages/db` migrations on server boot, not from that init script.

A 1 vCPU / 1 GB host is enough for the stack itself. Model inference is API traffic, not a local model.

```sh
docker compose logs -f server web
```

## Hosted SaaS

SaaS here means **the same artifacts, operated by us**, not a multi-tenant product.

What to set:

- `DEPLOYMENT_MODE=SAAS` (the override file forces this on the server).
- A passcode that is not the example value, and `BOTANICAL_SESSION_SECRET` of at least 16 characters that is not the example.
- `BOTANICAL_PUBLIC_ORIGIN=https://…` and `BOTANICAL_COOKIE_SECURE=true`.
- `DATABASE_URL` pointing at managed Postgres.

What this does **not** do:

- No customer accounts, no tenant isolation, no per-tenant keys.
- No subscription billing. `STRIPE_*` names in `.env.example` are reserved comments. Nothing charges a card.
- Do not put more than one customer on one process.

Bring the process up without the bundled database:

```sh
# .env — managed Postgres, real secrets, public https origin
DEPLOYMENT_MODE=SAAS
DATABASE_URL=postgresql://botanical:URL_ENCODED@db.internal:5432/botanical?sslmode=require
BOTANICAL_PASSCODE=...
BOTANICAL_SESSION_SECRET=...
BOTANICAL_PUBLIC_ORIGIN=https://app.example.com
BOTANICAL_COOKIE_SECURE=true

docker compose -f docker-compose.yml -f docker-compose.saas.yml up --build -d
```

`docker-compose.saas.yml` gives `postgres` a profile so it does not start, clears the server's dependency on it, and sets `DEPLOYMENT_MODE=SAAS`.

Operating notes:

- Inject secrets from the host secret store. Do not bake `.env` into an image. `.dockerignore` excludes `.env`.
- Pin image digests (`BUN_IMAGE`, `NODE_IMAGE`, and the Postgres tag) instead of floating tags.
- Keep Postgres on a private network. Only the TLS edge is public. The API container port stays on loopback; browsers talk to `web`.
- Use one shared `BOTANICAL_SESSION_SECRET` if you ever run more than one API replica. Sessions are HMAC cookies.
- The file workspace volume is single-writer. Scale the API only after workspace storage is shared, or with workspace tools disabled.
- Rebuild `web` when `BOTANICAL_API_URL` changes. Rewrites are compiled into the Next standalone server.
- Take Postgres backups and rehearse a restore. The entrypoint migrates; it does not snapshot.
- Readiness for an orchestrator is `GET /api/health` after the entrypoint has migrated and the process is listening.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Server exits immediately | `docker compose logs server`. Missing passcode, bad `DEPLOYMENT_MODE`, or `DATABASE_URL` set while `packages/db` has no `createStore` |
| `migrations failed` | `DATABASE_URL` host should be `postgres` and the password must match `POSTGRES_PASSWORD`. `docker compose ps` should show postgres healthy |
| Web UI loads, `/api/auth/me` fails | Web was built with the wrong `BOTANICAL_API_URL`, or the server is not healthy. Rebuild web after changing the API URL |
| Cookie does not stick | `https://` origin with the site opened over `http://`, or `BOTANICAL_COOKIE_SECURE` does not match the scheme |
| Port already in use | Another stack is on 3000, 8788, or 5433. Change `WEB_PORT`, `SERVER_PORT`, or `POSTGRES_PORT`. Do not reuse 8080 / 8787 / 5432 if that project is running |
| Compose attached to the wrong project | The file sets `name: botanical-mvp`. Do not pass `-p botanical` |
| MCP file missing | `BOTANICAL_MCP_CONFIG_FILE` must be a file. A missing path makes Docker create a directory and the entrypoint exits |
| Empty standalone image | `packages/web` must `next build` with `output: "standalone"`. The web Dockerfile fails if `server.js` is not emitted |
| Old database password | Postgres applies `POSTGRES_PASSWORD` only on first init. Existing volume: `docker compose exec postgres psql -U botanical -d botanical -c "ALTER USER botanical PASSWORD '...'"` and update `DATABASE_URL` |
