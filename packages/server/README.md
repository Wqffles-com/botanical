# @botanical/server

HTTP API, Postgres store, MCP client, and process entry for the Botanical agent runtime.

```bash
bun install
bun test
bun run --filter @botanical/server dev
```

Set `DATABASE_URL` for Postgres (schema: `sql/001_runtime.sql`, applied on startup unless `BOTANICAL_AUTO_MIGRATE=0`). Without it, the process keeps state in memory. `BOTANICAL_DEV_PROVIDER=echo` registers a profile named `echo` that the client must still request — there is no default profile.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness. `persistence` is `memory` or `postgres`. |
| GET | `/api/profiles` | Profiles. `defaultProfileId` is always `null`. |
| POST/GET/PATCH/DELETE | `/api/agents` | Prompt, description, `toolAllowlist`, `a2aEnabled`. |
| GET | `/api/agents/:id/inbox` | A2A inbox. `?status=pending,delivered&order=asc`. |
| POST/GET/PATCH | `/api/chats` | Create requires `agentId`. PATCH of `agentId` is **409**. |
| GET | `/api/chats/:id/messages` | Transcript. |
| POST | `/api/chats/:id/messages` | `{ content, profileId, agentId? }` → SSE `RuntimeEvent`s. |
| POST | `/api/a2a/messages` | Enqueue mail (`pending`). Does not run the recipient. |
| POST | `/api/a2a/poll` | Deliver pending rows now. A worker also polls on `A2A_POLL_MS`. |
| GET | `/api/mcp` | Configured MCP servers. |

## Wiring providers and built-ins

`packages/providers` should implement `LLMProvider` from `@botanical/core`. `packages/tools` can be wrapped with `adaptTool`. Expected built-in names are `web_search`, `web_fetch`, `shell`, `file_read`, and `file_write`. MCP config is `examples/mcp.json` (`stdio`, streamable `http`, or legacy `sse`).

```ts
import { createAgentMessageBus, createBuiltinToolSource, createMcpToolSource, createRuntimeToolSource, staticProfileResolver } from "@botanical/core";
import { adaptTool, createPostgresStore, createRuntimeApp } from "@botanical/server";

const { store } = createPostgresStore(process.env.DATABASE_URL!);
const bus = createAgentMessageBus(store.agents, store.agentMessages);
const app = createRuntimeApp({
  store,
  bus,
  persistence: "postgres",
  profiles: staticProfileResolver({
    grok: { provider: grokProvider, model: "grok-4" },
  }),
  toolSources: [
    createRuntimeToolSource(bus),
    createBuiltinToolSource([adaptTool(webSearch), adaptTool(shellTool)]),
    createMcpToolSource(mcpManager),
  ],
});
```

Agent files (`examples/agents.json`) upsert by id via `BOTANICAL_AGENTS_FILE`.

## Schema notes for packages/db

Tables: `agents`, `chats`, `messages`, `agent_messages`. A2A columns are `from_agent`, `to_agent`, `body`, `status` (`pending | delivered | read | failed`). `agents.tools` is the allowlist JSON array. `chats.agent_id` is immutable. `messages.profile_id` records the explicit profile for that turn.
