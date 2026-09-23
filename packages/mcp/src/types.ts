/** JSON Schema object passed to model providers as tool parameters. */
export type JsonObject = Record<string, unknown>;

/**
 * Tool definition the agent loop hands to a provider adapter.
 * Adapters map this onto OpenAI / Anthropic / other tool schemas.
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  parameters: JsonObject;
}

export interface ApprovalRequest {
  name: string;
  source: "builtin" | "mcp";
  serverId?: string;
  arguments: JsonObject;
}

export interface ToolExecContext {
  signal?: AbortSignal;
  /** Return false to deny. Omit to allow. */
  approve?: (request: ApprovalRequest) => Promise<boolean> | boolean;
}

export interface AgentToolResult {
  ok: boolean;
  /** Text the model should see. */
  content: string;
  structured?: unknown;
  isError?: boolean;
}

export interface BuiltinTool {
  name: string;
  description?: string;
  parameters?: JsonObject;
  execute: (args: JsonObject, ctx: ToolExecContext) => Promise<AgentToolResult | string>;
}

export type McpTransportKind = "stdio" | "http" | "sse";

interface McpServerConfigBase {
  /** Short id used in tool names. Letters, digits, `_`, `-`. No `__` or `.`. */
  id: string;
  enabled?: boolean;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Initialize handshake timeout in milliseconds. */
  connectTimeoutMs?: number;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  transport: "stdio";
  /** Executable path. Spawned without a shell. */
  command: string;
  args?: string[];
  /**
   * Extra environment for the child. Merged on top of a small safe default
   * (PATH, HOME, …). The parent process environment is not copied, so model
   * API keys are not visible unless listed here.
   */
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  /**
   * When the streamable handshake fails, try the legacy SSE transport
   * against the same URL. Default false.
   */
  sseFallback?: boolean;
}

export interface McpSseServerConfig extends McpServerConfigBase {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpRemoteServerConfig = McpHttpServerConfig | McpSseServerConfig;

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

export interface McpFileConfig {
  servers: McpServerConfig[];
}

export interface McpToolInfo {
  serverId: string;
  /** Remote tool name, unchanged. */
  toolName: string;
  /** Architectural id: `mcp.<server>.<tool>`. */
  canonicalName: string;
  /** Model-facing id: `mcp__<server>__<tool>`. */
  providerName: string;
  description: string;
  parameters: JsonObject;
  title?: string;
}

export type McpServerState = "ready" | "error" | "closed" | "disabled";

export interface McpServerStatus {
  id: string;
  transport: McpTransportKind;
  state: McpServerState;
  toolCount: number;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  error?: string;
}

export interface McpRuntimeStatus {
  disabled: boolean;
  source: "disabled" | "env" | "file" | "empty";
  configPath?: string;
  servers: McpServerStatus[];
}

export interface ExposedTool {
  definition: ToolDefinition;
  source: "builtin" | "mcp";
  serverId?: string;
  /** Set for MCP tools. */
  canonicalName?: string;
  providerName?: string;
}
