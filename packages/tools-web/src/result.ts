import type { ToolExecutionResult } from "./types.ts";

/** Expected tool failure. `execute` catches this and returns a result instead of throwing. */
export class ToolCallError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = "ToolCallError";
    this.errorCode = errorCode;
  }
}

export function toolOk(content: string, data?: unknown): ToolExecutionResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

export function toolError(errorCode: string, content: string, data?: unknown): ToolExecutionResult {
  return data === undefined
    ? { ok: false, errorCode, content }
    : { ok: false, errorCode, content, data };
}

export function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const code = "code" in error ? error.code : undefined;
  return code === 20 || code === "ABORT_ERR";
}

export function failureFromUnknown(error: unknown, timeoutMs?: number): ToolExecutionResult {
  if (error instanceof ToolCallError) {
    return toolError(error.errorCode, error.message);
  }
  if (isAbortLike(error)) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError") {
      const after = timeoutMs === undefined ? "" : ` after ${timeoutMs}ms`;
      return toolError("timeout", `The request timed out${after}.`);
    }
    return toolError("aborted", "The request was aborted.");
  }
  if (error instanceof TypeError) {
    return toolError("network_error", `Network request failed: ${error.message}`);
  }
  const message = error instanceof Error && error.message ? error.message : "Tool failed.";
  return toolError("tool_error", message);
}

export async function runTool(
  fn: () => Promise<ToolExecutionResult>,
  timeoutMs?: number,
): Promise<ToolExecutionResult> {
  try {
    return await fn();
  } catch (error) {
    return failureFromUnknown(error, timeoutMs);
  }
}
