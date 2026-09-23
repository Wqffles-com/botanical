# @botanical/core

Agent runtime shared by the Botanical server: user-defined agents, the one-agent-per-chat rule, the model/tool loop, and the async agent-to-agent bus.

Persistence and HTTP live in `@botanical/server`. Model adapters implement `LLMProvider` (see `docs/ARCHITECTURE.md`). Built-ins and MCP servers are passed in as `ToolSource`s.

## Rules this package enforces

- An agent is a prompt, a description, and a tool allowlist. An empty allowlist exposes no built-ins and no MCP tools.
- `agent_send` / `agent_inbox` are runtime tools. They follow `a2aEnabled` (default true), not the allowlist. The sender is always the agent that owns the chat.
- A chat is bound to one agent at creation. `assertChatAgentBinding` rejects a different agent. There is no API to change `agentId`.
- Every turn requires `profileId`. Nothing in this package picks a model for the caller.
- Allowlist patterns are exact names or a trailing `*` prefix (`mcp.fs.*`, `*`).
- A2A `send` only inserts a `pending` row. `DeliveryWorker` (or the recipient's next turn) marks it `delivered`. The following turn copies delivered mail into that chat and marks it `read`. The recipient model is not run inline.

## Tool loop

`runAgentTurn` yields `RuntimeEvent`s: `inbox`, `step`, `text-delta`, `tool-call`, `tool-result`, `usage`, `a2a-sent`, `error`, `done`. Provider `done` events are not forwarded; the runtime emits one `done` after the step's tool calls finish.

Register tools in this order: runtime A2A source, built-in source, MCP source. `createMcpToolSource` namespaces tools as `mcp.<server>.<tool>`.
