# Botanical — Architecture (First Pass)

Greenfield sketch. Nothing here is implemented yet; this is the target shape for early engineering.

---

## 1. System overview

```
                    ┌──────────────────────────────────────────┐
                    │              Clients                     │
                    │  CLI (MVP) · Local web · Desktop (later) │
                    └──────────────────┬───────────────────────┘
                                       │
                    ┌──────────────────▼───────────────────────┐
                    │           Orchestration core             │
                    │  session · agent loop · profiles ·       │
                    │  skills · policies · usage               │
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
                                        │  local OpenAI-compat  │
                                        └───────────────────────┘

Config / secrets ──▶ core (never committed)
Local store ───────▶ SQLite / files (threads, skills, usage)
```

**Invariant:** orchestration and tools never import a vendor SDK directly. Only `packages/adapters/*` talk to OpenAI, Anthropic, xAI, etc.

---

## 2. Packages (proposed monorepo)

```
botanical/
  packages/
    core/          # agent loop, profiles, sessions, types
    adapters/      # LLMProvider implementations
    tools/         # built-in tools + MCP client bridge
    cli/           # MVP interface
  apps/
    web/           # later: local UI
    desktop/       # later: Tauri/Electron shell
  docs/            # vision, brainstorm, architecture
```

Language lean for MVP: **TypeScript** (Node 20+), shared types, easy streaming, strong ecosystem for MCP.

---

## 3. Client layer

| Client | Role | When |
|--------|------|------|
| CLI | Chat, profile switch, provider smoke tests | MVP |
| Local web | Threads, settings, approvals | Milestone 3 |
| Desktop | OS keychain, notifications, computer-use UX | Milestone 3–4 |
| Headless daemon | Scheduled routines | After skills |

Clients are thin: they send user turns and render `ChatEvent` streams. Business logic lives in `core`.

---

## 4. Orchestration core

Responsibilities:
- Load **config** (providers, profiles, MCP servers)
- Maintain **session** state (messages, tool results, active profile)
- Run the **agent loop** (model ↔ tools until completion or max steps)
- Apply **policies** (cost caps, tool allowlists, approval gates)
- Record **usage** (tokens, estimated cost, provider latency)
- Load **skills/routines** (system prompt fragments + tool subsets + preferred profile)

### Agent loop (pseudocode)

```
while step < maxSteps:
  events = provider.complete(messages, tools for active profile)
  append assistant content / tool_calls
  if no tool_calls: break
  for each tool_call:
    if needs_approval: wait / deny
    result = tools.execute(tool_call)
    append tool result message
```

Profile can change between steps if the user requests `/profile` or a skill policy escalates.

---

## 5. Tool / MCP layer

### Built-ins (MVP candidates)
- `fetch_url` — HTTP GET with size limits
- `fs_read` / `fs_write` — workspace-scoped paths only
- Optional: `shell` behind an allowlist (off by default until approvals exist)

### MCP
- Botanical acts as an **MCP client**
- User configures stdio or SSE/HTTP MCP servers in config
- Tool namespaced as `mcp.<server>.<tool>` to avoid collisions
- Capability negotiation: if a profile’s model is weak at tools, warn or disable MCP for that profile

### Approvals
- Policy levels: `allow` | `ask` | `deny` per tool or pattern
- CLI: interactive prompt; desktop: modal; daemon: deny-by-default unless allowlisted

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

### Config sketch

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
```

(Exact model IDs will drift — keep them in config, not hardcoded in core.)

---

## 7. Config & secrets

- **Config file:** `~/.config/botanical/config.yaml` or project `./botanical.yaml`
- **Secrets:** environment variables preferred; OS keychain later for desktop
- **Never** commit `.env` or key files (see root `.gitignore`)
- Provide `.env.example` naming all `*_API_KEY` vars
- Optional: encrypt-at-rest for local thread DB (milestone 2+)

---

## 8. Local vs cloud

| Mode | Description | Default lean |
|------|-------------|--------------|
| **Local-first** | CLI/desktop runs on user machine; only LLM API calls leave (BYOK) | **MVP default** |
| **User box** | Optional remote sandbox for agent computer (shell/browser) | Milestone 4 |
| **Botanical cloud** | Hosted sync / managed keys | Explicit non-goal until Charlie decides |

Local-first keeps the escape hatch honest: if every provider is down, point `local` at a self-hosted OpenAI-compatible server and keep skills/MCP.

---

## 9. Data stores (early)

| Data | Store | Notes |
|------|-------|-------|
| Threads | SQLite | Portable, single-file |
| Skills | Filesystem (`skills/*.md`) | Git-friendly |
| Config | YAML | User-edited |
| Usage | SQLite | Aggregations per profile/day |
| Tool audit | SQLite or JSONL | Redact secrets |

---

## 10. Security boundaries

1. Workspace path jail for file tools  
2. Shell disabled or allowlisted until approval UX exists  
3. MCP servers treated as **untrusted code** — user installs them knowingly  
4. Provider payloads may include tool results — avoid exfiltrating secrets into prompts  
5. Abort signals on all network calls; timeouts on tools  

---

## 11. Testing strategy

- Unit tests for message mapping (especially Anthropic ↔ Botanical)
- Contract tests with recorded HTTP fixtures (VCR-style) per adapter
- Optional live smoke: `botanical providers test --live` (skipped in CI without keys)
- Golden-path e2e: mock provider → tool call → final answer

---

## 12. What “done” looks like for architecture v0

- [ ] `LLMProvider` interface stabilized
- [ ] Five named providers + custom base URL work for streaming chat
- [ ] One MCP server callable from the agent loop
- [ ] Profile switch mid-session without losing thread
- [ ] Documented threat model for tools

When those land, revisit this doc and replace sketches with “as-built” diagrams.
