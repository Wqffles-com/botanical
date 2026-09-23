import type { ToolDefinition } from "../types.ts";
import { resolveFileConfig, type FileToolsConfig } from "./config.ts";
import { createFileDeleteTool } from "./delete.ts";
import { createFileListTool } from "./list.ts";
import { createFileReadTool } from "./read.ts";
import { createFileWriteTool } from "./write.ts";

export const FILE_TOOL_NAMES = ["file_read", "file_write", "file_list", "file_delete"] as const;

export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

/** Workspace-jailed file tools. Pass `workspaceRoot` per call via ToolContext to override the default. */
export function createFileTools(config: FileToolsConfig = {}): ToolDefinition[] {
  const resolved = resolveFileConfig(config);
  return [
    createFileReadTool(resolved),
    createFileWriteTool(resolved),
    createFileListTool(resolved),
    createFileDeleteTool(resolved),
  ];
}
