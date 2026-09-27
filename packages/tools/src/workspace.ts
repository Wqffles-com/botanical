import { mkdirSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { ToolError, ToolErrorCode } from "./errors.ts";
import { canonicalizeWorkspaceRoot, isInsideWorkspace } from "./path-jail.ts";

/** Used when `BOTANICAL_WORKSPACE` is unset. Relative to the process cwd. */
export const DEFAULT_WORKSPACE_DIR = "./data/workspace";

/**
 * Jail directory for file and shell tools.
 * Explicit argument, then `BOTANICAL_WORKSPACE`, then `BOTANICAL_WORKSPACE_ROOT`,
 * then {@link DEFAULT_WORKSPACE_DIR}. The result is absolute.
 */
export function resolveWorkspaceDir(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): string {
  const configured = firstNonEmpty(explicit, env.BOTANICAL_WORKSPACE, env.BOTANICAL_WORKSPACE_ROOT);
  return path.resolve(cwd, configured ?? DEFAULT_WORKSPACE_DIR);
}

/** Create the jail if needed and return its absolute path. */
export function ensureWorkspaceRoot(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const root = resolveWorkspaceDir(undefined, env, cwd);
  mkdirSync(root, { recursive: true });
  return root;
}

export async function ensureWorkspaceDir(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
}

/**
 * Directory name for an agent id. Matches the server CLI cwd helper:
 * anything outside `[A-Za-z0-9_-]` becomes `_`, capped at 80 characters.
 */
export function sanitizeAgentId(agentId: string): string {
  const safe = agentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return safe.length > 0 ? safe : "agent";
}

/** `<root>/agents/<sanitized id>`. Does not create the directory. */
export function agentWorkspacePath(root: string, agentId: string): string {
  return path.join(root, "agents", sanitizeAgentId(agentId));
}

/**
 * Create `<root>/agents/<agentId>` and return its real path.
 * A symlink on `agents` or the agent directory that resolves outside `root`
 * is a tool error. The id is the only selector; it cannot contain `..`.
 */
export async function ensureAgentWorkspace(root: string, agentId: string): Promise<string> {
  const base = await canonicalizeWorkspaceRoot(root);
  const agentsDir = path.join(base, "agents");
  await mkdir(agentsDir, { recursive: true });
  let agentsReal: string;
  try {
    agentsReal = await realpath(agentsDir);
  } catch {
    throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root is not accessible");
  }
  if (!isInsideWorkspace(base, agentsReal)) {
    throw new ToolError(ToolErrorCode.pathEscape, `path "." is outside this agent's workspace`);
  }
  const dir = path.join(agentsReal, sanitizeAgentId(agentId));
  await mkdir(dir, { recursive: true });
  const real = await canonicalizeWorkspaceRoot(dir);
  if (!isInsideWorkspace(base, real)) {
    throw new ToolError(ToolErrorCode.pathEscape, `path "." is outside this agent's workspace`);
  }
  return real;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
