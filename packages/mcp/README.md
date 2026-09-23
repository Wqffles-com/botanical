# @botanical/mcp

MCP **client** for the Botanical server. It connects to operator-configured MCP servers and puts their tools on the same agent tool surface as the built-ins.

Botanical is the client. MCP servers are untrusted code the operator chose to run.

## Configure

JSON file, or the `BOTANICAL_MCP_SERVERS` environment variable (same JSON). The env var wins when both are set.

Search order when `BOTANICAL_MCP_CONFIG` is unset:

1. `config/mcp.json`
2. `mcp.json`
3. `botanical.mcp.json`

Paths are relative to the server process working directory. An explicit path that is missing fails boot. A missing default file means no MCP servers.

```json
{
  "servers": [
    {
      "id": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    {
      "id": "docs",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_MCP_TOKEN}" }
    }
  ]
}
```

`transport` is `stdio`, `http` (streamable HTTP), or `sse` (legacy HTTP+SSE). `streamable-http` is accepted as an alias of `http`. Set `sseFallback: true` on an `http` server to retry that same URL over SSE.

`${VAR}` placeholders in commands, args, env values, urls, and headers expand from the server environment. `${VAR:-default}` supplies a default. An unset variable with no default fails boot. The error names the variable and does not print other secrets.

| Variable | Role |
|---|---|
| `BOTANICAL_MCP_CONFIG` | Path to the JSON file |
| `BOTANICAL_MCP_SERVERS` | Inline JSON. Overrides the file's server list |
| `BOTANICAL_MCP_DISABLED` | `1` / `true` / `yes` / `on` connects nothing |
| `BOTANICAL_MCP_CONNECT_TIMEOUT_MS` | Initialize timeout (default 15000) |
| `BOTANICAL_MCP_TOOL_TIMEOUT_MS` | Tool call timeout (default 60000) |

stdio children are spawned with **no shell**. They inherit a short safe environment (`PATH`, `HOME`, and similar), plus the server's `env` block. Model API keys in the parent process are not copied.

## Agent runtime

```ts
import { createAgentToolSurface, startMcp, type BuiltinTool } from "@botanical/mcp";

const mcp = await startMcp();

const builtins: BuiltinTool[] = [
  {
    name: "web_search",
    description: "Search the web",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    async execute(args) {
      return `results for ${String(args.query)}`;
    },
  },
];

const tools = createAgentToolSurface({
  builtins,
  mcp,
  modelSupportsTools: profile.capabilities.tools,
});

// ChatRequest.tools
const definitions = tools.definitions();

// One tool call from the model
const result = await tools.execute(toolCall.name, toolCall.arguments, {
  signal,
  approve: async (request) => policy.allow(request),
});

await mcp.close();
```

`definitions()` uses provider-safe names: `mcp__<server>__<tool>`. The architectural id `mcp.<server>.<tool>` is on `catalog()` as `canonicalName`. `execute` accepts either form. OpenAI and Anthropic reject `.` in tool names, so the safe form is what the model should see. Pass `providerSafeNames: false` to advertise the dotted id instead.

When `modelSupportsTools` is false, the surface advertises nothing and `warnings()` explains that tools and MCP are off for that profile.

A server that fails to connect is skipped. The others still contribute tools. `mcp.status()` and `tools.warnings()` report the failure.

`mcp.promptAddendum()` returns server `instructions` from the MCP handshake, for the runtime to append to the system prompt.

## Limits

v0 calls tools. Resources, prompts, OAuth, and sampling are not exposed. Tool results are text for the model; image and audio payloads are not inlined. Result text is capped at 100k characters.
