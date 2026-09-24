# Deploy Botanical

One codebase, two operating modes. `DEPLOYMENT_MODE=self_host` is a personal server you run. `DEPLOYMENT_MODE=saas` is the same images on hosts Botanical operates. v0 does not turn on multi-tenant accounts or billing; those stay deferred. The license for this repo stays MIT.

The reference stack is Docker Compose:

| Service   | Role | Published port |
|-----------|------|----------------|
| `postgres` | Postgres 17 | `127.0.0.1:5432` only |
| `server` | API, passcode gate, provider keys | `127.0.0.1:8787` only |
| `web` | UI and same-origin proxy to the API | `8080` (set `WEB_BIND`) |

Model calls leave the server for OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, or a custom OpenAI-compatible base URL. Keys stay in the server environment. The browser never receives them.

Images default to **Bun**. Each Dockerfile also has a **Node 22** target built from the same source. The web image defaults to nginx so streamed responses are not buffered.

## Self-host quickstart

Requires Docker and Compose v2.24 or newer. The SaaS override uses `depends_on: !reset`, which landed in Compose 2.24. The self-host file itself is ordinary Compose.

```sh
git clone https://github.com/Wqffles-com/botanical.git
cd botanical
cp .env.example .env
```

Edit `.env` and set a long `BOTANICAL_PASSCODE`. Change `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL` before the host is reachable by anyone else. The host in `DATABASE_URL` is `postgres` (the Compose service), not `localhost`.

```sh
docker compose up --build -d
curl -fsS http://127.0.0.1:8787/ready
```

Open `http://localhost:8080`. The status page is a deploy placeholder. When `packages/web` is part of the build context, the web image serves that build instead.

Unlock check:

```sh
curl -fsS -c /tmp/botanical.cookies -H 'content-type: application/json' \
  -d '{"passcode":"YOUR_PASSCODE"}' \
  http://127.0.0.1:8080/api/session
curl -fsS -b /tmp/botanical.cookies http://127.0.0.1:8080/api/me
```

Stop, or follow logs:

```sh
docker compose logs -f server
docker compose down
```

`docker compose down` keeps the Postgres volume. `docker compose down -v` deletes the database volume and the file workspace.

### What comes up before the app packages exist

Until `packages/server` is in the image, the server process is the deploy bootstrap:

- `GET /health` — process is up (always 200 once it is listening)
- `GET /ready` — 200 when Postgres answers `select 1`, otherwise 503
- `GET /api/meta` — mode, and which provider keys are set (booleans only)
- `POST /api/session` — passcode, sets an HttpOnly cookie
- `DELETE /api/session` — clears it
- `GET /api/me` — requires that cookie

`/api/meta` includes `"role": "deploy-bootstrap"` and `"multiTenant": false`. No application tables are created here. Schema migrations belong to `packages/db`.

When the build context contains a root `package.json` and `packages/server/package.json` with a `start` script, the Bun image runs that package instead. If the root `package.json` defines `db:migrate`, the entrypoint runs it before `start`. Set `BOTANICAL_FORCE_BOOTSTRAP=1` to keep the bootstrap anyway.

The web image builds `packages/web` (`dist/` or `build/`) when that package exists. Otherwise it serves `deploy/web/public`.

### Server serves the UI itself

Skip the web container and let the server process serve files:

```sh
SERVE_WEB=1 docker compose up --build -d postgres server
```

The UI is on `http://127.0.0.1:8787` in that mode (the API port stays on loopback). The separate web service is the one that publishes a LAN or public port.

### Bun and Node targets

```sh
# defaults: Bun server, nginx web
docker compose build

SERVER_RUNTIME=runtime-node docker compose build server
WEB_RUNTIME=runtime-bun docker compose build web
WEB_RUNTIME=runtime-node docker compose build web
```

Plain `docker build .` produces the Bun server image (last stage). Node is `--target runtime-node`. The Node image runs the deploy bootstrap. It does not start a Bun-only `packages/server`. Use `runtime-bun` for the application server.

Override base images with `BUN_IMAGE`, `NODE_IMAGE`, and `NGINX_IMAGE` if you pin digests.

## Environment

Copy from [.env.example](../.env.example). Do not commit `.env`.

| Key | Required | Purpose |
|-----|----------|---------|
| `DEPLOYMENT_MODE` | yes | `self_host` or `saas` |
| `BOTANICAL_PASSCODE` | yes | Web → server gate |
| `DATABASE_URL` | yes | Postgres URL. Host `postgres` on the Compose network |
| `BOTANICAL_SESSION_SECRET` | saas | Cookie signing secret. Self-host derives one if unset |
| `BOTANICAL_PUBLIC_ORIGIN` | recommended | Public web origin. `https://` enables Secure cookies |
| `OPENAI_API_KEY` | no | GPT |
| `ANTHROPIC_API_KEY` | no | Claude |
| `XAI_API_KEY` | no | Grok |
| `DEEPSEEK_API_KEY` | no | DeepSeek |
| `OPENROUTER_API_KEY` | no | OpenRouter |
| `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` | no | OpenAI-compatible host. Both are required before that profile is listed. `OPENAI_COMPAT_MODEL` sets its model id |
| `CUSTOM_OPENAI_BASE_URL` / `CUSTOM_OPENAI_API_KEY` | no | Legacy aliases of `OPENAI_COMPAT_*`, used only when the canonical name is unset |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` | no | Built-in web search, when that tool ships |

Postgres passwords in the URL must be URL-encoded (`@` → `%40`). Keep `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` the same when you use the bundled database. The server logs a warning (not the password) if they differ, and if `DATABASE_URL` points at `localhost` from inside the container.

Secret files: set `BOTANICAL_PASSCODE_FILE`, `DATABASE_URL_FILE`, `BOTANICAL_SESSION_SECRET_FILE`, or `<PROVIDER>_API_KEY_FILE` to a file path. An empty file is an error. A non-empty plain env value wins over the file.

`COOKIE_SECURE=auto` (default) is on only when `BOTANICAL_PUBLIC_ORIGIN` is `https://`. Force it with `COOKIE_SECURE=1` or `0`.

There is no default model. Profiles are chosen in the product, not by this deploy.

## TLS

The Compose web port speaks HTTP. On a VPS, publish the UI only to loopback and terminate TLS in front:

```sh
# .env
WEB_BIND=127.0.0.1
BOTANICAL_PUBLIC_ORIGIN=https://botanical.example.com
```

Caddy on the host:

```caddy
botanical.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

Leave Postgres on `127.0.0.1` and do not publish `5432` in a cloud security group. Provider keys and the passcode must not cross the internet in cleartext.

## Data, backups, upgrades

Named volumes: `botanical_pg` (database) and `botanical_workspace` (file and shell jail, mounted at `/data/workspace`, `BOTANICAL_WORKSPACE`).

```sh
docker compose exec postgres pg_dump -U botanical -d botanical > botanical.sql
```

Restore into an empty volume:

```sh
docker compose exec -T postgres psql -U botanical -d botanical < botanical.sql
```

The file workspace is local disk. Run one server replica against that volume. A second replica needs shared storage that this stack does not set up.

Upgrade:

```sh
git pull
docker compose up --build -d
```

Init SQL under `deploy/postgres/init/` runs only the first time the Postgres volume is created. It sets the database timezone to UTC. It does not create application tables.

A 1 vCPU / 1 GB host is enough for the stack itself. Model inference is not local; it is API traffic.

Logs are JSON on stdout:

```sh
docker compose logs -f server web
```

## Hosted SaaS operations

v0 SaaS means **the same artifacts, operated by us**, not a multi-tenant product.

What the flag does today:

- Boot refuses the example passcode and requires `BOTANICAL_SESSION_SECRET` (at least 16 characters, not the example).
- `/api/meta` reports `deploymentMode: "saas"`, `multiTenant: false`, and `billing: "deferred"`.
- Behavior otherwise matches self-host: one passcode, one database, server-side provider keys.

What it does **not** do:

- No customer accounts, no `tenant_id` isolation, no per-tenant keys.
- No subscription billing. `STRIPE_*` names in `.env.example` are reserved comments. Nothing charges a card.
- Do not put more than one customer on a v0 process. Wait until tenancy and billing exist.

Bring the process up without the bundled database:

```sh
# .env — managed Postgres, saas secrets, public https origin
DEPLOYMENT_MODE=saas
USE_BUNDLED_DATABASE=0
DATABASE_URL=postgresql://botanical:URL_ENCODED@db.internal:5432/botanical?sslmode=require
BOTANICAL_PASSCODE=...
BOTANICAL_SESSION_SECRET=...
BOTANICAL_PUBLIC_ORIGIN=https://app.example.com

docker compose -f docker-compose.yml -f docker-compose.saas.yml up --build -d
```

`docker-compose.saas.yml` gives `postgres` a profile so it does not start, clears the server's dependency on it, and sets `DEPLOYMENT_MODE=saas`.

Operating notes:

- Inject secrets from the host secret store or `*_FILE` mounts. Do not bake `.env` into an image. `.dockerignore` excludes `.env`.
- Pin image digests in production (`BUN_IMAGE`, `NODE_IMAGE`, `NGINX_IMAGE`, and the Postgres tag) instead of floating tags.
- Keep Postgres on a private network. Only the TLS edge is public. The API container port stays unpublished or bound to loopback; browsers talk to `web`.
- Use one shared `BOTANICAL_SESSION_SECRET` if you ever run more than one web-facing replica. Sessions are HMAC cookies, not server memory.
- The file workspace volume is single-writer. Scale the API only after workspace storage is shared, or with workspace tools disabled.
- Ship stdout JSON with the host log agent. The Compose file does not add a log vendor.
- Take Postgres backups and rehearse a restore. The bootstrap does not snapshot for you.
- Readiness for an orchestrator is `GET /ready`. Liveness is `GET /health` (stays 200 while the process is up, even if the database later blips). Compose marks the server healthy via `/health` after it has finished waiting for Postgres at startup.
- Nginx (`runtime-nginx`) resolves `API_UPSTREAM` (default `http://server:8787`) through `NGINX_RESOLVER` (default Docker DNS `127.0.0.11`). Set the resolver to the cluster DNS if you move the web container off Docker's bridge. `/api/` is unbuffered and forwards `Upgrade` so later streaming chat can pass through.
- The web container proxies `/api` on the same origin, so the UI does not need a baked-in API base URL.

## Package contract for the app image

These names are what the Dockerfiles look for. Later packages should follow them so Compose does not need a second deploy path.

| Path | Expectation |
|------|-------------|
| Root `package.json` | Bun workspace. Optional script `db:migrate`, run on container start when present |
| `packages/server` | `start` script. Optional `build` script, run at image build |
| `packages/web` | `build` script writing `dist/` or `build/` |
| `GET /health` | HTTP 200 when the process is serving |
| Env | Same keys as `.env.example`. Keys never go to the client |

The Bun server image entrypoint order is: own the `/data` volume as the unprivileged `botanical` user, run `db:migrate` when defined, then `bun run start` in `packages/server`.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Server exits immediately | `docker compose logs server`. Missing passcode, bad `DEPLOYMENT_MODE`, or saas mode still on the example secrets |
| `postgres not reachable` | `DATABASE_URL` host should be `postgres`. Password must match `POSTGRES_PASSWORD`. `docker compose ps` should show postgres healthy |
| Web UI loads, `/api/meta` fails | Web started before the server was ready, or `API_UPSTREAM` does not point at `http://server:8787` |
| Cookie does not stick | Public `https://` origin with the site opened over `http://`, or the reverse. Set `BOTANICAL_PUBLIC_ORIGIN` to the origin you actually use |
| Passcode works locally and fails through a proxy | `TRUST_PROXY` defaults to `1` in Compose because nginx sits in front. Direct exposure of the server port with that flag lets clients spoof `X-Forwarded-For` |
| Empty page after `packages/web` landed | The web build must emit `dist/` or `build/`. The image build fails if that package exists and the build fails |
| Old database password | Postgres Docker images apply `POSTGRES_PASSWORD` only on first init. Existing volume: `docker compose exec postgres psql -U botanical -d botanical -c "ALTER USER botanical PASSWORD '...'"` and update `DATABASE_URL` |
