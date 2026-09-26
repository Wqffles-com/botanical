/**
 * Server view of m06's tool registry (agent-runtime `TOOL_REGISTRY_VERSION` 1).
 * Contributors are what `register` stores. `list` / `call` flatten them.
 * Built-ins come from `createToolContributor` on `@botanical/tools`,
 * `@botanical/tools-shell`, and `@botanical/tools-web`.
 * MCP (m09) registers with `source: "mcp"` and ids `mcp.<server>.<tool>`.
 */

export type ToolSourceKind = "builtin" | "mcp";

export interface ToolCallContext {
  agentId: string;
  chatId: string;
  signal?: AbortSignal;
  workspaceRoot?: string;
}

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: ToolSourceKind;
  serverId?: string;
  risk?: string;
  requiresApproval?: boolean;
}

export interface ToolInvocationResult {
  content: string;
  isError?: boolean;
  data?: unknown;
  truncated?: boolean;
}

export interface ToolContributor {
  readonly id: string;
  readonly source: ToolSourceKind;
  listTools(): Promise<readonly RegisteredTool[]> | readonly RegisteredTool[];
  callTool(toolId: string, args: unknown, ctx: ToolCallContext): Promise<ToolInvocationResult>;
}

export interface RuntimeToolSource {
  readonly id: string;
  listTools(): Promise<
    Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      origin: "builtin" | "mcp" | "runtime";
    }>
  >;
  call(
    name: string,
    args: unknown,
    ctx: { agentId: string; chatId: string; signal?: AbortSignal; workspaceRoot?: string },
  ): Promise<{ output: unknown; isError?: boolean }>;
}

export interface ToolRegistry {
  register(contributor: ToolContributor): void;
  unregister(contributorId: string): boolean;
  getContributor(id: string): ToolContributor | undefined;
  list(): Promise<RegisteredTool[]>;
  call(toolId: string, args: unknown, ctx: ToolCallContext): Promise<ToolInvocationResult>;
  toToolSources(enrich?: (ctx: ToolCallContext) => ToolCallContext): RuntimeToolSource[];
}
