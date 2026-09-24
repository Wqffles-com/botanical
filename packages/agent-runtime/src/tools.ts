import { ValidationError } from "./errors";

export interface ToolResult {
  output: unknown;
  isError?: boolean;
}

export interface ToolCallContext {
  agentId: string;
  chatId: string;
  signal?: AbortSignal;
  /** Jail root for built-ins that touch the filesystem. Set by the server per call. */
  workspaceRoot?: string;
}

export interface ListedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Which ToolSource owns the call. */
  sourceId: string;
  origin: "builtin" | "mcp" | "runtime";
}

/**
 * A bag of tools the runtime can list and call.
 * Built-ins, MCP, and the A2A runtime tools each implement this.
 */
export interface ToolSource {
  readonly id: string;
  listTools(): Promise<Array<Omit<ListedTool, "sourceId">>>;
  call(name: string, args: unknown, ctx: ToolCallContext): Promise<ToolResult>;
}

export interface ExecutableTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: unknown, ctx: ToolCallContext): Promise<ToolResult>;
}

export interface McpListedTool {
  server: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content: unknown;
  isError?: boolean;
}

/** Implemented by the MCP client (this package's server, or packages' MCP slice). */
export interface McpToolBridge {
  listTools(): Promise<McpListedTool[]>;
  callTool(
    server: string,
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  status?(): Promise<Array<{ id: string; ok: boolean; toolCount: number; error?: string }>>;
  close?(): Promise<void>;
}

const EMPTY_SCHEMA: Record<string, unknown> = { type: "object", properties: {} };

export function createBuiltinToolSource(tools: readonly ExecutableTool[]): ToolSource {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    id: "builtin",
    async listTools() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        origin: "builtin" as const,
      }));
    },
    async call(name, args, ctx) {
      const tool = byName.get(name);
      if (!tool) {
        return { output: { error: `Unknown built-in tool "${name}"` }, isError: true };
      }
      return tool.execute(args, ctx);
    },
  };
}

export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp.${serverId}.${toolName}`;
}

export function parseMcpToolName(qualified: string): { serverId: string; toolName: string } | null {
  const match = /^mcp\.([A-Za-z0-9_-]+)\.(.+)$/.exec(qualified);
  if (!match) return null;
  const serverId = match[1];
  const toolName = match[2];
  if (!serverId || !toolName) return null;
  return { serverId, toolName };
}

export function createMcpToolSource(bridge: McpToolBridge): ToolSource {
  return {
    id: "mcp",
    async listTools() {
      const tools = await bridge.listTools();
      return tools.map((tool) => ({
        name: mcpToolName(tool.server, tool.name),
        description: tool.description,
        parameters: tool.inputSchema ?? EMPTY_SCHEMA,
        origin: "mcp" as const,
      }));
    },
    async call(name, args, ctx) {
      const parsed = parseMcpToolName(name);
      if (!parsed) {
        return { output: { error: `Not an MCP tool name: ${name}` }, isError: true };
      }
      const result = await bridge.callTool(parsed.serverId, parsed.toolName, args, ctx.signal);
      return {
        output: mcpResultOutput(result.content),
        isError: result.isError ?? false,
      };
    },
  };
}

export async function collectTools(sources: readonly ToolSource[]): Promise<ListedTool[]> {
  const seen = new Set<string>();
  const out: ListedTool[] = [];
  for (const source of sources) {
    for (const tool of await source.listTools()) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      out.push({ ...tool, sourceId: source.id });
    }
  }
  return out;
}

/** Trailing `*` is a prefix match. `*` alone allows every non-runtime tool. */
export function toolAllowed(allowlist: readonly string[], toolName: string): boolean {
  for (const raw of allowlist) {
    const pattern = raw.trim();
    if (!pattern) continue;
    if (pattern === "*" || pattern === toolName) return true;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (prefix.length > 0 && toolName.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function normalizeToolArguments(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new ValidationError("Tool arguments are not valid JSON");
    }
  }
  if (value == null) return {};
  return value;
}

export function toolResultToContent(result: ToolResult): string {
  if (typeof result.output === "string") return result.output;
  return JSON.stringify(result.output);
}

function mcpResultOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return null;
    })
    .filter((part): part is string => part != null);
  if (texts.length === content.length && texts.length > 0) return texts.join("\n");
  return content;
}
