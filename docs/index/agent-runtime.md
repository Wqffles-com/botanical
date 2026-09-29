# Agent runtime

[Index](README.md)

The agent loop: prompt assembly, provider call, tool dispatch, permissions, and agent-to-agent inbox text. No HTTP server and no vendor SDK.

- Package: `@botanical/agent-runtime`
- Entry: `packages/agent-runtime/src/index.ts`
- Test helpers: `packages/agent-runtime/src/testing.ts` (export `./testing`)

## Files

| Path | Purpose |
|------|---------|
| `packages/agent-runtime/src/loop.ts` | `prepareTurn`, `runAgentTurn`, `dispatchToolCall` |
| `packages/agent-runtime/src/context.ts` | `trimToBudget` drops older turns to `maxContext` |
| `packages/agent-runtime/src/prompt.ts` | `buildSystemPrompt` |
| `packages/agent-runtime/src/tools.ts` | Collect tools, allowlist, MCP name parse |
| `packages/agent-runtime/src/registry.ts` | `createToolRegistry`, contributor adapters |
| `packages/agent-runtime/src/permissions.ts` | Capabilities, role grants, `toolAccess` |
| `packages/agent-runtime/src/profiles.ts` | `ProfileResolver` passed in by the server |
| `packages/agent-runtime/src/provider.ts` | Chat/event types the loop expects. `TurnSteering` and `LiveInput` for messages sent mid-turn |
| `packages/agent-runtime/src/bus.ts` | `createAgentMessageBus` |
| `packages/agent-runtime/src/inbox.ts` | Claim and render inbox mail into a turn |
| `packages/agent-runtime/src/worker.ts` | `DeliveryWorker` |
| `packages/agent-runtime/src/a2a.ts` | Message status and `sendAgentMessageSchema` |
| `packages/agent-runtime/src/memories.ts` | Select memories for the prompt |
| `packages/agent-runtime/src/memory.ts` | In-runtime `createMemoryStore` |
| `packages/agent-runtime/src/store.ts` | Repository interfaces the server adapts |
| `packages/agent-runtime/src/binding.ts` | One owning agent per chat plus group members (`chatParticipants`). A turn's `agentId` must be one of them |
| `packages/agent-runtime/src/agent.ts` | Agent record schemas |
| `packages/agent-runtime/src/chat.ts` | Chat schemas |
| `packages/agent-runtime/src/message.ts` | Message schemas |
| `packages/agent-runtime/src/events.ts` | `RuntimeEvent` |
| `packages/agent-runtime/src/errors.ts` | `ProfileRequiredError`, `BotanicalError`, and siblings |
| `packages/agent-runtime/src/runtime-tools.ts` | `createRuntimeToolSource` |
| `packages/agent-runtime/test` | `bun test` |

The server enters the loop from `packages/server/src/runtime/turn.ts`.

## Exports

`runAgentTurn`, `prepareTurn`, `dispatchToolCall`, `buildSystemPrompt`, `createToolRegistry`, `contributorFromBuiltins`, `createAgentMessageBus`, `DeliveryWorker`, `effectivePermissions`, `toolAccess`, `CAPABILITIES`, `BUILTIN_ROLES`, `createMemoryStore`, `claimInbox`, `renderInbox`. Capability ids in `packages/agent-runtime/src/permissions.ts`: `file.read`, `file.write`, `shell`, `code_exec`, `web`, `memory.read`, `memory.write`, `agent.create`, `agent.message`, `notify`. `notify_user` maps to `notify`. The tool itself is `packages/server/src/tools/notify.ts`.

## Env vars

None. Timeouts and credentials are supplied by the server and tool packages.

## Tests

`packages/agent-runtime/test`. Script: `bun test` in that package (`typecheck` is `tsc -p tsconfig.json --noEmit`).

## Where to change X

- **Change a turn (steps, tool round trip, transcript).** `packages/agent-runtime/src/loop.ts`.
- **Change how a group chat reads to an agent.** `toProviderMessages` in `packages/agent-runtime/src/loop.ts` turns other agents' replies into `[Name] …` user messages and drops their tool rows. `buildSystemPrompt` in `packages/agent-runtime/src/prompt.ts` names the other participants.
- **Change mid-turn steering.** `runAgentTurn` in `packages/agent-runtime/src/loop.ts` takes `steering` messages before each model step and emits a `steer` event. It passes them to the provider as `ChatRequest.input` for live input.
- **Change who may call a tool.** `packages/agent-runtime/src/permissions.ts` and the allowlist check in `packages/agent-runtime/src/tools.ts`.
- **Add a builtin the loop can call.** Implement a `ToolContributor` (`packages/agent-runtime/src/registry.ts`) and register it from `packages/server` (see [server](server.md)).
- **Change inbox injection.** `packages/agent-runtime/src/inbox.ts` and `packages/agent-runtime/src/prompt.ts`.
