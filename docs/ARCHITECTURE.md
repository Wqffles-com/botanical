# Botanical: architecture

This doc describes the system design, following the decisions in [DECISIONS.md](./DECISIONS.md). Botanical is an always-on **server**, either self-hosted or run as the hosted service from the same codebase. The **web** UI is the first client, state lives in **Postgres**, and everything is TypeScript on **Bun**. Some sections describe target behavior. Items that are not built yet are marked, and [ROADMAP.md](./ROADMAP.md) tracks them.

---

## 1. System overview

```
                    ┌──────────────────────────────────────────┐
                    │              Clients                     │
                    │  Web UI (v0) · CLI/mobile (later)        │
                    └──────────────────┬───────────────────────┘
                                       │  password / passcode
                    ┌──────────────────▼───────────────────────┐
                    │         Botanical server                 │
                    │  self-host or hosted SaaS (same code)    │
                    │  sessions · agents · agent loop ·        │
                    │  profiles · MCP · A2A · routines · usage │
                    └────────────┬─────────────┬───────────────┘
                                 │             │
              ┌──────────────────▼──┐   ┌──────▼────────────────┐
              │  Tool / MCP layer   │   │  Provider adapters    │
              │  built-ins · MCP    │   │  OpenAI · Anthropic   │
              │  approvals · audit  │   │  xAI · DeepSeek       │
              └─────────────────────┘   │  OpenRouter · Custom  │
                                        └──────────┬────────────┘
                                                   │
                                        ┌──────────▼────────────┐
                                        │  External LLM APIs /  │
                                        │  OpenAI-compat hosts  │
                                        └───────────────────────┘

Server secrets ──▶ env / secret store (API keys never from web client)
Postgres ────────▶ chats, agents, messages, A2A, routines, listeners, notifications
```

**Invariant:** orchestration and tools never import a vendor SDK directly. Only `packages/providers/*` talk to OpenAI, Anthropic, xAI, etc.

**Invariant:** model API keys are **server-side only**.

**Invariant:** self-host and hosted SaaS are deployment modes of this same server. Core paths must run without SaaS billing, a hosted account system, or a specific domain.

---

## 2. Packages

```
botanical/
  packages/
    server/         # HTTP API: auth, agents, chats, streaming turns, A2A, routines, listeners, memory, roles
    agent-runtime/  # agent loop, tool dispatch, permission checks
    providers/      # streaming model adapters (OpenAI-compat, Anthropic, xAI, DeepSeek, OpenRouter, CLI)
    tools/          # file tools (per-agent workspace jail)
    tools-shell/    # shell + code_exec (Linux namespace jail)
    tools-web/      # web_search + web_fetch
    mcp/            # MCP client
    db/             # Postgres schema (Drizzle) + migrations
    core/           # shared types + web client for the API
    web/            # Next.js App Router + shadcn/ui client
    e2e/            # Playwright suite
  docker-compose.yml
  docs/
```

Language: **TypeScript**. Runtime: **Bun**. Persistence: **Postgres**. A later CLI would be another client against the same API, not a second runtime.

Deployment: **same codebase**, two modes — **self-host** and **hosted SaaS** — selected by config, not a fork. Do not hard-code SaaS-only assumptions (billing, hosted accounts, a specific domain) into the core. Hosting vendor stays **portable / host-agnostic**.

---

## 3. Client layer

| Client | Role | When |
|--------|------|------|
| Web UI | Chat, agent picker, mandatory profile pick, settings, A2A activity, routines, listeners, notifications | **v0** |
| CLI | Thin client against server API | Later |
| Mobile | Notifications, quick replies | Later |

Clients are thin: authenticate, send user turns, render `ChatEvent` streams. Business logic lives in `core` / `server`.

### Auth (v0)

- Web → server: **password / passcode**
- Enough for a single-operator self-host, and for a single-operator hosted deploy
- Hosted SaaS needs **multi-tenant auth** later. Keep the auth boundary replaceable; do not build tenancy or billing in v0

---

## 4. Orchestration core

Responsibilities (some are planned; see [ROADMAP.md](./ROADMAP.md)):
- Load **config** (providers, profiles, MCP servers) — keys from server env
- Maintain **session** state (messages, tool results, active profile, owning agent)
- Run the **agent loop** (model ↔ tools until completion or max steps)
- Manage **agents** (unlimited user-defined: prompt/description + tool set)
- Deliver **async agent-to-agent messages** (teammate-style)
- Apply **policies** (cost caps, tool allowlists, approval gates)
- Record **usage** (tokens, estimated cost, provider latency)
- Require **explicit profile** — no silent default model

### Agent UX rules (locked)

- **One agent per chat** — thread owned by one chosen agent
- User may define unlimited agents
- Agents may message each other asynchronously without merging chats

### Agent loop (pseudocode)

```
while step < maxSteps:
  events = provider.complete(messages, tools for agent + profile)
  append assistant content / tool_calls
  if no tool_calls: break
  for each tool_call:
    if needs_approval: wait / deny
    result = tools.execute(tool_call)
    append tool result message
  # A2A sends are tool-or-runtime side effects; land in recipient inboxes async
```

Profile can change between steps if the user requests a switch or a policy escalates — still never “ambient default.”

---

## 5. Tool / MCP layer

### Built-ins (core)

- **Web search / fetch** — search + HTTP fetch with size limits
- **Shell / code exec** — Linux namespace jail; gated by allowlists and roles (UI approval prompts are planned)
- **File read / write** — workspace-scoped paths only
- **Memory and agent admin (MVP2)** — `memory_*`, `agent_create`, `agent_list`. With roles, a tool runs only when the allowlist matches and the role union permits its capability. Agents with no roles stay allowlist-only. See [DECISIONS.md](./DECISIONS.md).

### Opt-in (not core)

- Browser / computer use and similar — **configurable**, not shipped as required core

### MCP

- Botanical server acts as an **MCP client**
- User configures stdio or SSE/HTTP MCP servers in server config
- Tool namespaced as `mcp.<server>.<tool>` to avoid collisions
- Capability negotiation: if a profile’s model is weak at tools, warn or disable MCP for that profile

### Approvals (planned)

- Policy levels: `allow` | `ask` | `deny` per tool or pattern
- Web: modal / inline prompt; later CLI/daemon policies as needed

### Audit (planned)

- Append-only log of tool calls (args redacted for secrets) for debugging and trust

---

## 6. Provider adapters

### Shared contract

```ts
type Role = "system" | "user" | "assistant" | "tool";

interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error }
  | { type: "done" };

interface ModelCapabilities {
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  maxContext: number;
  streaming: boolean;
}

interface LLMProvider {
  readonly id: string;
  complete(req: ChatRequest): AsyncIterable<ChatEvent>;
  capabilities(model: string): ModelCapabilities;
}
```

### Adapter notes

| Adapter | Implementation notes |
|---------|----------------------|
| `openai` | Chat Completions streaming; optional Responses API path later |
| `anthropic` | Map Botanical tools ↔ Anthropic tool use; system prompt as top-level `system` |
| `xai` | Prefer OpenAI-compat base URL; document deviations |
| `deepseek` | OpenAI-compat; reasoning models may need special handling for “think” channels |
| `openrouter` | OpenAI-compat + `HTTP-Referer` / `X-Title` + optional provider routing |
| `openai-compat` | Generic: `baseURL`, `apiKey`, `defaultHeaders` — covers local and unknown hosts |
| `cli` | Subscription coding CLIs (`grok`, `claude`, `codex`) spawned headless in the agent's workspace. They keep their own tools and also reach Botanical's tools and the operator's MCP tools through a per-run MCP endpoint on the server, with the same role checks. The prompt goes by file or stdin. Botanical streams stdout back as `text-delta`. |

### Config sketch (server-side)

```yaml
providers:
  openai:
    type: openai
    apiKeyEnv: OPENAI_API_KEY
  anthropic:
    type: anthropic
    apiKeyEnv: ANTHROPIC_API_KEY
  xai:
    type: openai-compat
    baseURL: https://api.x.ai/v1
    apiKeyEnv: XAI_API_KEY
  deepseek:
    type: openai-compat
    baseURL: https://api.deepseek.com
    apiKeyEnv: DEEPSEEK_API_KEY
  openrouter:
    type: openrouter
    apiKeyEnv: OPENROUTER_API_KEY
  local:
    type: openai-compat
    baseURL: http://127.0.0.1:11434/v1
    apiKey: ollama

profiles:
  fast:
    provider: deepseek
    model: deepseek-chat
  reason:
    provider: anthropic
    model: claude-sonnet-4-20250514
  grok:
    provider: xai
    model: grok-4
  router:
    provider: openrouter
    model: openrouter/auto

# No defaultProfile — UI must require an explicit pick
```

(Exact model IDs will drift — keep them in config, not hardcoded in core.)

---

## 7. Config & secrets

- **Config:** server config file and/or env (providers, profiles, MCP, auth passcode, deployment mode: self-host or hosted)
- **Secrets:** environment variables / host secret store on the **server**
- Web client never receives or submits model API keys
- **Never** commit `.env` or key files (see root `.gitignore`)
- `.env.example` names `DATABASE_URL`, `BOTANICAL_PASSCODE`, provider `*_API_KEY`s, and `DEPLOYMENT_MODE` (`self_host` or `saas`). See [DEPLOY.md](./DEPLOY.md).

---

## 8. Deployment model

Same server, two modes. Not local-first: the runtime is always a server that clients connect to.

| Mode | Description | v0 |
|------|-------------|-----|
| **Self-host** | Operator runs Botanical (Docker / bare metal / any VPS). MIT OSS core. | **Supported** |
| **Hosted SaaS** | The same codebase run as a hosted service. Subscription billing is planned. | **Same code**; billing deferred |
| **Portable host** | No hard dependency on one cloud vendor inside the core | **Required** |
| **Remote sandbox** | Optional remote sandbox for heavier computer use | Later / opt-in |
| Local / laptop | `bun run dev` or Compose on a workstation | Development only |

Botanical is designed to run always on, so agents can keep working while no client is connected. Agent-to-agent autorun, scheduled routines, and generic webhook listeners run inside the server process. Typed forge listeners are still planned.

Mode is configuration (a deployment-mode setting plus env), not a compile-time fork. Core features — chat, tools, MCP, agents, Postgres — behave the same in both modes. SaaS-only concerns (tenant identity, subscription state) stay off the v0 core path so a self-host operator is not blocked on them.

Routines and generic webhook listeners run in this process. Multi-tenant auth for hosted SaaS is still planned; leave a seam at the auth boundary.

Reference deploy is Docker Compose ([DEPLOY.md](./DEPLOY.md)): Postgres, server, and web from one codebase. `DEPLOYMENT_MODE=SELF_HOST` is a server you run. `DEPLOYMENT_MODE=SAAS` is the same images run as the hosted service. Multi-tenant accounts and billing stay deferred; v0 does not assume a SaaS-only runtime.

### Always-on turns

Background work uses the same turn as an interactive chat message: system prompt, memory injection, the agent's tool allowlist, role checks at dispatch, operator MCP servers, and CLI profiles with their per-run Botanical MCP endpoint. User, assistant, and tool messages are stored the same way, so the chat renders normally. Two turns never run in one chat at the same time. Background turns are also capped per process (instance setting `always_on.background_concurrency`, default 2).

**Routines.** A row stores a 5-field cron expression, an IANA timezone, and a required profile id. The scheduler ticks inside the server process. The interval is the instance setting `always_on.scheduler_interval_ms` (default 15s) and applies on the next tick. `always_on.scheduler_enabled` (default true) skips claiming while it is false. `createApp({ scheduler: false })` keeps the interval from starting, which tests use. A tick claims due rows in one transaction: `SELECT … FOR UPDATE SKIP LOCKED`, compute the next future slot in code, advance `next_run_at`, and insert a `routine_runs` row. Schedule runs are unique on `(routine_id, scheduled_for)`, so the same slot cannot fire twice across processes or restarts. If the server was down, one catch-up run is kept and the schedule jumps to the next future slot. The process that executes a run holds a lease (`lease_owner`, `lease_expires_at`, about two minutes, renewed about every 30 seconds). Each tick reaps runs whose lease has expired, and queued runs that were never picked up and are older than that window, with `interrupted: server stopped` plus a failure notification. A live lease is left alone, so a second process does not fail a turn that is still running. Accepted webhook deliveries use the same lease. Each run opens a **new chat** owned by the routine's agent. Listener chat titles include an explicit UTC label.

**Listeners.** `POST /api/hooks/:id` is outside the passcode. It checks an HMAC (`X-Botanical-Signature` or `X-Hub-Signature-256`, `sha256=<hex>`) or a bearer/token header, with a constant-time compare. Unknown ids and bad signatures share one 401. The body is capped while it is read (`always_on.listener_max_bytes`, default 65536). An accepted delivery returns 202 and starts a background turn in a new chat. `{{payload}}` is inserted inside `<untrusted_webhook_payload>` with a fixed preamble. The listener secret is stored in full so the HMAC can be recomputed; database access is secret access. List and get never return it. `kind` is text. Only `webhook` is implemented; a later kind adds a verify + buildPrompt handler.

**Ownership.** `routines`, `listeners`, and `notifications` have a required `user_id` (foreign key to `users`, on delete restrict, same as agents and chats). The single operator owns those rows today, and list routes already filter by that user. The column is enforced per user when accounts land, without another migration. `routine_runs` and `listener_deliveries` do not copy `user_id`; they inherit ownership through the parent.

**Tuning.** Those four values live in the `settings` table, not in environment variables. `GET` and `PATCH /api/settings/always-on` are passcode-gated and marked instance-admin, so they become admin-only when accounts land. Absent keys use the defaults. A short cache (about a minute) lets a saved value apply without a restart.

**Notifications.** A row is written when a routine, listener, or A2A autorun turn finishes or fails, and when an agent calls `notify_user` (allowlist plus the `notify` capability when the agent has roles). The web UI polls the list.

The in-memory store implements the same claim, so unit tests do not need Postgres. Postgres is what makes the lease safe across processes.

---

## 9. Data stores (v0)

| Data | Store | Notes |
|------|-------|-------|
| Chats / threads | **Postgres** | One owning agent per chat |
| Agents | **Postgres** | Prompt/description + tool bindings |
| Messages | **Postgres** | User, assistant, tool, system |
| A2A messages | **Postgres** | Async teammate inbox |
| Skills (later) | Filesystem or Postgres | Git-friendly files still useful |
| Config | YAML + env | Operator-edited |
| Usage | Postgres | Aggregations per profile/day |
| Tool audit | Postgres or JSONL | Redact secrets |
| Memories | Postgres | `shared` or per-agent; tags; injected into the system prompt |
| Roles | Postgres | Capability union plus MCP allow list; `agent_roles` join |
| Routines / routine runs | Postgres | Cron schedule plus one row per run. `routines.user_id` is the operator today and the account owner later. Runs inherit the routine. A partial unique index stops a schedule slot from firing twice |
| Listeners / deliveries | Postgres | Generic webhooks. `listeners.user_id` matches routines. Deliveries inherit the listener. The HMAC secret is stored retrievable |
| Notifications | Postgres | Background run results and `notify_user`. `user_id`, indexed with `created_at`, plus an unread partial index |
| Always-on tuning | Postgres `settings` | Instance-admin keys `always_on.scheduler_enabled`, `always_on.scheduler_interval_ms`, `always_on.background_concurrency`, `always_on.listener_max_bytes`. Not per user, and not environment variables |

`agents.created_by_agent_id` is set when `agent_create` persists an agent and stays null for operator-created agents.

---

## 10. Security boundaries

1. Password / passcode gate on the web API  
2. Model keys never exposed to the browser  
3. Workspace path jail for file tools  
4. Shell / code exec behind approvals and allowlists  
5. MCP servers treated as **untrusted code** — operator installs them knowingly  
6. Provider payloads may include tool results — avoid exfiltrating secrets into prompts  
7. Abort signals on all network calls; timeouts on tools  
8. v0 auth is a single shared password / passcode. Tenant isolation is a hosted-SaaS follow-on, not a v0 control  

---

## 11. Testing strategy

- Unit tests for message mapping (especially Anthropic ↔ Botanical)
- Contract tests with recorded HTTP fixtures (VCR-style) per adapter
- Optional live smoke against server (skipped in CI without keys)
- Golden-path e2e: mock provider → tool call → final answer via web API
- A2A: send → persist → deliver to recipient agent inbox

Runnable v0 smoke (health, passcode auth, create agent, create chat, mock provider) is documented in [TESTING.md](./TESTING.md).

---

## 12. Status

- [x] Five named providers + custom base URL for streaming chat, plus CLI profiles
- [x] Web UI auth (passcode) + mandatory profile pick
- [x] Postgres-backed chats, agents, messages, memories, roles
- [x] Built-ins: web search/fetch, shell/code exec, file read/write
- [x] MCP servers callable from the agent loop
- [x] Multi-agent create + one-agent-per-chat + async A2A path
- [x] Routines (cron, lease, new chat per run) and generic webhook listeners
- [x] Notifications for background runs and `notify_user`
- [x] Documented portable deploy (host-agnostic): [DEPLOY.md](./DEPLOY.md)
- [x] Shell jail limits: [packages/tools-shell/SECURITY.md](../packages/tools-shell/SECURITY.md)
- [ ] UI approvals and tool audit log
- [ ] Typed forge listeners, developer mode ([ROADMAP.md](./ROADMAP.md))
