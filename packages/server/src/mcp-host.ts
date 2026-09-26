import { consoleLogger, McpRuntime, type McpToolInfo, type StartMcpOptions } from "@botanical/mcp";
import {
  createToolRegistry,
  toOpenAIFunctionTool,
  type JsonSchema,
  type JsonSchemaObject,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
} from "@botanical/tools";

export interface McpServerToolView {
  /** Registry id: `mcp:<server>:<tool>`. */
  id: string;
  /** Remote tool name. */
  name: string;
  /** Model-facing id (`mcp__<server>__<tool>`). Providers reject `:` in tool names. */
  providerName: string;
  description: string;
  source: "mcp";
}

export interface McpServerView {
  id: string;
  transport: "stdio" | "http" | "sse";
  state: "ready" | "error" | "closed" | "disabled";
  toolCount: number;
  tools: McpServerToolView[];
  serverName?: string;
  serverVersion?: string;
  error?: string;
}

export interface McpServersResponse {
  disabled: boolean;
  source: "disabled" | "env" | "file" | "empty" | "error";
  configPath?: string;
  /** Set when the config file or env JSON could not be loaded. The API still starts. */
  configError?: string;
  servers: McpServerView[];
}

/** Connected MCP catalog plus the tools registry those servers registered. */
export interface ServerMcp {
  registry: ToolRegistry;
  snapshot(): McpServersResponse;
  close(): Promise<void>;
}

/**
 * Load `BOTANICAL_MCP_CONFIG` (or the inline env override), connect every
 * server, and register ready tools. A bad config or a dead server does not
 * throw: the snapshot carries the error and the other servers still register.
 */
export async function startServerMcp(options: StartMcpOptions = {}): Promise<ServerMcp> {
  const logger = options.logger ?? consoleLogger;
  try {
    const runtime = await McpRuntime.start({ ...options, logger });
    try {
      return hostFromRuntime(runtime);
    } catch (error) {
      await runtime.close();
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("MCP configuration failed; continuing without MCP tools", { error: message });
    return failedHost(message);
  }
}

export function emptyServerMcp(): ServerMcp {
  return {
    registry: createToolRegistry([]),
    snapshot: () => ({ disabled: false, source: "empty", servers: [] }),
    close: async () => {},
  };
}

function hostFromRuntime(runtime: McpRuntime): ServerMcp {
  return {
    registry: createMcpToolRegistry(runtime),
    snapshot: () => snapshotOf(runtime),
    close: () => runtime.close(),
  };
}

/**
 * Registry ids are `mcp:<server>:<tool>`. `execute` also accepts the dotted
 * architectural id and the provider-safe `mcp__<server>__<tool>` form.
 * `toOpenAITools` advertises the provider-safe name because OpenAI and
 * Anthropic reject `:`.
 */
function createMcpToolRegistry(runtime: McpRuntime): ToolRegistry {
  const paired = runtime.tools().map((tool) => ({
    tool,
    definition: toDefinition(runtime, tool),
  }));
  const inner = createToolRegistry(paired.map((item) => item.definition));
  const aliases = new Map<string, string>();
  for (const { tool } of paired) {
    aliases.set(tool.registryName, tool.registryName);
    aliases.set(tool.canonicalName, tool.registryName);
    aliases.set(tool.providerName, tool.registryName);
  }
  const resolve = (name: string): string => aliases.get(name) ?? name;
  return {
    list: () => inner.list(),
    get: (name) => inner.get(resolve(name)),
    toOpenAITools: () =>
      paired.map(({ tool, definition }) => toOpenAIFunctionTool({ ...definition, name: tool.providerName })),
    execute: (name, params, ctx) => inner.execute(resolve(name), params, ctx),
  };
}

function failedHost(message: string): ServerMcp {
  return {
    registry: createToolRegistry([]),
    snapshot: () => ({
      disabled: false,
      source: "error",
      configError: publicError(message),
      servers: [],
    }),
    close: async () => {},
  };
}

function snapshotOf(runtime: McpRuntime): McpServersResponse {
  const status = runtime.status();
  const toolsByServer = new Map<string, McpServerToolView[]>();
  for (const tool of runtime.tools()) {
    const list = toolsByServer.get(tool.serverId) ?? [];
    list.push({
      id: tool.registryName,
      name: tool.toolName,
      providerName: tool.providerName,
      description: tool.description.slice(0, 2000),
      source: "mcp",
    });
    toolsByServer.set(tool.serverId, list);
  }
  return {
    disabled: status.disabled,
    source: status.source,
    ...(status.configPath ? { configPath: status.configPath } : {}),
    servers: status.servers.map((server) => ({
      id: server.id,
      transport: server.transport,
      state: server.state,
      toolCount: server.toolCount,
      tools: toolsByServer.get(server.id) ?? [],
      ...(server.serverName ? { serverName: server.serverName } : {}),
      ...(server.serverVersion ? { serverVersion: server.serverVersion } : {}),
      ...(server.error ? { error: publicError(server.error) } : {}),
    })),
  };
}

function toDefinition(runtime: McpRuntime, tool: McpToolInfo): ToolDefinition {
  const name = tool.registryName;
  return {
    name,
    description: tool.description.slice(0, 2000),
    parameters: asParameters(tool.parameters),
    // The operator opted in by configuring the server. Allowlists still decide
    // which agents may call it.
    risk: "execute",
    requiresApproval: false,
    async execute(params, ctx): Promise<ToolResult> {
      if (ctx?.signal?.aborted) {
        return {
          ok: false,
          content: "operation aborted",
          error: { code: "aborted", message: "operation aborted" },
        };
      }
      const result = await runtime.call(name, params, signalContext(ctx));
      if (result.ok) {
        return {
          ok: true,
          content: result.content,
          ...(result.structured !== undefined ? { data: result.structured } : {}),
        };
      }
      return {
        ok: false,
        content: result.content,
        error: { code: "tool_failed", message: result.content },
        ...(result.structured !== undefined ? { data: result.structured } : {}),
      };
    },
  };
}

function signalContext(ctx: ToolContext | undefined): { signal?: AbortSignal } {
  return ctx?.signal ? { signal: ctx.signal } : {};
}

function asParameters(schema: Record<string, unknown>): JsonSchemaObject {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const parameters: JsonSchemaObject = {
    type: "object",
    properties: properties as Readonly<Record<string, JsonSchema>>,
  };
  if (Array.isArray(schema.required)) {
    const required = schema.required.filter((item): item is string => typeof item === "string");
    if (required.length > 0) parameters.required = required;
  }
  if (schema.additionalProperties === false || schema.additionalProperties === true) {
    parameters.additionalProperties = schema.additionalProperties;
  }
  return parameters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:api[_-]?key|token|password|secret)=)[^&\s]+/gi, "$1[redacted]");
}
