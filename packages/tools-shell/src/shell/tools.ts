import { ToolInputError } from "../errors.ts";
import { MIN_TIMEOUT_MS } from "../sandbox/limits.ts";
import { FIXED_PATH } from "../sandbox/env.ts";
import { whichOnFixedPath } from "../sandbox/paths.ts";
import { runSandboxed, type SandboxRequest } from "../sandbox/run.ts";
import type { JsonObjectSchema, ToolContext, ToolDefinition, ToolResult } from "../types.ts";
import { parseCodeArgs, parseShellArgs, shellCommandArgv } from "./args.ts";
import { sandboxToToolResult } from "./format.ts";
import { type CodeLanguage, type ResolvedShellOptions } from "./options.ts";

const SHELL_DESCRIPTION = `Run a command with /bin/sh inside the workspace jail.

The process starts in the workspace (or a subdirectory given as cwd) with a scrubbed environment: no host secrets, HOME=/workspace, and a fixed PATH. It cannot read or write host files outside the workspace. Output is capped and the process is killed when the timeout fires. Network is disabled unless the operator turned it on. Do not assume access to the server home directory, API keys, or paths outside the workspace.`;

const CODE_DESCRIPTION = `Execute JavaScript, TypeScript, or Python inside the workspace jail.

JavaScript and TypeScript run on Bun. Python runs as \`python3 -I -B\`. The program is mounted read-only at /botanical and starts with cwd inside the workspace. The same jail, environment scrub, timeout, and output cap as the shell tool apply. Network is disabled unless the operator turned it on.`;

function inputError(err: ToolInputError): ToolResult {
  return {
    ok: false,
    error: err.message,
    content: `error: ${err.message}`,
    data: { errorCode: err.code },
  };
}

function requireWorkspace(ctx: ToolContext): ToolResult | undefined {
  if (ctx == null || typeof ctx.workspaceRoot !== "string" || ctx.workspaceRoot.trim() === "") {
    return {
      ok: false,
      error: "workspaceRoot is required",
      content: "error: workspaceRoot is required",
      data: { errorCode: "invalid_workspace" },
    };
  }
  return undefined;
}

function sharedParameterProps(maxTimeoutMs: number): JsonObjectSchema["properties"] {
  return {
    cwd: {
      type: "string",
      description:
        "Working directory relative to the workspace. Absolute paths must stay inside the workspace. Omit to use the workspace root.",
    },
    timeout_ms: {
      type: "integer",
      minimum: MIN_TIMEOUT_MS,
      maximum: maxTimeoutMs,
      description: `Wall-clock timeout in milliseconds (max ${maxTimeoutMs}). The process group is killed when it fires.`,
    },
    stdin: {
      type: "string",
      description: "Optional text written to the process standard input, then closed.",
    },
  };
}

async function invoke(req: SandboxRequest, timeoutMs: number, timeoutClamped: boolean): Promise<ToolResult> {
  const result = await runSandboxed(req);
  return sandboxToToolResult(result, timeoutMs, timeoutClamped);
}

export function createShellTool(options: ResolvedShellOptions): ToolDefinition {
  const parameters: JsonObjectSchema = {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "string",
        minLength: 1,
        description: options.shellAllowlist
          ? `Program to run. Allowlist mode: one of ${options.shellAllowlist.join(", ")}, plus arguments. No pipes, redirects, or other shell syntax.`
          : "Command string passed to /bin/sh -c inside the jail.",
      },
      ...sharedParameterProps(options.limits.maxTimeoutMs),
    },
  };

  return {
    name: "shell",
    description: SHELL_DESCRIPTION,
    parameters,
    approval: "ask",
    async execute(args, ctx) {
      const missing = requireWorkspace(ctx);
      if (missing) return missing;
      try {
        const parsed = parseShellArgs(args, options.limits);
        const argv = shellCommandArgv(parsed.command, options.shellAllowlist);
        const req: SandboxRequest = {
          workspaceRoot: ctx.workspaceRoot,
          argv,
          timeoutMs: parsed.timeoutMs,
          maxOutputBytes: options.limits.maxOutputBytes,
          maxStdinBytes: options.limits.maxStdinBytes,
          network: options.network,
          maxFileBytes: options.limits.maxFileBytes,
          nofile: options.limits.nofile,
        };
        if (parsed.cwd != null) req.cwd = parsed.cwd;
        if (parsed.stdin != null) req.stdin = parsed.stdin;
        if (options.extraEnv) req.extraEnv = options.extraEnv;
        if (ctx.signal) req.signal = ctx.signal;
        return await invoke(req, parsed.timeoutMs, parsed.timeoutClamped);
      } catch (err) {
        if (err instanceof ToolInputError) return inputError(err);
        throw err;
      }
    },
  };
}

const EXTENSION: Record<CodeLanguage, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
};

function interpreterArgv(language: CodeLanguage, filename: string): string[] {
  if (language === "python") {
    const python = whichOnFixedPath("python3", FIXED_PATH);
    if (!python) {
      throw new ToolInputError("runtime_missing", "python3 is not available on the sandbox PATH");
    }
    return [python, "-I", "-B", `/botanical/${filename}`];
  }
  const bun = whichOnFixedPath("bun", FIXED_PATH);
  if (!bun) {
    throw new ToolInputError("runtime_missing", "bun is not available on the sandbox PATH");
  }
  return [bun, `/botanical/${filename}`];
}

export function createCodeExecTool(options: ResolvedShellOptions): ToolDefinition {
  const parameters: JsonObjectSchema = {
    type: "object",
    additionalProperties: false,
    required: ["language", "code"],
    properties: {
      language: {
        type: "string",
        enum: options.languages,
        description: "Runtime. javascript and typescript use Bun. python uses python3 -I -B.",
      },
      code: {
        type: "string",
        minLength: 1,
        description: "Source to execute. It is mounted read-only; write outputs into the workspace.",
      },
      ...sharedParameterProps(options.limits.maxTimeoutMs),
    },
  };

  return {
    name: "code_exec",
    description: CODE_DESCRIPTION,
    parameters,
    approval: "ask",
    async execute(args, ctx) {
      const missing = requireWorkspace(ctx);
      if (missing) return missing;
      try {
        const parsed = parseCodeArgs(args, options.limits, options.languages);
        const filename = `prog.${EXTENSION[parsed.language]}`;
        const argv = interpreterArgv(parsed.language, filename);
        const req: SandboxRequest = {
          workspaceRoot: ctx.workspaceRoot,
          argv,
          timeoutMs: parsed.timeoutMs,
          maxOutputBytes: options.limits.maxOutputBytes,
          maxStdinBytes: options.limits.maxStdinBytes,
          network: options.network,
          maxFileBytes: options.limits.maxFileBytes,
          nofile: options.limits.nofile,
          scratchFiles: [{ name: filename, contents: parsed.code }],
        };
        if (parsed.cwd != null) req.cwd = parsed.cwd;
        if (parsed.stdin != null) req.stdin = parsed.stdin;
        if (options.extraEnv) req.extraEnv = options.extraEnv;
        if (ctx.signal) req.signal = ctx.signal;
        return await invoke(req, parsed.timeoutMs, parsed.timeoutClamped);
      } catch (err) {
        if (err instanceof ToolInputError) return inputError(err);
        throw err;
      }
    },
  };
}
