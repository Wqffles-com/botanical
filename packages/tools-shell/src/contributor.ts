import {
  ensureWorkspaceDir,
  executeWithLimits,
  readBoundedInt,
  resolveWorkspaceDir,
  withLimitNote,
  type LimitedToolResult,
} from "@botanical/tools";

import { resolveShellOptions } from "./shell/options.ts";
import { createCodeExecTool, createShellTool } from "./shell/tools.ts";
import type { ToolResult } from "./types.ts";

/**
 * m06 registry plug-in. Loaded as `createToolContributor` from this package.
 * `shell` and `code_exec` share one contributor id, `builtin.shell`.
 */
export interface ToolCallContext {
  agentId?: string;
  chatId?: string;
  signal?: AbortSignal;
  workspaceRoot?: string;
}

export interface ToolContributor {
  readonly id: string;
  readonly source: "builtin";
  listTools(): ReadonlyArray<{
    id: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    source: "builtin";
    risk: "execute";
    requiresApproval: boolean;
  }>;
  callTool(
    toolId: string,
    args: unknown,
    ctx: ToolCallContext,
  ): Promise<{ content: string; isError?: boolean; data?: unknown; truncated?: boolean }>;
}

const DEFAULT_SHELL_TIMEOUT_MS = 130_000;
const DEFAULT_MAX_OUTPUT_CHARS = 32_000;

export interface ShellContributorOptions {
  workspaceRoot?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export function createToolContributor(options: ShellContributorOptions = {}): ToolContributor {
  const env = options.env ?? process.env;
  const timeoutMs =
    options.timeoutMs ?? readBoundedInt(env, "BOTANICAL_SHELL_TOOL_TIMEOUT_MS", DEFAULT_SHELL_TIMEOUT_MS, 50, 600_000);
  const maxOutputChars =
    options.maxOutputChars ??
    readBoundedInt(env, "BOTANICAL_TOOL_MAX_OUTPUT_CHARS", DEFAULT_MAX_OUTPUT_CHARS, 1_000, 200_000);
  const resolved = resolveShellOptions();
  const tools = [createShellTool(resolved), createCodeExecTool(resolved)];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    id: "builtin.shell",
    source: "builtin",
    listTools() {
      return tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: withLimitNote(tool.description, timeoutMs, maxOutputChars),
        parameters: tool.parameters as unknown as Record<string, unknown>,
        source: "builtin" as const,
        risk: "execute" as const,
        requiresApproval: tool.approval !== "allow",
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
          meta: {
            ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
            ...(ctx.chatId ? { chatId: ctx.chatId } : {}),
          },
        }).then(fromShellResult),
        { timeoutMs, maxOutputChars, toolName: tool.name, ...(ctx.signal ? { signal: ctx.signal } : {}) },
      );
    },
  };
}

async function openJail(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
): Promise<string | { content: string; isError: true }> {
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

function fromShellResult(result: ToolResult): LimitedToolResult {
  return {
    content: result.content,
    ...(result.ok ? {} : { isError: true }),
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
  };
}
