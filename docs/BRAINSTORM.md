# Botanical — Structured Brainstorm

First-cut product thinking for a non-vendor-locked Grok Bot. Opinionated enough to steer; open questions left for Charlie.

---

## 1. Core product ideas

### 1.1 The wedge
**“Grok Bot, but the model is yours.”**  
Ship an agent experience people recognize (chat + tools + routines + eventual computer use), with the brain behind a **Provider** interface. Primary story: OpenAI-compatible endpoints everywhere; first-class adapters where APIs diverge.

### 1.2 Model profiles (not raw model IDs in UX)
Users think in jobs, not model strings:

| Profile example   | Intent                         | Example binding                          |
|-------------------|--------------------------------|------------------------------------------|
| `fast`            | Low latency, cheap             | DeepSeek / GPT-mini / OpenRouter flash   |
| `reason`          | Hard problems, coding          | Claude / GPT / Grok reasoning            |
| `grok`            | Personality / realtime flavor  | xAI Grok                                 |
| `local`           | Offline / private              | Custom OpenAI-compat base URL            |
| `router`          | Auto / catalog                 | OpenRouter with fallbacks                |

Profiles declare: provider, model id, context window, tool support, vision, max output, cost tier, and feature flags (`supports_parallel_tools`, `supports_computer_use`, etc.).

### 1.3 Multi-provider routing
- **Manual**: user or skill picks a profile per turn / per routine step
- **Policy**: “use `fast` unless confidence low → escalate to `reason`”
- **Failover**: primary provider errors → OpenRouter or secondary key
- **Cost caps**: daily budget per profile; soft-block expensive models

### 1.4 Agent loop, not just chat
Minimal durable loop:

1. Ingest user message (+ attachments later)
2. Select profile / allow override
3. Build messages + tool defs from MCP / built-ins
4. Call provider adapter (stream)
5. Execute tool calls; append results; loop until stop
6. Persist thread + usage metrics

### 1.5 Routines / skills
Portable Markdown or YAML “skills” (prompt + allowed tools + preferred profile + optional schedule). Same skill file works across providers. Think: morning brief, inbox triage, repo digest — without baking OpenAI into the skill.

### 1.6 Connectors via MCP
MCP as the primary extension surface for third-party tools (GitHub, Notion, Calendar, Slack, docs, etc.). Botanical hosts an MCP client; users add servers. Avoid reinventing a proprietary plugin marketplace on day one.

### 1.7 Local / desktop agent computer (parity goal)
Grok Bot–class products increasingly assume a **computer**: shell, browser, files. Botanical should plan for a **boxed local runtime** (sandbox + approval UX) as a milestone *after* multi-provider chat+tools work. Do not block MVP on full computer use.

---

## 2. UX sketch

### Phase A — CLI (MVP)
```text
botanical chat
botanical chat --profile reason
botanical providers test
botanical profiles list
botanical mcp list
```
- Streaming TTY output
- `/profile reason` mid-session
- Clear errors when a model lacks tools / vision

### Phase B — Desktop / web shell
- Thread sidebar, profile picker, usage meter
- Approval prompts for destructive tools
- Settings: BYOK keys, base URLs, MCP servers

### Phase C — Always-on agent
- Routines on a schedule
- Notifications
- Optional headless daemon with strict allowlists

**UX principle:** profile switching is a first-class control, as visible as the model name in ChatGPT/Claude — but owned by the user.

---

## 3. Architecture options (decision lean)

| Option | Description | Lean |
|--------|-------------|------|
| **A. Monolith TS runtime** | One Node/TS package: CLI + adapters + MCP client | **Prefer for MVP** — fast iterate, one language for agent loop |
| **B. Rust/Go core + TS UI** | High-perf core later | Defer until perf/sandbox needs are real |
| **C. Pure proxy** | Only an OpenAI-compat proxy in front of many backends | Too thin — misses agent/tools/skills story |
| **D. Fork existing open agent** | Start from Open WebUI / Continue / etc. | Possible later; brainstorm assumes clean slate to keep vendor-lock escape hatch explicit |

**Recommendation:** TypeScript monorepo (`packages/core`, `packages/adapters`, `packages/cli`, later `apps/desktop`). Adapters implement a shared `LLMProvider` interface; Anthropic gets a real adapter, not a fake OpenAI shim that breaks tools.

---

## 4. Provider abstraction

```ts
interface LLMProvider {
  id: string;
  complete(req: ChatRequest): AsyncIterable<ChatEvent>;
  // ChatRequest: messages, tools, temperature, maxTokens, ...
  // ChatEvent: text-delta | tool-call | usage | error | done
  capabilities(): ModelCapabilities;
}
```

### Adapter matrix (target)

| Provider   | Strategy |
|------------|----------|
| OpenAI     | Official SDK or raw HTTP; Chat Completions + optional Responses |
| Anthropic  | Official Messages API adapter; map tools ↔ Botanical tool schema |
| xAI Grok   | OpenAI-compat where stable; native quirks documented |
| DeepSeek   | OpenAI-compat base URL |
| OpenRouter | OpenAI-compat + provider routing headers / fallbacks |
| Custom     | `baseURL` + `apiKey` + optional path prefix |

**Hard rule:** product code talks to `LLMProvider`, never to `openai` / `@anthropic-ai/sdk` directly outside `packages/adapters`.

---

## 5. Differentiators vs vendor-locked assistants

| Locked assistant | Botanical |
|------------------|-----------|
| One brain vendor | Many + custom base URL |
| Tools tied to their cloud | MCP + local tools |
| Skills trapped in their format | Portable skill files |
| Leave platform → lose agent | Export threads / skills / config |
| Computer use = their VM | Your machine / your box (with approvals) |
| Pricing shock = hostage | Fail over or switch profile |

**Not a differentiator (don’t overclaim):** being smarter than frontier models. Botanical’s edge is **control + portability + multi-brain agent ops**.

---

## 6. Privacy & escape hatch

- BYOK; keys in OS keychain / `.env` (gitignored) / optional secret manager
- Local profile pointing at Ollama, vLLM, LM Studio, etc. (OpenAI-compat)
- No requirement that conversation history leave the user’s machine for MVP (optional sync later)
- Document what each provider receives (prompts, tool payloads, files)

---

## 7. MVP definition (smallest useful product)

**MVP = “Multi-provider streaming agent CLI with one shared tool path.”**

Must include:
1. Config file (YAML/JSON/TOML) for providers + profiles + API keys via env
2. Adapters: OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, custom base URL
3. Streaming chat in terminal
4. ≥2 built-in tools (e.g. `fetch_url`, `run_shell` with allowlist) **or** one MCP client that can call a local server
5. Mid-session `/profile` switch
6. Smoke tests that hit each adapter’s “list models / hello world” path (mocked CI + optional live)

Explicitly **out of MVP:** desktop app, computer-use sandbox, scheduled routines, multi-user cloud hosting, memory embeddings.

---

## 8. Follow-on milestones

### Milestone 2 — Skills + MCP-first
- Skill pack format + loader
- MCP server config UX
- Thread persistence (SQLite)
- Usage / cost accounting per profile

### Milestone 3 — Desktop shell + approvals
- Lightweight desktop or local web UI
- Tool approval policies (always / ask / never)
- Attachment / image input where profiles allow

### Milestone 4 — Agent computer (parity)
- Sandboxed shell + browser tools
- File workspace isolation
- Clear mapping of which profiles support long computer-use loops

---

## 9. Risks

- **Anthropic ↔ OpenAI tool schema drift** — highest adapter risk; invest tests early
- **OpenRouter as crutch** — great for catalog; don’t skip first-class adapters
- **Scope creep into “another ChatGPT clone”** — keep wedge = portability
- **Unsafe shell tools** — approvals and allowlists before marketing “computer”
- **Brand confusion with AstroLink** — keep repos and naming cleanly separate

---

## 10. Open questions for Charlie

1. **Primary surface for v1:** CLI-only, local web, or Electron/Tauri desktop?
2. **Default stack:** confirm TypeScript monorepo, or preference for Python agent runtime?
3. **Computer use:** sandbox on host vs remote “box” VM (Botanical-owned vs user-owned)?
4. **Memory:** none in MVP (good), or lightweight local notes / embeddings soon after?
5. **Hosting:** strictly self-hosted, or eventual optional cloud sync under Wqffles-com?
6. **Personality:** should “Botanical” have a default voice, or be neutral with Grok-like optional system prompts?
7. **Open source posture:** MIT + public from day one (current), or delay code until MVP runs?
8. **Name clash / trademark:** any conflict on “Botanical” worth checking before marketing?
9. **Relationship to Grok Bot:** inspiration only, or intentional feature parity checklist?
10. **Billing:** forever BYOK, or later Botanical-managed keys / subscriptions?

---

## 11. Immediate next engineering steps (after this doc)

1. Scaffold TS monorepo + `LLMProvider` interface
2. Implement OpenAI-compat adapter (covers DeepSeek, OpenRouter, custom, likely xAI)
3. Implement Anthropic adapter
4. CLI `chat` with streaming + profile switch
5. One MCP client integration
6. README quickstart with `.env.example`

Until then, this repo is **docs-first greenfield**.
