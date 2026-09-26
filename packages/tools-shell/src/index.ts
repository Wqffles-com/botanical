/**
 * Botanical built-in tools.
 *
 * This package implements the v0 shell and code-exec tools. Web search/fetch
 * and file read/write share {@link ToolDefinition} and register under the
 * same builtin names when those slices land.
 *
 * Security limits for shell and code exec: see packages/tools/SECURITY.md.
 */

export {
  APPROVAL_LEVELS,
  toModelTool,
  type ApprovalLevel,
  type JsonObjectSchema,
  type JsonSchema,
  type ModelToolDefinition,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./types.ts";

export { ToolInputError } from "./errors.ts";
export { checkShellSandbox, type SandboxCheck } from "./sandbox/run.ts";
export {
  CODE_LANGUAGES,
  resolveShellOptions,
  type CodeLanguage,
  type ResolvedShellOptions,
  type ShellToolsOptions,
} from "./shell/options.ts";
import { createCodeExecTool, createShellTool } from "./shell/tools.ts";
import { resolveShellOptions, type ShellToolsOptions } from "./shell/options.ts";
import type { ToolDefinition } from "./types.ts";

export { createCodeExecTool, createShellTool };
export { createToolContributor } from "./contributor.ts";
export type { ShellContributorOptions, ToolContributor } from "./contributor.ts";

/**
 * v0 builtin registry. Names stay stable across tool packages.
 * `shell` and `code_exec` are implemented here. The others are reserved
 * for the web and file tool slices.
 */
export const BUILTIN_TOOL_NAMES = [
  "web_search",
  "web_fetch",
  "shell",
  "code_exec",
  "file_read",
  "file_write",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const SHELL_TOOL_NAMES = ["shell", "code_exec"] as const;

/** Shell and code_exec, sharing one sandbox configuration. */
export function createShellTools(options?: ShellToolsOptions): ToolDefinition[] {
  const resolved = resolveShellOptions(options);
  return [createShellTool(resolved), createCodeExecTool(resolved)];
}
