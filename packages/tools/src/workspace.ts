import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

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

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
