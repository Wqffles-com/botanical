import { mkdirSync } from "node:fs";
import { agentWorkspacePath } from "@botanical/tools";

/** Shared workspace directory. Agents get a subdirectory under `agents/`. Created if missing. */
export function ensureWorkspaceRoot(): string {
  const configured = process.env.BOTANICAL_WORKSPACE?.trim() || process.env.BOTANICAL_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/tmp/botanical-workspace";
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Per-agent directory inside the workspace jail.
 * CLI profiles use this as cwd. Built-in file tools and shell/code_exec use the
 * same path, derived from the agent id on the tool context.
 */
export function agentWorkspace(agentId: string): string {
  const dir = agentWorkspacePath(ensureWorkspaceRoot(), agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
