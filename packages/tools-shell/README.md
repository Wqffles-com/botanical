# @botanical/tools

Built-in tools for the Botanical agent server. This package currently implements the v0 **shell** and **code_exec** tools. Web search/fetch and file tools use the same `ToolDefinition` contract and register under the names in `BUILTIN_TOOL_NAMES`.

Runtime: **Bun**. The jail itself is Linux-only (user, mount, and pid namespaces).

## Tool contract

Every built-in implements:

| Field | Role |
| --- | --- |
| `name` | Stable snake_case id sent to the model |
| `description` | What the model sees |
| `parameters` | JSON Schema object (`additionalProperties: false`) |
| `approval` | `"allow"`, `"ask"`, or `"deny"` — a hint for the server |
| `execute(args, ctx)` | Runs the tool. Returns `{ ok, content, data?, truncated?, error? }` |

`execute` does **not** prompt the user. Shell and code exec set `approval: "ask"`. The server must gate the call before `execute`.

`ToolResult.content` is the text to send back to the model. `data.operatorDiagnostic` is for operators and can mention host paths; do not forward it to the model.

```ts
import { createShellTools, toModelTool } from "@botanical/tools";

const tools = createShellTools({
  network: false,          // default
  maxTimeoutMs: 120_000,
  // shellAllowlist: ["git", "ls", "cat"],
});

const modelTools = tools.map(toModelTool);
const shell = tools.find((tool) => tool.name === "shell")!;
const result = await shell.execute(
  { command: "pwd" },
  { workspaceRoot: "/var/lib/botanical/workspaces/demo" },
);
```

`ctx.workspaceRoot` is the host directory the call is confined to. `ctx.signal` aborts the process group.

## Tools

### `shell`

| Argument | Required | Meaning |
| --- | --- | --- |
| `command` | yes | String passed to `/bin/sh -c`, unless an allowlist is set |
| `cwd` | no | Directory inside the workspace |
| `timeout_ms` | no | Wall clock. Default 30s, hard max 120s unless the operator raises it |
| `stdin` | no | Written to the process, then closed |

With `shellAllowlist` (or `BOTANICAL_SHELL_ALLOWLIST=echo,git`), the tool does not start a shell. It execs one allowlisted basename and rejects pipes, redirects, and other shell metacharacters.

### `code_exec`

| Argument | Required | Meaning |
| --- | --- | --- |
| `language` | yes | `javascript`, `typescript`, or `python` |
| `code` | yes | Source. Mounted read-only at `/botanical/prog.*` |
| `cwd`, `timeout_ms`, `stdin` | no | Same as `shell` |

JavaScript and TypeScript run on Bun. Python runs as `python3 -I -B` (isolated, no bytecode).

## Operator configuration

| Option / env | Default | Effect |
| --- | --- | --- |
| `network` / `BOTANICAL_SHELL_NETWORK` | **off** | `1`/`true` shares the host network. Off uses `unshare --net` |
| `maxTimeoutMs` / `BOTANICAL_SHELL_MAX_TIMEOUT_MS` | 120000 | Ceiling for `timeout_ms` |
| `defaultTimeoutMs` / `BOTANICAL_SHELL_DEFAULT_TIMEOUT_MS` | 30000 | Used when the model omits `timeout_ms` |
| `maxOutputBytes` / `BOTANICAL_SHELL_MAX_OUTPUT_BYTES` | 65536 | Combined stdout + stderr before the process is killed |
| `shellAllowlist` / `BOTANICAL_SHELL_ALLOWLIST` | unset (full shell) | Comma-separated basenames |
| `extraEnv` | none | Extra variables merged after scrubbing. `PATH`, `HOME`, `LD_*`, `NODE_OPTIONS`, and similar keys are rejected |

Explicit options win over environment variables. The model cannot change any of these.

## Develop

```bash
cd packages/tools
bun install
bun test
bun run typecheck
```

Read [SECURITY.md](./SECURITY.md) before exposing these tools to a model.
