import {
  executeWithLimits,
  readBoundedInt,
  withLimitNote,
  type LimitedToolResult,
} from "@botanical/tools";

import type { DnsLookup, FetchLike, ToolExecutionResult } from "./types.ts";
import { builtinWebTools } from "./web/index.ts";

/**
 * m06 registry plug-in. Loaded as `createToolContributor` from this package.
 * `web_search` and `web_fetch` share contributor id `builtin.web`.
 * Search stays offline until a provider key is configured.
 */
export interface ToolCallContext {
  agentId?: string;
  chatId?: string;
  signal?: AbortSignal;
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
    risk: "network";
    requiresApproval: false;
  }>;
  callTool(
    toolId: string,
    args: unknown,
    ctx: ToolCallContext,
  ): Promise<{ content: string; isError?: boolean; data?: unknown; truncated?: boolean }>;
}

const DEFAULT_WEB_TIMEOUT_MS = 130_000;
const DEFAULT_MAX_OUTPUT_CHARS = 32_000;

export interface WebContributorOptions {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  dnsLookup?: DnsLookup;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export function createToolContributor(options: WebContributorOptions = {}): ToolContributor {
  const env = options.env ?? process.env;
  const timeoutMs =
    options.timeoutMs ?? readBoundedInt(env, "BOTANICAL_WEB_TOOL_TIMEOUT_MS", DEFAULT_WEB_TIMEOUT_MS, 50, 600_000);
  const maxOutputChars =
    options.maxOutputChars ??
    readBoundedInt(env, "BOTANICAL_TOOL_MAX_OUTPUT_CHARS", DEFAULT_MAX_OUTPUT_CHARS, 1_000, 200_000);
  const tools = builtinWebTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    id: "builtin.web",
    source: "builtin",
    listTools() {
      return tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: withLimitNote(tool.description, timeoutMs, maxOutputChars),
        parameters: tool.parameters as unknown as Record<string, unknown>,
        source: "builtin" as const,
        risk: "network" as const,
        requiresApproval: false as const,
      }));
    },
    async callTool(toolId, args, ctx) {
      const tool = byName.get(toolId);
      if (!tool) return { content: `Unknown tool "${toolId}"`, isError: true };
      return executeWithLimits(
        (signal) => tool.execute(args, {
          signal,
          ...(options.env ? { env: options.env } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
        }).then(fromWebResult),
        { timeoutMs, maxOutputChars, toolName: tool.name, ...(ctx.signal ? { signal: ctx.signal } : {}) },
      );
    },
  };
}

function fromWebResult(result: ToolExecutionResult): LimitedToolResult {
  return {
    content: result.content,
    ...(result.ok ? {} : { isError: true }),
    ...(result.data !== undefined ? { data: result.data } : {}),
  };
}
