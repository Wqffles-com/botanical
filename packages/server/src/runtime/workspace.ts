import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Directory jailed for built-in file tools. Created if it is missing. */
export function ensureWorkspaceRoot(): string {
  const configured = process.env.BOTANICAL_WORKSPACE?.trim() || process.env.BOTANICAL_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/tmp/botanical-workspace";
  mkdirSync(root, { recursive: true });
  return root;
}

/** Per-agent directory inside the workspace jail. CLI profiles use this as cwd. */
export function agentWorkspace(agentId: string): string {
  const safe = agentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "agent";
  const dir = join(ensureWorkspaceRoot(), "agents", safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}
