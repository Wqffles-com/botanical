# Tools

[Index](README.md)

Three packages. The server registers them from `packages/server/src/tools/catalog.ts`.

| Directory | Package | Entry | Tools |
|-----------|---------|-------|--------|
| `packages/tools` | `@botanical/tools` | `packages/tools/src/index.ts` | `file_read`, `file_write`, `file_list`, `file_delete` |
| `packages/tools-shell` | `@botanical/tools-shell` | `packages/tools-shell/src/index.ts` | `shell`, `code_exec` |
| `packages/tools-web` | `@botanical/tools-web` | `packages/tools-web/src/index.ts` (also `./web`) | `web_search`, `web_fetch` |

`packages/tools-shell` and `packages/tools-web` depend on `@botanical/tools`.

## `@botanical/tools`

Shared tool types, path jail, and file tools.

| Path | Purpose |
|------|---------|
| `packages/tools/src/types.ts` | `ToolDefinition`, `ToolRegistry` |
| `packages/tools/src/registry.ts` | `defineTool`, `createToolRegistry` |
| `packages/tools/src/path-jail.ts` | `resolveInsideWorkspace` |
| `packages/tools/src/workspace.ts` | `ensureAgentWorkspace`, workspace root |
| `packages/tools/src/files` | read / write / list / delete |
| `packages/tools/src/contributor.ts` | `createToolContributor` for the server registry |
| `packages/tools/src/limits.ts` | Output and timeout caps |
| `packages/tools/test` | `bun test` |

Exports include `createFileTools`, `FILE_TOOL_NAMES`, `createToolContributor`, `assertInsideWorkspace`, `ToolError`.

Env (`packages/tools/src/workspace.ts`, `packages/tools/src/files/config.ts`): `BOTANICAL_WORKSPACE`, `BOTANICAL_WORKSPACE_ROOT`. Contributor timeouts (`packages/tools/src/contributor.ts`): `BOTANICAL_FILE_TOOL_TIMEOUT_MS`, `BOTANICAL_TOOL_MAX_OUTPUT_CHARS`.

## `@botanical/tools-shell`

Linux user-namespace jail. Limits are described in `packages/tools-shell/SECURITY.md`.

| Path | Purpose |
|------|---------|
| `packages/tools-shell/src/shell/tools.ts` | `createShellTool`, `createCodeExecTool` |
| `packages/tools-shell/src/shell/options.ts` | Timeouts, allowlist, network flag |
| `packages/tools-shell/src/sandbox/run.ts` | `unshare` runner |
| `packages/tools-shell/src/sandbox/env.ts` | Env scrub for the child |
| `packages/tools-shell/src/contributor.ts` | `createToolContributor` |
| `packages/tools-shell/test` | `bun test` (needs user namespaces; CI enables them) |

Exports: `createShellTools`, `createShellTool`, `createCodeExecTool`, `checkShellSandbox`, `SHELL_TOOL_NAMES`.

Env: `BOTANICAL_SHELL_ALLOWLIST`, `BOTANICAL_SHELL_MAX_TIMEOUT_MS`, `BOTANICAL_SHELL_DEFAULT_TIMEOUT_MS`, `BOTANICAL_SHELL_MAX_OUTPUT_BYTES`, `BOTANICAL_SHELL_NETWORK` in `packages/tools-shell/src/shell/options.ts`. `BOTANICAL_SHELL_TOOL_TIMEOUT_MS` and `BOTANICAL_TOOL_MAX_OUTPUT_CHARS` in `packages/tools-shell/src/contributor.ts`. The sandbox writes `BOTANICAL_JAIL_ROOT`, `BOTANICAL_WORKSPACE_HOST`, `BOTANICAL_JAIL_CWD`, `BOTANICAL_SCRATCH_HOST` onto the child in `packages/tools-shell/src/sandbox/run.ts`.

`packages/tools-shell/package.json` has a `build` script (`bun build` to `dist`). Tests and the server import `src` directly.

## `@botanical/tools-web`

| Path | Purpose |
|------|---------|
| `packages/tools-web/src/web/config.ts` | `WEB_TOOL_ENV`, `loadWebToolConfig` |
| `packages/tools-web/src/web/search-tool.ts` | `web_search` |
| `packages/tools-web/src/web/fetch-tool.ts` | `web_fetch` |
| `packages/tools-web/src/web/providers/search.ts` | Search backends |
| `packages/tools-web/src/net/ssrf.ts` | Blocks non-public hosts |
| `packages/tools-web/src/html-to-markdown.ts` | Fetch extraction |
| `packages/tools-web/src/contributor.ts` | `createToolContributor` |
| `packages/tools-web/test` | `bun test` |

Exports: `webSearchTool`, `webFetchTool`, `builtinWebTools`, `loadWebToolConfig`, `createToolContributor`.

Env names are the values in `WEB_TOOL_ENV` (`packages/tools-web/src/web/config.ts`): `BOTANICAL_SEARCH_PROVIDER`, `BRAVE_SEARCH_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY`, `BOTANICAL_WEB_FETCH_TIMEOUT_MS`, `BOTANICAL_WEB_FETCH_MAX_BYTES`, `BOTANICAL_WEB_FETCH_MAX_CHARS`, `BOTANICAL_WEB_SEARCH_TIMEOUT_MS`, `BOTANICAL_WEB_USER_AGENT`, `BOTANICAL_WEB_ALLOW_PRIVATE_URLS`. Contributor: `BOTANICAL_WEB_TOOL_TIMEOUT_MS`, `BOTANICAL_TOOL_MAX_OUTPUT_CHARS`.

Search order when `BOTANICAL_SEARCH_PROVIDER` is unset: Brave, Tavily, Serper, SearXNG, otherwise a stub.

## Tests

Each package: `bun test` (script `test`). Root `bun run test` includes them. Shell tests can skip or fail when unprivileged user namespaces are blocked.

## Where to change X

- **Add a file tool.** New module under `packages/tools/src/files`, add it in `packages/tools/src/files/index.ts` (`FILE_TOOL_NAMES`, `createFileTools`). The server picks it up via `createFileToolsContributor` in `packages/server/src/tools/catalog.ts`.
- **Add a shell or web tool.** Implement it beside the existing tools, return it from `createShellTools` or `builtinWebTools`, and keep `createToolContributor` listing it.
- **Add a tool that is not one of these packages.** Register a `ToolContributor` in `packages/server/src/app.ts` (pattern: `packages/server/src/tools/memory.ts`, `packages/server/src/tools/agent-admin.ts`). Names today: `memory_write`, `memory_search`, `memory_list`, `memory_delete`, `agent_create`, `agent_list`, `send_agent_message`.
- **Change the jail.** `packages/tools-shell/src/sandbox` and `packages/tools-shell/SECURITY.md`.
- **Add a search backend.** `packages/tools-web/src/web/providers/search.ts` and `packages/tools-web/src/web/config.ts`.
