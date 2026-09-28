# Deploy Botanical

Botanical is an always-on server. Deploy it to a VPS or dedicated host you control. Running it on a laptop or workstation is for development only, because agents stop when the machine sleeps.

One codebase, two operating modes. `DEPLOYMENT_MODE=SELF_HOST` is a server you run. `DEPLOYMENT_MODE=SAAS` is the same images run as the hosted service. Accounts and subscription billing are not turned on. The license stays MIT.

The reference stack is Docker Compose, project name **`botanical-mvp`**:

| Service | Role | Inside the network | Published on the host |
|---------|------|--------------------|------------------------|
| `web` | Next.js (standalone) | `3000` | `${WEB_BIND:-0.0.0.0}:${WEB_PORT:-3000}` |
| `server` | Bun API, passcode, provider keys | `8787` | `127.0.0.1:${SERVER_PORT:-8788}` |
| `postgres` | Postgres 17 | `5432` | `127.0.0.1:${POSTGRES_PORT:-5433}` |

The API and Postgres are published on loopback only. Change the host ports with `WEB_PORT`, `SERVER_PORT`, and `POSTGRES_PORT`.

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
| `BOTANICAL_SESSION_SECRET` | no | Reserved. The current API does not read it |
| `BOTANICAL_PUBLIC_ORIGIN` | recommended | Public web origin, and the origin used in webhook URLs. Pair `https://` with `BOTANICAL_COOKIE_SECURE=true` |
| Always-on tuning | no | Not environment variables. `always_on.scheduler_enabled`, `always_on.scheduler_interval_ms`, `always_on.background_concurrency`, and `always_on.listener_max_bytes` are instance settings. Edit them from Settings → Background work. Absent rows use the defaults (on, 15000 ms, 2, 65536). |
| `OPENAI_API_KEY` | no | GPT |
| `ANTHROPIC_API_KEY` | no | Claude |
| `XAI_API_KEY` | no | Grok. Also the xAI speech-to-text fallback |
| `DEEPSEEK_API_KEY` | no | DeepSeek |
| `OPENROUTER_API_KEY` | no | OpenRouter. Also the OpenRouter speech-to-text fallback |
| `DASHSCOPE_API_KEY` | no | Qwen speech-to-text. See [Dictation](#dictation) |
| `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` | no | OpenAI-compatible host. Both are required before that profile is listed |
| `CUSTOM_OPENAI_BASE_URL` / `CUSTOM_OPENAI_API_KEY` | no | Legacy aliases of `OPENAI_COMPAT_*` |
| `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` / `SERPER_API_KEY` | no | Built-in web search |
| `SEARXNG_URL` / `SEARXNG_API_KEY` | no | SearXNG search |
| `BOTANICAL_MCP_CONFIG` | no | MCP JSON inside the server container (`/config/mcp.json`) |
| `BOTANICAL_STT_PROVIDER` / `BOTANICAL_STT_BASE_URL` / `BOTANICAL_STT_API_KEY` / `BOTANICAL_STT_MODEL` | no | Composer dictation. See [Dictation](#dictation) |

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

### Subscription CLIs (opt-in)

The default Compose file does not install coding-agent CLIs. To run Grok Build, Claude Code, or Codex as a model profile from Docker Desktop on Windows, macOS, or Linux:

```sh
# .env
BOTANICAL_CLI_PROFILES=grok-build

docker compose -f docker-compose.yml -f docker-compose.cli.yml up --build -d
```

Open http://localhost:3000 → Settings → Coding CLIs. Install, then log in, then pick the profile in a chat. `BOTANICAL_CLI_PROFILES` accepts `grok-build`, `claude-code`, and `codex` (comma-separated). A full `BOTANICAL_PROFILES` entry can set `kind`, `cli`, `label`, `model`, `bin`, and `timeoutMs`. `model` is forwarded only when present. CLI profiles are never the default model. They stay on `GET /api/profiles` when the binary is missing or login cannot be confirmed, with `available: false` and `unavailableReason`.

The override mounts two named volumes: `cli_bin` at `/opt/botanical-cli` (binaries) and `cli_home` at `/home/botanical` (`HOME` and `BOTANICAL_CLI_HOME`). The entrypoint creates those directories and gives them to the `botanical` user. On startup the server installs each enabled CLI in the background. `BOTANICAL_CLI_AUTO_INSTALL=0` skips that. Install and Update remain on the settings page. Optional pins: `BOTANICAL_GROK_VERSION`, `BOTANICAL_CLAUDE_VERSION`, `BOTANICAL_CODEX_VERSION`. Unset means the latest stable at install time.

Terminal fallback, from the repo directory:

```sh
docker compose exec -u botanical server grok login --device-auth
docker compose exec -u botanical server codex login --device-auth
docker compose exec -it -u botanical server claude setup-token
```

`claude setup-token` prints a long-lived token and does not save it. Paste the token into Settings → Coding CLIs. It is stored in the CLI home and is not returned to the browser.

These CLIs run inside the agent's workspace (`/data/agents/<agent id>`) with their own tools. Each turn also gets Botanical's tools and your MCP tools through a per-run MCP endpoint on `127.0.0.1` inside the API container (MCP server name `botanical`), with the same role and permission checks as API-model turns. Set `BOTANICAL_INTERNAL_URL` only if the API is not reachable on its own port at `127.0.0.1`. Set `"botanicalTools": false` on a profile to turn this off.

A Linux host can still bind-mount a binary instead of using the installer. That path is a commented example in `docker-compose.cli.yml`. It is not required, and it does not work for a Docker Desktop VM that cannot see your host path. Prefer the named volumes. Treat the server's CLI login as its own login; a refresh of a copied `auth.json` can log the desktop CLI out.

## Dictation

The composer microphone turns speech into text in the message box. It does not send the message.

`BOTANICAL_STT_PROVIDER` selects the speech backend. The API key stays on the server. When the provider is unset, a `BOTANICAL_STT_BASE_URL` uses the OpenAI-compatible adapter at that URL (model `whisper-1`, key optional). Otherwise `OPENAI_API_KEY` calls `https://api.openai.com/v1` with model `gpt-4o-mini-transcribe`. With neither, dictation uses the browser.

| Provider | Value | Endpoint | Default model | Key |
|----------|-------|----------|---------------|-----|
| OpenAI-compatible (OpenAI, Groq, local Whisper) | `openai-compat` | `<base>/audio/transcriptions` | `gpt-4o-mini-transcribe` on `https://api.openai.com/v1`; `whisper-1` on any other base | `BOTANICAL_STT_API_KEY`, then `OPENAI_API_KEY` only when the base URL is unset |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1/audio/transcriptions` | `openai/whisper-large-v3` | `BOTANICAL_STT_API_KEY`, then `OPENROUTER_API_KEY` |
| xAI | `xai` | `https://api.x.ai/v1/stt` | `grok-voice-transcribe-2.0` | `BOTANICAL_STT_API_KEY`, then `XAI_API_KEY` |
| Qwen (DashScope, OpenAI-compatible) | `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen3-asr-flash` | `BOTANICAL_STT_API_KEY`, then `DASHSCOPE_API_KEY` |

`BOTANICAL_STT_BASE_URL` overrides the endpoint origin for every provider. The xAI model is sent on each request; the default above is used when `BOTANICAL_STT_MODEL` is unset. xAI speech-to-text requires an xAI API key (paid API usage), not a Grok consumer subscription login.

Qwen accepts the audio as a data URL. That encoded value must be at most 10 MB; a larger recording is rejected before the upstream call. Region and workspace bases are set with `BOTANICAL_STT_BASE_URL`, for example `https://dashscope.aliyuncs.com/compatible-mode/v1` or `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`.

Providers differ in accepted formats. Browsers usually record WebM/Opus. The OpenAI-compatible adapter forwards the file as uploaded. OpenRouter accepts webm, ogg, mp3, wav, and m4a. xAI documents wav, mp3, ogg, opus, flac, aac, mp4, m4a, and mkv. WebM is not on that list; it is a Matroska subset and is sent with a `.webm` filename and `audio/webm` type, but if xAI rejects browser recordings, use another provider for browsers that only record WebM.

Examples:

```sh
# OpenAI
BOTANICAL_STT_PROVIDER=openai-compat
BOTANICAL_STT_API_KEY=
BOTANICAL_STT_MODEL=gpt-4o-mini-transcribe

# Groq
BOTANICAL_STT_PROVIDER=openai-compat
BOTANICAL_STT_BASE_URL=https://api.groq.com/openai/v1
BOTANICAL_STT_API_KEY=
BOTANICAL_STT_MODEL=whisper-large-v3-turbo

# Local Whisper-compatible server (key optional)
BOTANICAL_STT_PROVIDER=openai-compat
BOTANICAL_STT_BASE_URL=http://whisper:8000/v1
BOTANICAL_STT_MODEL=whisper-1

# OpenRouter
BOTANICAL_STT_PROVIDER=openrouter
OPENROUTER_API_KEY=
BOTANICAL_STT_MODEL=openai/whisper-large-v3

# xAI
BOTANICAL_STT_PROVIDER=xai
XAI_API_KEY=
BOTANICAL_STT_MODEL=grok-voice-transcribe-2.0

# Qwen
BOTANICAL_STT_PROVIDER=qwen
DASHSCOPE_API_KEY=
BOTANICAL_STT_MODEL=qwen3-asr-flash
```

`BOTANICAL_STT_DISABLED=true` turns the server endpoint off. `BOTANICAL_STT_API_KEY_FILE` can point at a file when the key is not in the environment. A non-empty `BOTANICAL_STT_API_KEY` wins. An empty file is an error. An explicit `openrouter`, `xai`, or `qwen` provider with no resolvable key uses the browser instead of refusing to start. The same is true for explicit `openai-compat` when no base URL and no OpenAI key are set.

Limits default to 10 MB (`BOTANICAL_STT_MAX_BYTES`, 10000000) and 120 seconds (`BOTANICAL_STT_MAX_SECONDS`). The browser stops recording at the duration limit. Larger uploads are rejected. `GET /api/capabilities` tells the browser whether to upload audio or use its own speech recognition. In server mode the response includes `dictation.provider` (the provider name only), the limits, and `mode: "server"`. It does not include the base URL, the model, or the key. Browser mode omits the provider.

When no speech backend is configured, dictation uses the browser's speech recognition if that browser has it. In that mode the browser vendor processes the audio, not this server. The composer says so while recording.

Browsers only expose the microphone on HTTPS, or on localhost. A plain HTTP site on another host will not be able to record.

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

Named volumes (prefixed with the project name): `botanical-mvp_botanical_pg` and `botanical-mvp_botanical_workspace` (file and shell jail at `/data`). The coding-CLI override adds `botanical-mvp_cli_bin` and `botanical-mvp_cli_home`.

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

SaaS here means **the same artifacts, run as a hosted service**, not a multi-tenant product.

What to set:

- `DEPLOYMENT_MODE=SAAS` (the override file forces this on the server).
- A long passcode that is not the example value.
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
- Sessions are random tokens stored hashed in Postgres, so API replicas that share the database also share sessions. (The login rate limiter is per process.)
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
| Port already in use | Something else is on 3000, 8788, or 5433. Change `WEB_PORT`, `SERVER_PORT`, or `POSTGRES_PORT` |
| Compose attached to the wrong project | The file sets `name: botanical-mvp`. Pass the same name (or none) to `-p` |
| MCP file missing | `BOTANICAL_MCP_CONFIG_FILE` must be a file. A missing path makes Docker create a directory and the entrypoint exits |
| Empty standalone image | `packages/web` must `next build` with `output: "standalone"`. The web Dockerfile fails if `server.js` is not emitted |
| Old database password | Postgres applies `POSTGRES_PASSWORD` only on first init. Existing volume: `docker compose exec postgres psql -U botanical -d botanical -c "ALTER USER botanical PASSWORD '...'"` and update `DATABASE_URL` |
