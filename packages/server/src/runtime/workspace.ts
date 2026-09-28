import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { currentUserId } from "@botanical/db";
import { agentWorkspacePath, sanitizeAgentId } from "@botanical/tools";

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
/** `<root>/users/<userId>` when a request or job is scoped. Otherwise the shared root. */
export function userWorkspaceRoot(userId: string | null = currentUserId()): string {
  const root = ensureWorkspaceRoot();
  if (!userId) return root;
  const dir = join(root, "users", sanitizeAgentId(userId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function agentWorkspace(agentId: string, userId: string | null = currentUserId()): string {
  const dir = agentWorkspacePath(userWorkspaceRoot(userId), agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
