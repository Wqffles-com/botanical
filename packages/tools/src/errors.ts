/** Machine-readable codes returned in {@link ToolResult.error}. */
export const ToolErrorCode = {
  invalidParams: "invalid_params",
  pathEscape: "path_escape",
  symlinkEscape: "symlink_escape",
  notFound: "not_found",
  isDirectory: "is_directory",
  notDirectory: "not_directory",
  binaryFile: "binary_file",
  tooLarge: "too_large",
  alreadyExists: "already_exists",
  notEmpty: "not_empty",
  confirmationRequired: "confirmation_required",
  workspaceRootProtected: "workspace_root_protected",
  tooManyEntries: "too_many_entries",
  invalidWorkspace: "invalid_workspace",
  ioError: "io_error",
  aborted: "aborted",
  unknownTool: "unknown_tool",
  toolFailed: "tool_failed",
} as const;

export type ToolErrorCode = (typeof ToolErrorCode)[keyof typeof ToolErrorCode];

/**
 * Expected tool failure. Messages are safe to show to a model: they do not
 * include absolute paths outside the workspace.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
