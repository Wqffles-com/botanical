# MCP

[Index](README.md)

MCP client: load a server list, connect, and expose tools to the agent runtime. The default config connects nothing.

- Package: `@botanical/mcp`
- Entry: `packages/mcp/src/index.ts`

## Files

| Path | Purpose |
|------|---------|
| `packages/mcp/src/config.ts` | `loadMcpConfig` (file, inline JSON, or disabled) |
| `packages/mcp/src/types.ts` | `stdio`, `http`, and `sse` server configs |
| `packages/mcp/src/connection.ts` | `McpConnection` |
| `packages/mcp/src/runtime.ts` | `McpRuntime`, `startMcp` |
| `packages/mcp/src/surface.ts` | Per-agent tool policy |
| `packages/mcp/src/names.ts` | `mcp:<server>:<tool>` and provider-facing names |
| `packages/mcp/src/format.ts` | Tool result text |
| `packages/mcp/src/errors.ts` | `McpConfigError`, `McpServerError` |
| `packages/mcp/mcp.example.json` | Example `mcpServers` document |
| `packages/mcp/test` | `bun test`, including transport fixtures |
| `config/mcp.json` | Repo config copied into the API image (empty `servers`) |
| `config/mcp.example.json` | Example stdio server |

The process that connects servers is `packages/server/src/mcp-host.ts` (`startServerMcp`), called from `packages/server/src/serve.ts`. `GET /api/mcp/servers` returns `snapshot()`.

Accepted JSON shapes (`packages/mcp/src/config.ts`): `{"servers":[...]}`, `{"mcpServers":{...}}`, or a bare array. File lookup order when `BOTANICAL_MCP_CONFIG` is unset: `config/mcp.json`, then `mcp.json`, then `botanical.mcp.json`, relative to the process cwd. `BOTANICAL_MCP_SERVERS` overrides the file.

Transports: `stdio` (`command`, `args`, `env`, `cwd`), `http` (`url`, optional `sseFallback`), `sse` (`url`).

## Exports

`loadMcpConfig`, `startMcp`, `McpRuntime`, `McpConnection`, `createAgentToolSurface`, `canonicalToolName`, `providerToolName`, `registryToolName`.

This package does not export `createToolContributor`. The server's dynamic import of `@botanical/mcp` in `packages/server/src/tools/catalog.ts` therefore skips it. Live MCP tools are attached by `contributorFromServerMcp` in that same file.

## Env vars

Read in `packages/mcp/src/config.ts`:

| Name | Role |
|------|------|
| `BOTANICAL_MCP_DISABLED` | Skip connections |
| `BOTANICAL_MCP_CONFIG` | Config file path |
| `BOTANICAL_MCP_SERVERS` | Inline JSON; wins over the file |
| `BOTANICAL_MCP_CONNECT_TIMEOUT_MS` | Handshake timeout |
| `BOTANICAL_MCP_TOOL_TIMEOUT_MS` | Per-call timeout |

`${VAR}` placeholders inside the JSON are filled from the process env.

## Tests

`packages/mcp/test`. Script: `bun test`. Fixtures: `packages/mcp/test/fixtures/stdio-server.ts`, `packages/mcp/test/fixtures/http-server.ts`, `packages/mcp/test/fixtures/sse-server.ts`.

## Where to change X

- **Add a transport.** Extend `McpTransportKind` and the config union in `packages/mcp/src/types.ts`, parse it in `packages/mcp/src/config.ts`, and connect it in `packages/mcp/src/connection.ts`.
- **Add a server (operator).** Edit `BOTANICAL_MCP_SERVERS` or the file at `BOTANICAL_MCP_CONFIG` (image default is `config/mcp.json`). Do not put secrets in the repo file.
- **Change tool ids.** `packages/mcp/src/names.ts`.
- **Change allow policy.** `packages/mcp/src/surface.ts` and role grants in `packages/agent-runtime/src/permissions.ts`.
