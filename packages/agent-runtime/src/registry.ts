import { createMcpToolSource, parseMcpToolName, toolResultToContent, type McpToolBridge, type ToolCallContext, type ToolSource } from "./tools";

/**
 * Plug-in contract for the Botanical tool catalog.
 * Version 1. m08 (built-in tools) and m09 (MCP) code against this file.
 *
 * Export `createToolContributor` from the package entry the server loads:
 * `@botanical/tools-shell`, `@botanical/tools-web`, `@botanical/mcp`.
 * File tools are registered by the server as contributor id `builtin.files`.
 *
 * `RegisteredTool.id` is the agent allowlist id (`file_list`, `mcp.<server>.<tool>`).
 * `source` is `builtin` or `mcp`. MCP rows set `serverId`.
 * `register` replaces a contributor with the same id (MCP reconnect).
 * When two contributors list the same tool id, the earlier one wins.
 * `callTool` returns `{ content, isError: true }` for unknown tools and bad arguments.
 * The agent loop offers a tool only when the agent's allowlist matches its id.
 */
export const TOOL_REGISTRY_VERSION = 1;

export const TOOL_CONTRIBUTOR_EXPORT = "createToolContributor" as const;

export type ToolSourceKind = "builtin" | "mcp";

export interface RegisteredTool {
  /** Allowlist id. Built-ins use the tool name. MCP uses `mcp.<server>.<tool>`. */
  id: string;
  name: string;
  description: string;
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>;
  source: ToolSourceKind;
  /** Set when `source` is `mcp`. */
  serverId?: string;
}

export interface ToolInvocationResult {
  /** Text returned to the model. */
  content: string;
  isError?: boolean;
  data?: unknown;
}

export interface ToolContributor {
  readonly id: string;
  readonly source: ToolSourceKind;
  listTools(): Promise<readonly RegisteredTool[]> | readonly RegisteredTool[];
  callTool(toolId: string, args: unknown, ctx: ToolCallContext): Promise<ToolInvocationResult>;
}

export type ToolContributorFactory = () => ToolContributor | Promise<ToolContributor>;

export interface ToolRegistry {
  /** Insert or replace the contributor with this id. */
  register(contributor: ToolContributor): void;
  unregister(contributorId: string): boolean;
  list(): Promise<RegisteredTool[]>;
  call(toolId: string, args: unknown, ctx: ToolCallContext): Promise<ToolInvocationResult>;
  /**
   * One {@link ToolSource} per contributor, for `runAgentTurn`.
   * `enrich` runs on every call (the server stamps `workspaceRoot` here).
   */
  toToolSources(enrich?: (ctx: ToolCallContext) => ToolCallContext): ToolSource[];
}

const EMPTY_PARAMETERS: Record<string, unknown> = { type: "object", properties: {} };

export function createToolRegistry(initial: readonly ToolContributor[] = []): ToolRegistry {
  const contributors = new Map<string, ToolContributor>();
  for (const contributor of initial) contributors.set(contributor.id, contributor);

  async function owned(): Promise<Array<{ contributor: ToolContributor; tool: RegisteredTool }>> {
    const seen = new Set<string>();
    const rows: Array<{ contributor: ToolContributor; tool: RegisteredTool }> = [];
    for (const contributor of contributors.values()) {
      const tools = await contributor.listTools();
      for (const tool of tools) {
        const id = tool.id.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({
          contributor,
          tool: {
            ...tool,
            id,
            source: contributor.source,
            parameters: tool.parameters ?? EMPTY_PARAMETERS,
          },
        });
      }
    }
    return rows;
  }

  return {
    register(contributor) {
      contributors.set(contributor.id, contributor);
    },
    unregister(contributorId) {
      return contributors.delete(contributorId);
    },
    async list() {
      return (await owned()).map((row) => row.tool);
    },
    async call(toolId, args, ctx) {
      const match = (await owned()).find((row) => row.tool.id === toolId);
      if (!match) return { content: `Unknown tool "${toolId}"`, isError: true };
      return invoke(match.contributor, toolId, args, ctx);
    },
    toToolSources(enrich) {
      return [...contributors.keys()].map((id) => contributorSource(contributors, id, enrich));
    },
  };
}

/**
 * Adapt built-in tools (file, shell, web) into a contributor.
 * `execute` may return `{ content, ok }` or `{ output, isError }` or a string.
 */
export function contributorFromBuiltins(
  tools: readonly BuiltinToolLike[],
  options: { id?: string; source?: ToolSourceKind } = {},
): ToolContributor {
  const id = options.id ?? "builtin";
  const source = options.source ?? "builtin";
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    id,
    source,
    listTools() {
      return tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        parameters: schemaRecord(tool.parameters),
        source,
      }));
    },
    async callTool(toolId, args, ctx) {
      const tool = byName.get(toolId);
      if (!tool) return { content: `Unknown tool "${toolId}"`, isError: true };
      try {
        const raw = await tool.execute(args, callContext(ctx));
        return normalizeInvocation(raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool failed";
        return { content: message, isError: true };
      }
    },
  };
}

export interface BuiltinToolLike {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute(args: unknown, ctx?: BuiltinCallContext): Promise<unknown> | unknown;
}

export interface BuiltinCallContext {
  workspaceRoot?: string;
  signal?: AbortSignal;
  agentId?: string;
  chatId?: string;
  meta?: Readonly<Record<string, string>>;
}

/** MCP tools already behind {@link McpToolBridge} (`mcp.<server>.<tool>` names). */
export function contributorFromMcpBridge(bridge: McpToolBridge, id = "mcp"): ToolContributor {
  const source = createMcpToolSource(bridge);
  return {
    id,
    source: "mcp",
    async listTools() {
      const listed = await source.listTools();
      return listed.map((tool) => {
        const parsed = parseMcpToolName(tool.name);
        const row: RegisteredTool = {
          id: tool.name,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          source: "mcp",
        };
        if (parsed) row.serverId = parsed.serverId;
        return row;
      });
    },
    async callTool(toolId, args, ctx) {
      const result = await source.call(toolId, args, ctx);
      return {
        content: toolResultToContent(result),
        isError: result.isError === true,
        data: result.output,
      };
    },
  };
}

export interface McpCatalogTool {
  /** Allowlist id, usually `mcp.<server>.<tool>`. */
  id: string;
  description: string;
  parameters?: Record<string, unknown>;
  serverId?: string;
  /** Name passed to `McpCatalog.call`. Defaults to `id`. */
  callName?: string;
}

export interface McpCatalog {
  tools(): readonly McpCatalogTool[] | Promise<readonly McpCatalogTool[]>;
  call(
    name: string,
    args: unknown,
    ctx?: ToolCallContext,
  ): Promise<{ content: string; isError?: boolean; data?: unknown }>;
}

export function contributorFromMcpCatalog(catalog: McpCatalog, id = "mcp"): ToolContributor {
  return {
    id,
    source: "mcp",
    async listTools() {
      const tools = await catalog.tools();
      return tools.map((tool) => {
        const row: RegisteredTool = {
          id: tool.id,
          name: tool.id,
          description: tool.description,
          parameters: tool.parameters ?? EMPTY_PARAMETERS,
          source: "mcp",
        };
        if (tool.serverId) row.serverId = tool.serverId;
        return row;
      });
    },
    async callTool(toolId, args, ctx) {
      const tools = await catalog.tools();
      const tool = tools.find((candidate) => candidate.id === toolId);
      if (!tool) return { content: `Unknown tool "${toolId}"`, isError: true };
      try {
        const result = await catalog.call(tool.callName ?? tool.id, args, ctx);
        return {
          content: result.content,
          isError: result.isError === true,
          ...(result.data !== undefined ? { data: result.data } : {}),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "MCP tool failed";
        return { content: message, isError: true };
      }
    },
  };
}

/**
 * Adapt `packages/mcp` `McpRuntime` (or any object with the same `tools()` / `call()`).
 * Tool ids are the runtime's `canonicalName` (`mcp.<server>.<tool>`).
 */
export function contributorFromMcpRuntime(
  runtime: {
    tools(): ReadonlyArray<{
      canonicalName: string;
      description: string;
      parameters: Record<string, unknown>;
      serverId: string;
    }>;
    call(
      name: string,
      args: unknown,
      ctx?: { signal?: AbortSignal },
    ): Promise<{ content: string; isError?: boolean }>;
  },
  id = "mcp",
): ToolContributor {
  return contributorFromMcpCatalog(
    {
      tools() {
        return runtime.tools().map((tool) => ({
          id: tool.canonicalName,
          description: tool.description,
          parameters: tool.parameters,
          serverId: tool.serverId,
        }));
      },
      call(name, args, ctx) {
        return runtime.call(name, args, ctx?.signal ? { signal: ctx.signal } : {});
      },
    },
    id,
  );
}

function contributorSource(
  contributors: ReadonlyMap<string, ToolContributor>,
  id: string,
  enrich?: (ctx: ToolCallContext) => ToolCallContext,
): ToolSource {
  return {
    id,
    async listTools() {
      const contributor = contributors.get(id);
      if (!contributor) return [];
      const tools = await contributor.listTools();
      return tools.map((tool) => ({
        name: tool.id,
        description: tool.description,
        parameters: tool.parameters ?? EMPTY_PARAMETERS,
        origin: contributor.source,
      }));
    },
    async call(name, args, ctx) {
      const contributor = contributors.get(id);
      if (!contributor) return { output: `Tool source "${id}" is not registered`, isError: true };
      const next = enrich ? enrich(ctx) : ctx;
      const result = await invoke(contributor, name, args, next);
      return { output: result.content, isError: result.isError === true };
    },
  };
}

async function invoke(
  contributor: ToolContributor,
  toolId: string,
  args: unknown,
  ctx: ToolCallContext,
): Promise<ToolInvocationResult> {
  try {
    return await contributor.callTool(toolId, args, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    return { content: message, isError: true };
  }
}

function callContext(ctx: ToolCallContext): BuiltinCallContext {
  return {
    ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    agentId: ctx.agentId,
    chatId: ctx.chatId,
    meta: { agentId: ctx.agentId, chatId: ctx.chatId },
  };
}

function schemaRecord(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object") return EMPTY_PARAMETERS;
  return parameters;
}

export function normalizeInvocation(raw: unknown): ToolInvocationResult {
  if (typeof raw === "string") return { content: raw };
  if (!raw || typeof raw !== "object") {
    return { content: raw == null ? "" : JSON.stringify(raw) };
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.content === "string") {
    const isError = record.isError === true || record.ok === false;
    return {
      content: record.content,
      ...(isError ? { isError: true } : {}),
      ...("data" in record ? { data: record.data } : {}),
    };
  }
  if ("output" in record) {
    const output = record.output;
    return {
      content: typeof output === "string" ? output : JSON.stringify(output ?? ""),
      ...(record.isError === true ? { isError: true } : {}),
      data: output,
    };
  }
  return { content: JSON.stringify(record) };
}
