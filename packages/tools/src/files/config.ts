import { ToolError, ToolErrorCode } from "../errors.ts";
import type { ToolContext } from "../types.ts";
import { canonicalizeWorkspaceRoot } from "../path-jail.ts";
import { ensureAgentWorkspace } from "../workspace.ts";

export const DEFAULT_FILE_LIMITS = {
  maxReadBytes: 1_048_576,
  maxFileBytes: 8_388_608,
  maxWriteBytes: 1_048_576,
  maxListEntries: 500,
  maxDeleteEntries: 1_000,
} as const;

export interface FileToolsConfig {
  /**
   * Default jail. Captured from `BOTANICAL_WORKSPACE_ROOT` or
   * `BOTANICAL_WORKSPACE` when omitted. `ToolContext.workspaceRoot` overrides
   * this on each call.
   */
  workspaceRoot?: string;
  maxReadBytes?: number;
  /** Refuse to open a file larger than this, even for a line window. */
  maxFileBytes?: number;
  maxWriteBytes?: number;
  maxListEntries?: number;
  maxDeleteEntries?: number;
}

export interface ResolvedFileLimits {
  workspaceRoot?: string;
  maxReadBytes: number;
  maxFileBytes: number;
  maxWriteBytes: number;
  maxListEntries: number;
  maxDeleteEntries: number;
}

export function resolveFileConfig(config: FileToolsConfig = {}): ResolvedFileLimits {
  const fromEnv = process.env.BOTANICAL_WORKSPACE_ROOT ?? process.env.BOTANICAL_WORKSPACE;
  return {
    workspaceRoot: config.workspaceRoot ?? (fromEnv && fromEnv.length > 0 ? fromEnv : undefined),
    maxReadBytes: positive(config.maxReadBytes, DEFAULT_FILE_LIMITS.maxReadBytes, "maxReadBytes"),
    maxFileBytes: positive(config.maxFileBytes, DEFAULT_FILE_LIMITS.maxFileBytes, "maxFileBytes"),
    maxWriteBytes: positive(config.maxWriteBytes, DEFAULT_FILE_LIMITS.maxWriteBytes, "maxWriteBytes"),
    maxListEntries: positive(config.maxListEntries, DEFAULT_FILE_LIMITS.maxListEntries, "maxListEntries"),
    maxDeleteEntries: positive(
      config.maxDeleteEntries,
      DEFAULT_FILE_LIMITS.maxDeleteEntries,
      "maxDeleteEntries",
    ),
  };
}

export interface OpenedWorkspace {
  /** Canonical directory this call may touch. */
  root: string;
  /** True when `root` is `<base>/agents/<agentId>` from the turn's agent id. */
  agentScoped: boolean;
}

/**
 * Jail for this call. `ctx.workspaceRoot` is the shared base. When the turn
 * passes `ctx.agentId`, the jail is that agent's directory, created on demand.
 * The id is taken from the tool context, never from tool arguments.
 */
export async function openWorkspace(config: ResolvedFileLimits, ctx: ToolContext): Promise<OpenedWorkspace> {
  if (ctx.signal?.aborted) {
    throw new ToolError(ToolErrorCode.aborted, "operation aborted");
  }
  const requested = ctx.workspaceRoot ?? config.workspaceRoot;
  if (!requested) {
    throw new ToolError(
      ToolErrorCode.invalidWorkspace,
      "workspace root is not configured",
    );
  }
  const base = await canonicalizeWorkspaceRoot(requested);
  const agentId = ctx.agentId?.trim();
  if (!agentId) return { root: base, agentScoped: false };
  const root = await ensureAgentWorkspace(base, agentId);
  return { root, agentScoped: true };
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ToolError(ToolErrorCode.invalidParams, `${name} must be a positive integer`);
  }
  return value;
}
