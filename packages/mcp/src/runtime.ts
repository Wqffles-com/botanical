import { McpConnection } from "./connection.js";
import { loadMcpConfig, type LoadMcpConfigOptions, type LoadedMcpConfig } from "./config.js";
import { errorResult, parseToolArguments } from "./format.js";
import { consoleLogger, type McpLogger } from "./logger.js";
import { parseToolName } from "./names.js";
import type {
  AgentToolResult,
  McpRuntimeStatus,
  McpToolInfo,
  ToolDefinition,
  ToolExecContext,
} from "./types.js";

export interface McpToolSource {
  tools(): McpToolInfo[];
  call(name: string, args: unknown, ctx?: ToolExecContext): Promise<AgentToolResult>;
  warnings(): string[];
  status(): McpRuntimeStatus;
}

export interface StartMcpOptions extends LoadMcpConfigOptions {
  logger?: McpLogger;
}

/**
 * Connects every configured MCP server and presents their tools as one catalog.
 * A server that fails to connect is reported on `status()` and does not block the others.
 */
export class McpRuntime implements McpToolSource {
  private constructor(
    private readonly loaded: LoadedMcpConfig,
    private readonly connections: McpConnection[],
  ) {}

  static async start(options: StartMcpOptions = {}): Promise<McpRuntime> {
    const logger = options.logger ?? consoleLogger;
    const loaded = loadMcpConfig({ ...options, logger });
    const connections = loaded.servers.map((server) => new McpConnection(
      server,
      logger,
      loaded.timeouts.connectTimeoutMs,
      loaded.timeouts.toolTimeoutMs,
    ));
    const runtime = new McpRuntime(loaded, connections);
    await Promise.all(connections.map(async (connection) => {
      try {
        await connection.connect();
      } catch {
        // The connection records the error on status() so other servers still start.
      }
    }));
    return runtime;
  }

  tools(): McpToolInfo[] {
    return this.connections.flatMap((connection) => connection.listTools());
  }

  definitions(options: { providerSafeNames?: boolean } = {}): ToolDefinition[] {
    const providerSafe = options.providerSafeNames !== false;
    return this.tools().map((tool) => ({
      name: providerSafe ? tool.providerName : tool.canonicalName,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  warnings(): string[] {
    const warnings: string[] = [];
    for (const server of this.status().servers) {
      if (server.state === "error" && server.error) {
        warnings.push(`MCP server "${server.id}" is unavailable: ${server.error}`);
      }
    }
    for (const tool of this.tools()) {
      if (tool.providerName.length > 64) {
        warnings.push(`MCP tool "${tool.providerName}" is longer than 64 characters.`);
      }
    }
    return warnings;
  }

  /**
   * Server instructions, for the agent runtime to append to a system prompt.
   * Empty when no connected server published instructions.
   */
  promptAddendum(): string {
    const lines: string[] = [];
    for (const server of this.status().servers) {
      if (server.state === "ready" && server.instructions) {
        lines.push(`- ${server.id}: ${server.instructions}`);
      }
    }
    if (lines.length === 0) return "";
    return `MCP server instructions:\n${lines.join("\n")}`;
  }

  status(): McpRuntimeStatus {
    return {
      disabled: this.loaded.disabled,
      source: this.loaded.source,
      ...(this.loaded.configPath ? { configPath: this.loaded.configPath } : {}),
      servers: this.connections.map((connection) => connection.status()),
    };
  }

  async call(name: string, args: unknown, ctx?: ToolExecContext): Promise<AgentToolResult> {
    const parsed = parseToolName(name);
    if (!parsed) return errorResult(`Unknown MCP tool "${name}".`);
    const tool = this.tools().find((candidate) => {
      if (candidate.serverId !== parsed.serverId) return false;
      return candidate.toolName === parsed.toolName
        || candidate.providerName === name
        || candidate.canonicalName === name;
    });
    if (!tool) return errorResult(`Unknown MCP tool "${name}".`);
    const connection = this.connections.find((candidate) => candidate.config.id === tool.serverId);
    if (!connection) return errorResult(`MCP server "${tool.serverId}" is not connected.`);
    const parsedArgs = parseToolArguments(args);
    if (!parsedArgs.ok) return errorResult(parsedArgs.error);
    return connection.call(tool.toolName, parsedArgs.value, ctx?.signal ? { signal: ctx.signal } : {});
  }

  async close(): Promise<void> {
    await Promise.all(this.connections.map((connection) => connection.close()));
  }
}

export async function startMcp(options?: StartMcpOptions): Promise<McpRuntime> {
  return McpRuntime.start(options);
}
