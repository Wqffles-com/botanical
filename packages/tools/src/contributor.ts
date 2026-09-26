import { createFileTools } from "./files/index.ts";
import {
  DEFAULT_FILE_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  executeWithLimits,
  readBoundedInt,
  withLimitNote,
  type LimitedToolResult,
} from "./limits.ts";
import type { ToolDefinition } from "./types.ts";
import { ensureWorkspaceDir, resolveWorkspaceDir } from "./workspace.ts";

/**
 * m06 registry plug-in (`TOOL_REGISTRY_VERSION` 1).
 * The server loads `createToolContributor` and registers it as `builtin.files`.
 * Call context may set `workspaceRoot`; otherwise `BOTANICAL_WORKSPACE`
 * or `./data/workspace` is used.
 */
export interface ToolCallContext {
  agentId?: string;
  chatId?: string;
  signal?: AbortSignal;
  workspaceRoot?: string;
}

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: "builtin";
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
  readonly source: "builtin";
  listTools(): readonly RegisteredTool[];
  callTool(toolId: string, args: unknown, ctx: ToolCallContext): Promise<ToolInvocationResult>;
}

const FILE_TOOL_IDS = ["file_read", "file_write", "file_list"] as const;

export interface FileContributorOptions {
  workspaceRoot?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export function createToolContributor(options: FileContributorOptions = {}): ToolContributor {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? readBoundedInt(env, "BOTANICAL_FILE_TOOL_TIMEOUT_MS", DEFAULT_FILE_TIMEOUT_MS, 50, 600_000);
  const maxOutputChars =
    options.maxOutputChars ??
    readBoundedInt(env, "BOTANICAL_TOOL_MAX_OUTPUT_CHARS", DEFAULT_MAX_OUTPUT_CHARS, 1_000, 200_000);
  const tools = createFileTools().filter((tool) =>
    (FILE_TOOL_IDS as readonly string[]).includes(tool.name),
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    id: "builtin.files",
    source: "builtin",
    listTools() {
      return tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: withLimitNote(tool.description, timeoutMs, maxOutputChars),
        parameters: tool.parameters as unknown as Record<string, unknown>,
        source: "builtin" as const,
        risk: tool.risk,
        requiresApproval: tool.requiresApproval,
      }));
    },
    async callTool(toolId, args, ctx) {
      const tool = byName.get(toolId);
      if (!tool) return { content: `Unknown tool "${toolId}"`, isError: true };
      const root = await openJail(ctx.workspaceRoot ?? options.workspaceRoot, env);
      if (typeof root !== "string") return root;
      return executeWithLimits(
        (signal) => tool.execute(args, {
          workspaceRoot: root,
          signal,
          timeoutMs,
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
          ...(ctx.chatId ? { chatId: ctx.chatId } : {}),
        }).then(fromFileResult),
        { timeoutMs, maxOutputChars, toolName: tool.name, ...(ctx.signal ? { signal: ctx.signal } : {}) },
      );
    },
  };
}

async function openJail(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
): Promise<string | ToolInvocationResult> {
  const root = resolveWorkspaceDir(explicit, env);
  try {
    await ensureWorkspaceDir(root);
    return root;
  } catch {
    return {
      content: "Workspace is not available. Set BOTANICAL_WORKSPACE to a writable directory.",
      isError: true,
    };
  }
}

function fromFileResult(result: Awaited<ReturnType<ToolDefinition["execute"]>>): LimitedToolResult {
  return {
    content: result.content,
    ...(result.ok ? {} : { isError: true }),
    ...(result.data !== undefined ? { data: result.data } : {}),
  };
}
