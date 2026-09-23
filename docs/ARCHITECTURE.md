# Botanical — Architecture (First Pass)

Target shape aligned with locked decisions in [DECISIONS.md](./DECISIONS.md). The monorepo scaffold is in place (Bun, `GET /health`, empty packages). Behavior below is still the target, not as-built.

> Earlier drafts leaned local-first CLI + SQLite. That lean is **superseded**: personal hosted **server**, **web** first client, **Postgres**, TypeScript on **Bun**.

---

## 1. System overview

```
                    ┌──────────────────────────────────────────┐
                    │              Clients                     │
                    │  Web UI (v0) · CLI/desktop (later)       │
                    └──────────────────┬───────────────────────┘
                                       │  password / passcode
                    ┌──────────────────▼───────────────────────┐
                    │         Botanical server                 │
                    │  sessions · agents · agent loop ·        │
                    │  profiles · MCP · A2A messaging · usage  │
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
Postgres ────────▶ chats, agents, messages, A2A, usage
```

**Invariant:** orchestration and tools never import a vendor SDK directly. Only `packages/providers/*` talk to OpenAI, Anthropic, xAI, etc.

**Invariant:** model API keys are **server-side only**.

---

## 2. Packages (proposed monorepo)

```
botanical/
  packages/
    core/          # shared types, agent config schemas, agent loop (later)
    providers/     # LLMProvider implementations (was sketched as adapters/)
    tools/         # built-in tools + MCP client bridge
    server/        # HTTP API, auth, orchestration, Postgres access
    web/           # v0 client (Vite + React + TypeScript)
    db/            # Postgres schema + migrations
  docker-compose.yml
  docs/            # decisions, vision, brainstorm, architecture
```

Language: **TypeScript**. Runtime: **Bun**. Persistence: **Postgres**. A later CLI would be another client against the same API, not a second runtime.

Hosting: **portable / host-agnostic** — no hard dependency on one cloud in core.

---

## 3. Client layer

| Client | Role | When |
|--------|------|------|
| Web UI | Chat, agent picker, mandatory profile pick, settings, A2A activity | **v0** |
| CLI | Thin client against server API | Later |
| Desktop | OS integrations, notifications | Later |

Clients are thin: authenticate, send user turns, render `ChatEvent` streams. Business logic lives in `core` / `server`.

### Auth (v0)

- Web → server: **password / passcode**
- Sufficient for personal single-operator deploy; revisit for multi-user later

---

## 4. Orchestration core

Responsibilities:
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

### Built-ins (v0 — locked)

- **Web search / fetch** — search + HTTP fetch with size limits
- **Shell / code exec** — gated; approvals / allowlists
- **File read / write** — workspace-scoped paths only

### Opt-in (not core)

- Browser / computer use and similar — **configurable**, not shipped as required core

### MCP

- Botanical server acts as an **MCP client**
- User configures stdio or SSE/HTTP MCP servers in server config
- Tool namespaced as `mcp.<server>.<tool>` to avoid collisions
- Capability negotiation: if a profile’s model is weak at tools, warn or disable MCP for that profile

### Approvals

- Policy levels: `allow` | `ask` | `deny` per tool or pattern
- Web: modal / inline prompt; later CLI/daemon policies as needed

### Audit

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

- **Config:** server config file and/or env (providers, profiles, MCP, auth passcode)
- **Secrets:** environment variables / host secret store on the **server**
- Web client never receives or submits model API keys
- **Never** commit `.env` or key files (see root `.gitignore`)
- Provide `.env.example` naming all `*_API_KEY` vars + `DATABASE_URL` + auth secret

---

## 8. Deployment model

| Mode | Description | Lean |
|------|-------------|------|
| **Personal hosted server** | Operator runs Botanical server; web clients connect remotely | **v0 locked** |
| **Portable host** | Docker / bare metal / any VPS — host vendor undecided | Keep agnostic |
| **User box sandbox** | Optional remote sandbox for heavier computer use | Later / opt-in |
| ~~Local-first CLI only~~ | Runtime primarily on laptop with SQLite | **SUPERSEDED** |

Always-on routines/schedulers are enabled by this architecture but are **post-v0**.

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

---

## 10. Security boundaries

1. Password / passcode gate on the web API  
2. Model keys never exposed to the browser  
3. Workspace path jail for file tools  
4. Shell / code exec behind approvals and allowlists  
5. MCP servers treated as **untrusted code** — operator installs them knowingly  
6. Provider payloads may include tool results — avoid exfiltrating secrets into prompts  
7. Abort signals on all network calls; timeouts on tools  

---

## 11. Testing strategy

- Unit tests for message mapping (especially Anthropic ↔ Botanical)
- Contract tests with recorded HTTP fixtures (VCR-style) per adapter
- Optional live smoke against server (skipped in CI without keys)
- Golden-path e2e: mock provider → tool call → final answer via web API
- A2A: send → persist → deliver to recipient agent inbox

---

## 12. What “done” looks like for architecture v0

- [ ] `LLMProvider` interface stabilized
- [ ] Five named providers + custom base URL work for streaming chat
- [ ] Web UI auth (passcode) + mandatory profile pick
- [ ] Postgres-backed chats, agents, messages
- [ ] Built-ins: web search/fetch, shell/code exec, file read/write
- [ ] One MCP server callable from the agent loop
- [ ] Multi-agent create + one-agent-per-chat + async A2A path
- [ ] Documented portable deploy (host-agnostic)
- [ ] Documented threat model for tools

When those land, revisit this doc and replace sketches with “as-built” diagrams.
