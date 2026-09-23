export { ToolError, ToolErrorCode } from "./errors.ts";
export { TOOL_INTERFACE_VERSION } from "./types.ts";
export type {
  JsonSchema,
  JsonSchemaObject,
  OpenAIFunctionTool,
  ToolContext,
  ToolDefinition,
  ToolErrorBody,
  ToolRegistry,
  ToolResult,
  ToolRisk,
} from "./types.ts";

export { toOpenAIFunctionTool } from "./openai.ts";
export { createToolRegistry, defineTool, errorResult } from "./registry.ts";
export type { DefineToolInput } from "./registry.ts";
export { asBoolean, asInteger, asString, coerceParams, parseParams } from "./validate.ts";

export {
  assertInsideWorkspace,
  canonicalizeWorkspaceRoot,
  isInsideWorkspace,
  mkdirAllInside,
  resolveInsideWorkspace,
  toPosixRelative,
} from "./path-jail.ts";
export type { ResolveInsideOptions, ResolvedPath } from "./path-jail.ts";

export { DEFAULT_FILE_LIMITS, resolveFileConfig } from "./files/config.ts";
export type { FileToolsConfig, ResolvedFileLimits } from "./files/config.ts";
export { FILE_TOOL_NAMES, createFileTools } from "./files/index.ts";
export type { FileToolName } from "./files/index.ts";
export type { FileReadData } from "./files/read.ts";
export type { FileWriteData } from "./files/write.ts";
export type { FileListData, FileListEntry } from "./files/list.ts";
export type { FileDeleteData } from "./files/delete.ts";
