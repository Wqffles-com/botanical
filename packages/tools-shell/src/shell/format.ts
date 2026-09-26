import type { ToolResult } from "../types.ts";
import type { SandboxResult } from "../sandbox/run.ts";

export function sandboxToToolResult(
  result: SandboxResult,
  timeoutMs: number,
  timeoutClamped: boolean,
): ToolResult {
  const data = {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    truncated: result.truncated,
    aborted: result.aborted,
    cwd: result.jailCwd,
    durationMs: result.durationMs,
    ...(result.operatorDiagnostic ? { operatorDiagnostic: result.operatorDiagnostic } : {}),
  };

  if (result.sandboxError && !result.timedOut && !result.aborted) {
    return {
      ok: false,
      error: result.sandboxError,
      content: `sandbox_error: ${result.sandboxError}`,
      truncated: result.truncated,
      data: { ...data, errorCode: "sandbox_failed" },
    };
  }

  const content = [
    `exit_code: ${result.exitCode ?? "null"}`,
    `timed_out: ${result.timedOut}`,
    `truncated: ${result.truncated}`,
    `aborted: ${result.aborted}`,
    `cwd: ${result.jailCwd}`,
    `timeout_ms: ${timeoutMs}${timeoutClamped ? " (clamped)" : ""}`,
    "",
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
  ].join("\n");

  if (result.aborted) {
    return { ok: false, error: "aborted", content, truncated: result.truncated, data: { ...data, errorCode: "aborted" } };
  }
  if (result.timedOut) {
    return { ok: false, error: "timed out", content, truncated: result.truncated, data: { ...data, errorCode: "timeout" } };
  }
  if (result.truncated && result.exitCode !== 0) {
    return {
      ok: false,
      error: "output truncated",
      content,
      truncated: true,
      data: { ...data, errorCode: "truncated" },
    };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: `exit ${result.exitCode ?? "null"}`,
      content,
      truncated: result.truncated,
      data: { ...data, errorCode: "exit_nonzero" },
    };
  }
  return { ok: true, content, truncated: result.truncated, data };
}
