# @botanical/tools

Built-in tools for Botanical. This package is the v0 **file** slice plus the shared tool interface other built-ins (web search/fetch, shell, MCP) should implement.

Runtime for v0 is **Bun**. Source is TypeScript and is imported directly (`exports` points at `src/index.ts`). The file tools themselves use Node `fs` APIs so a Bun server can load them without a build step.

```bash
cd packages/tools
bun install
bun test
bun run typecheck
```

## Tool interface (v1)

`TOOL_INTERFACE_VERSION` is `1`. A built-in tool is a `ToolDefinition`:

| Field | Meaning |
| --- | --- |
| `name` | Stable id, `^[a-z][a-z0-9_]{0,63}$`. File tools use `file_read`, `file_write`, `file_list`, `file_delete`. |
| `description` | Shown to the model. |
| `parameters` | JSON Schema object. Same role as an OpenAI function `parameters` object and an MCP `inputSchema`. |
| `risk` | `read`, `write`, `destructive`, `network`, or `execute`. |
| `requiresApproval` | Hint for the agent runtime. The runtime should ask before running the tool. |
| `execute(params, ctx)` | Returns a `ToolResult`. It does not throw. `params` may be an object or a JSON object string. |

`ToolResult` is `{ ok, content, data?, error? }`. `content` is text for the model. `error.code` is a stable string (`ToolErrorCode`).

`createToolRegistry(tools)` lists tools, converts them with `toOpenAIFunctionTool`, and dispatches `execute`. Register each family from its own factory and concatenate:

```ts
createToolRegistry([
  ...createFileTools({ workspaceRoot }),
  // ...createWebTools(), ...createShellTools(), ...mcpTools
]);
```

`ToolContext.workspaceRoot` overrides the root captured when the tools were constructed. A self-hosted server can bind one directory. A hosted deployment can pass a different directory per tenant. Tools do not assume a single global user.

There is **no implicit jail** to `process.cwd()`. If neither the factory nor the call provides a root (and `BOTANICAL_WORKSPACE_ROOT` / `BOTANICAL_WORKSPACE` were unset when `createFileTools()` ran), file tools fail with `invalid_workspace`.

## File tools

| Tool | Risk | Approval | What it does |
| --- | --- | --- | --- |
| `file_read` | read | no | UTF-8 text file. Optional `offset` (1-based line) and `limit`. |
| `file_write` | write | yes | `mode`: `overwrite` (default), `append`, or `create`. `createDirectories` defaults to true. |
| `file_list` | read | no | Directory listing. `path` defaults to `.`. `recursive` does not follow symlinks. |
| `file_delete` | destructive | yes | `confirm` must be boolean `true`. Non-empty directories need `recursive: true`. |

### Jail

Every path is resolved inside the workspace root from `realpath`:

- Relative paths are walked component by component. `..` is applied **after** symlink resolution, so normalizing the string first cannot hide a link that steps outside.
- Absolute paths are accepted only when they already sit under the root. A sibling such as `/data/ws-evil` is not inside `/data/ws`.
- Each component must stay inside the root. A path may not leave and re-enter.
- Symlinks are followed only when the target stays inside the root. Targets outside are rejected (`symlink_escape` or `path_escape`).
- Final opens use `O_NOFOLLOW`, so a last-component symlink swap fails closed.
- `file_delete` does **not** follow the final symlink. It unlinks the link. A symlink to a directory outside the workspace is not descended into.
- The workspace root itself cannot be deleted.
- Delete counts the tree first and deletes nothing when the count would exceed `maxDeleteEntries`.
- Listings omit the target path of a symlink that leaves the workspace.
- Null bytes are rejected. Binary files (NUL byte or invalid UTF-8) are refused by `file_read`.

### Limits

| Option | Default |
| --- | --- |
| `maxReadBytes` | 1 MiB returned to the model. Larger files must be read with `offset` / `limit`. |
| `maxFileBytes` | 8 MiB. Larger files are refused entirely. |
| `maxWriteBytes` | 1 MiB. |
| `maxListEntries` | 500. |
| `maxDeleteEntries` | 1000. |

### Limits that are still real

Intermediate directories can change between the jail check and the syscall (classic TOCTOU). `O_NOFOLLOW` covers the final component of a read or write. Delete unlinks or `rmdir`s the checked path and does not follow symlinks. This is the v0 personal-server bar, not a container.

`file_write` and `file_delete` set `requiresApproval`. This package does not prompt a person; the agent runtime has to honor the flag. Delete still refuses to run unless `confirm` is `true`.

Overwrite writes a temp file in the same directory and renames it into place. A crashed write can leave a `*.botanical-tmp` file next to the target.
