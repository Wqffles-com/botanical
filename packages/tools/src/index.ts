/** Built-in tool names. Execution is intentionally absent. */
export const BUILTIN_TOOL_NAMES = [
  "web_search",
  "web_fetch",
  "shell",
  "file_read",
  "file_write",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export interface ToolDefinition {
  name: string;
  description: string;
}
