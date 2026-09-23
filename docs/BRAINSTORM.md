# Botanical — Structured Brainstorm

First-cut product thinking for a non-vendor-locked Grok Bot. Opinionated enough to steer; open questions left for Charlie where still open.

> **Supersession notice (2026-09-23):** Locked decisions in [DECISIONS.md](./DECISIONS.md) **supersede** earlier local-first / CLI-as-MVP leanings in this doc. Sections below that conflict are marked **SUPERSEDED**. Keep useful non-conflicting ideas; prefer clarity over archaeology.

---

## 1. Core product ideas

### 1.1 The wedge
**“Grok Bot, but the model is yours.”**  
Ship an agent experience people recognize (chat + tools + MCP + multi-agent; routines later), with the brain behind a **Provider** interface. Primary story: OpenAI-compatible endpoints everywhere; first-class adapters where APIs diverge. Runtime lives on a **personal hosted server**; first client is **web**.

### 1.2 Model profiles (not raw model IDs in UX)
Users think in jobs, not model strings:

| Profile example   | Intent                         | Example binding                          |
|-------------------|--------------------------------|------------------------------------------|
| `fast`            | Low latency, cheap             | DeepSeek / GPT-mini / OpenRouter flash   |
| `reason`          | Hard problems, coding          | Claude / GPT / Grok reasoning            |
| `grok`            | Personality / realtime flavor  | xAI Grok                                 |
| `local`           | Offline / private brain        | Custom OpenAI-compat base URL on server  |
| `router`          | Auto / catalog                 | OpenRouter with fallbacks                |

Profiles declare: provider, model id, context window, tool support, vision, max output, cost tier, and feature flags (`supports_parallel_tools`, `supports_computer_use`, etc.).

**Locked:** there is **no default profile** — the user must pick explicitly every time (no silent everyday default).

### 1.3 Multi-provider routing
- **Manual**: user or agent picks a profile per turn / per step
- **Policy**: “use `fast` unless confidence low → escalate to `reason`” (later)
- **Failover**: primary provider errors → OpenRouter or secondary key
- **Cost caps**: daily budget per profile; soft-block expensive models

### 1.4 Agent loop, not just chat
Minimal durable loop:

1. Ingest user message (+ attachments later)
2. Require explicit profile / allow override
3. Build messages + tool defs from agent config, built-ins, MCP
4. Call provider adapter (stream)
5. Execute tool calls; append results; loop until stop
6. Persist thread + usage metrics in **Postgres**

### 1.5 Agents (locked multi-agent model)
- **Unlimited** user-defined agents
- Each agent: **functions (tools)** + **description/prompt**
- **One agent per chat** — thread owned by the chosen agent
- **Full async agent-to-agent messaging** (teammate-style), even though the user only talks to one agent per thread

### 1.6 Routines / skills
~~Portable Markdown or YAML “skills” with schedules as MVP.~~  
**v0:** focus on chat + tools + MCP. **Routines / always-on schedulers are post-v0** (locked). Skill-file ideas remain useful later for portable prompts + tool subsets.

### 1.7 Connectors via MCP
MCP as the primary extension surface for third-party tools (GitHub, Notion, Calendar, Slack, docs, etc.). Botanical server hosts an MCP client; users add servers. Avoid reinventing a proprietary plugin marketplace on day one.

### 1.8 Computer use / browser (opt-in, not core)
~~Plan boxed local runtime as near-term parity.~~  
**Locked:** browser / computer use is **opt-in configurable**, not a v0 core built-in. Core built-ins are web search/fetch, shell/code exec, file read/write.

---

## 2. UX sketch

### ~~Phase A — CLI (MVP)~~ — SUPERSEDED (2026-09-23)

Earlier lean was CLI-first (`botanical chat`, TTY streaming). **Not the v0 plan.** CLI may return later as an additional client against the same server.

### Phase A — Web UI + personal server (MVP) — LOCKED

- Authenticate with **password / passcode**
- Pick **agent** + **model profile** (required — no silent default)
- Streaming chat; tool / MCP activity visible
- Thread sidebar; one agent owns each thread
- Surface for async A2A messages (inbox / teammate activity)
- Settings: server-held provider keys, profiles, MCP servers, agent definitions
- Approval prompts for destructive tools (shell, writes)

### Phase B — More clients / polish
- Additional clients (CLI, desktop) against the same server API
- Richer approvals, usage meters, attachment / vision where profiles allow

### Phase C — Always-on agent (post-v0)
- Routines on a schedule
- Notifications
- Headless always-on behavior on the personal server

**UX principle:** profile switching is a first-class control — and profile pick is mandatory, not ambient.

---

## 3. Architecture options (decision lean)

| Option | Description | Lean |
|--------|-------------|------|
| **A. TS server + web app** | TypeScript server (Bun **or** Deno) + web client; Postgres; adapters + MCP | **Locked direction for MVP** |
| **B. Rust/Go core + TS UI** | High-perf core later | Defer until perf/sandbox needs are real |
| **C. Pure proxy** | Only an OpenAI-compat proxy in front of many backends | Too thin — misses agent/tools/MCP story |
| **D. Fork existing open agent** | Start from Open WebUI / Continue / etc. | Possible later; clean slate keeps vendor-lock escape hatch explicit |
| ~~**Local-first CLI monolith**~~ | Node/TS CLI on user machine | **SUPERSEDED** — personal hosted server instead |

**Recommendation:** TypeScript monorepo (`packages/core`, `packages/adapters`, `packages/server`, `apps/web`). Runtime **Bun or Deno** chosen at scaffold. Adapters implement shared `LLMProvider`; Anthropic gets a real adapter, not a fake OpenAI shim.

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
| Tools tied to their cloud | MCP + server-side built-ins |
| Skills trapped in their format | Portable agent defs / future skill files |
| Leave platform → lose agent | You host the server; export Postgres / config |
| Computer use = their VM | Opt-in tools on *your* server |
| Pricing shock = hostage | Fail over or switch profile |

**Not a differentiator (don’t overclaim):** being smarter than frontier models. Botanical’s edge is **control + portability + multi-brain agent ops**.

---

## 6. Privacy, keys & hosting

- Model API keys: **server-side only** (locked) — never entered in the web client
- Web → server auth: **password / passcode** for v0
- Hosting vendor: **undecided** — keep server **portable / host-agnostic**
- Document what each provider receives (prompts, tool payloads, files)
- ~~No requirement that history leave the user’s machine for MVP~~ — **SUPERSEDED framing**: history lives in **Postgres on the personal server** the operator controls

---

## 7. MVP definition (LOCKED 2026-09-23)

**MVP = “Personal Botanical server + web UI: streaming chat, tools, MCP, multi-agent.”**

Must include:
1. TypeScript server (Bun **or** Deno) + web client
2. Password / passcode auth (web → server)
3. Postgres for chats, agents, messages, etc.
4. Adapters: OpenAI, Anthropic, xAI, DeepSeek, OpenRouter, custom base URL
5. Streaming chat in the web UI; **explicit profile pick** (no default)
6. Unlimited user-defined agents (tools + description/prompt); one agent per chat
7. Async agent-to-agent messaging
8. Built-in tools: **web search/fetch**, **shell/code exec**, **file read/write**
9. MCP client on the server
10. Model API keys server-side only; portable / host-agnostic deploy story

Explicitly **out of MVP:** routines / schedulers, teams/multi-tenant SaaS, browser/computer-use as core built-ins, CLI-as-primary-surface, local-first-only architecture.

---

## 8. Follow-on milestones

### Milestone 2 — Skills + richer MCP
- Skill / routine pack format (still post-v0 for *schedulers*)
- MCP server config UX polish
- Usage / cost accounting per profile

### Milestone 3 — Extra clients + approvals polish
- CLI or desktop client against the same server
- Tool approval policies (always / ask / never)
- Attachment / image input where profiles allow

### Milestone 4 — Always-on + opt-in computer use
- Scheduled routines on the personal server
- Opt-in browser / computer-use tools
- Notifications

---

## 9. Risks

- **Anthropic ↔ OpenAI tool schema drift** — highest adapter risk; invest tests early
- **OpenRouter as crutch** — great for catalog; don’t skip first-class adapters
- **Scope creep into “another ChatGPT clone”** — keep wedge = portability
- **Unsafe shell tools** — approvals and allowlists before marketing “computer”
- **Brand confusion with AstroLink** — keep repos and naming cleanly separate
- **A2A complexity** — async messaging must not confuse one-agent-per-chat UX
- **Host portability** — avoid accidental lock-in while hosting is undecided

---

## 10. Open questions for Charlie

Resolved 2026-09-23 (see [DECISIONS.md](./DECISIONS.md)): audience, server vs local-first, web-first client, v0 scope, no default model, passcode auth, TS + Bun/Deno, multi-agent + A2A, built-ins list, server-side keys, Postgres, portable hosting.

Still open / refine later:

1. **Bun vs Deno** — pick at scaffold time
2. **Hosting vendor** — which host first, while staying portable?
3. **Computer use** — when to offer opt-in; sandbox shape on the personal server?
4. **Memory** — beyond Postgres threads; embeddings / notes soon after v0?
5. **Personality** — default Botanical voice vs neutral + optional system prompts?
6. **Open source posture** — MIT + public from day one (current), or delay code until MVP runs?
7. **Name clash / trademark** — any conflict on “Botanical” before marketing?
8. **Relationship to Grok Bot** — inspiration only, or intentional feature parity checklist?
9. **Billing** — forever operator BYOK on server, or later managed keys / subscriptions?

---

## 11. Immediate next engineering steps (after docs)

1. Scaffold TS monorepo; choose **Bun or Deno**
2. Server package + Postgres schema (chats, agents, messages)
3. Web app: auth (passcode), agent picker, mandatory profile picker, streaming chat
4. `LLMProvider` interface + OpenAI-compat adapter (DeepSeek, OpenRouter, custom, likely xAI)
5. Anthropic adapter
6. Built-ins: web search/fetch, shell/code exec, file read/write
7. MCP client integration + A2A messaging skeleton
8. README quickstart (portable deploy notes; server env for API keys)

Until then, this repo is **docs-first greenfield**.
