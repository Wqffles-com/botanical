import { mkdirSync } from "node:fs";

/** Directory jailed for built-in file tools. Created if it is missing. */
export function ensureWorkspaceRoot(): string {
  const configured = process.env.BOTANICAL_WORKSPACE?.trim() || process.env.BOTANICAL_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/tmp/botanical-workspace";
  mkdirSync(root, { recursive: true });
  return root;
}
