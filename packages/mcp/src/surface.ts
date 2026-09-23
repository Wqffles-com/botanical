import { errorResult, parseToolArguments, textResult } from "./format.js";
import { parseToolName } from "./names.js";
import type { McpToolSource } from "./runtime.js";
import type {
  AgentToolResult,
  BuiltinTool,
  ExposedTool,
  ToolDefinition,
  ToolExecContext,
} from "./types.js";

const BUILTIN_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const EMPTY_PARAMETERS = { type: "object", properties: {} };

export interface ToolPolicy {
  toolsEnabled: boolean;
  mcpEnabled: boolean;
  warnings: string[];
}

/** Decide whether this profile may see built-ins and MCP tools. */
export function resolveToolPolicy(input: {
  modelSupportsTools: boolean;
  mcpRequested?: boolean;
}): ToolPolicy {
  if (!input.modelSupportsTools) {
    return {
      toolsEnabled: false,
      mcpEnabled: false,
      warnings: [
        "Profile model does not support tools; built-in tools and MCP are disabled for this turn.",
      ],
    };
  }
  const mcpEnabled = input.mcpRequested !== false;
  return { toolsEnabled: true, mcpEnabled, warnings: [] };
}

export interface AgentToolSurface {
  definitions(): ToolDefinition[];
  catalog(): ExposedTool[];
  warnings(): string[];
  execute(name: string, args: unknown, ctx?: ToolExecContext): Promise<AgentToolResult>;
}

export interface AgentToolSurfaceOptions {
  builtins?: BuiltinTool[];
  mcp?: McpToolSource | null;
  /** False when the selected profile's model cannot call tools. */
  modelSupportsTools: boolean;
  /** False hides MCP tools while leaving built-ins available. Default true. */
  mcpEnabled?: boolean;
  /**
   * Advertise `mcp__server__tool` instead of `mcp.server.tool`.
   * Providers such as OpenAI and Anthropic reject `.` in tool names.
   * `execute` accepts both forms. Default true.
   */
  providerSafeNames?: boolean;
}

/**
 * One tool list for the agent loop: built-ins plus namespaced MCP tools.
 * The runtime passes `definitions()` into the provider and routes tool calls
 * back through `execute()`.
 */
export function createAgentToolSurface(options: AgentToolSurfaceOptions): AgentToolSurface {
  const policy = resolveToolPolicy({
    modelSupportsTools: options.modelSupportsTools,
    mcpRequested: options.mcpEnabled,
  });
  const providerSafeNames = options.providerSafeNames !== false;
  const builtins = validateBuiltins(options.builtins ?? []);
  const mcp = options.mcp ?? null;

  const catalog = (): ExposedTool[] => {
    if (!policy.toolsEnabled) return [];
    const exposed: ExposedTool[] = builtins.map((tool) => ({
      source: "builtin",
      definition: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? EMPTY_PARAMETERS,
      },
    }));
    if (policy.mcpEnabled && mcp) {
      for (const tool of mcp.tools()) {
        const name = providerSafeNames ? tool.providerName : tool.canonicalName;
        exposed.push({
          source: "mcp",
          serverId: tool.serverId,
          canonicalName: tool.canonicalName,
          providerName: tool.providerName,
          definition: {
            name,
            description: tool.description,
            parameters: tool.parameters,
          },
        });
      }
    }
    assertUnique(exposed);
    return exposed;
  };

  return {
    definitions() {
      return catalog().map((tool) => tool.definition);
    },
    catalog,
    warnings() {
      const warnings = [...policy.warnings];
      if (policy.mcpEnabled && mcp) warnings.push(...mcp.warnings());
      return warnings;
    },
    async execute(name, args, ctx) {
      if (!policy.toolsEnabled) {
        return errorResult("Tools are disabled because this model profile does not support tool use.");
      }
      const parsedArgs = parseToolArguments(args);
      if (!parsedArgs.ok) return errorResult(parsedArgs.error);

      const mcpName = parseToolName(name);
      if (mcpName) {
        if (!policy.mcpEnabled || !mcp) {
          return errorResult(`MCP tool "${name}" is not available for this turn.`);
        }
        const decision = await approve(ctx, {
          name,
          source: "mcp",
          serverId: mcpName.serverId,
          arguments: parsedArgs.value,
        });
        if (decision !== true) return errorResult(decision);
        return mcp.call(name, parsedArgs.value, ctx);
      }

      const builtin = builtins.find((tool) => tool.name === name);
      if (!builtin) return errorResult(`Unknown tool "${name}".`);
      const decision = await approve(ctx, {
        name,
        source: "builtin",
        arguments: parsedArgs.value,
      });
      if (decision !== true) return errorResult(decision);
      try {
        const result = await builtin.execute(parsedArgs.value, ctx ?? {});
        return typeof result === "string" ? textResult(result) : result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Tool ${name} failed: ${message}`);
      }
    },
  };
}

function validateBuiltins(builtins: BuiltinTool[]): BuiltinTool[] {
  const seen = new Set<string>();
  for (const tool of builtins) {
    if (!BUILTIN_NAME.test(tool.name)) {
      throw new Error(`Built-in tool name "${tool.name}" must match ${BUILTIN_NAME}.`);
    }
    if (tool.name.startsWith("mcp.") || tool.name.startsWith("mcp__") || tool.name === "mcp") {
      throw new Error(`Built-in tool "${tool.name}" uses the reserved MCP prefix.`);
    }
    if (seen.has(tool.name)) throw new Error(`Duplicate built-in tool "${tool.name}".`);
    seen.add(tool.name);
  }
  return builtins;
}

function assertUnique(tools: ExposedTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.definition.name)) {
      throw new Error(`Tool name collision: "${tool.definition.name}".`);
    }
    seen.add(tool.definition.name);
  }
}

async function approve(
  ctx: ToolExecContext | undefined,
  request: Parameters<NonNullable<ToolExecContext["approve"]>>[0],
): Promise<true | string> {
  if (!ctx?.approve) return true;
  try {
    const allowed = await ctx.approve(request);
    return allowed ? true : `Tool call denied by policy: ${request.name}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Tool approval failed: ${message}`;
  }
}
