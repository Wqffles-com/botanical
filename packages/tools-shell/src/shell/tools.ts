import { ensureAgentWorkspace } from "@botanical/tools";
import { ToolInputError } from "../errors.ts";
import { MIN_TIMEOUT_MS } from "../sandbox/limits.ts";
import { FIXED_PATH } from "../sandbox/env.ts";
import { resolveWorkspaceCwd, whichOnFixedPath } from "../sandbox/paths.ts";
import { runSandboxed, type SandboxRequest } from "../sandbox/run.ts";
import type { JsonObjectSchema, ToolContext, ToolDefinition, ToolResult } from "../types.ts";
import { parseCodeArgs, parseShellArgs, shellCommandArgv } from "./args.ts";
import { sandboxToToolResult } from "./format.ts";
import { type CodeLanguage, type ResolvedShellOptions } from "./options.ts";

const SHELL_DESCRIPTION = `Run a command with /bin/sh. The working directory is this agent's workspace (or a subdirectory given as cwd). cwd must stay inside that directory. "." and "/" mean that directory.

Shell is not a filesystem sandbox beyond the existing process jail. The jail, when it starts, mounts the agent directory at /workspace and also mounts the paths that jail already allows, including a read-only /usr. A command can still name those paths. Choosing the agent directory as cwd does not hide them. If the jail cannot start, this tool returns an error and does not run the command on the host.

The process gets a scrubbed environment: no host secrets, HOME=/workspace, and a fixed PATH. Output is capped and the process is killed when the timeout fires. Network is disabled unless the operator turned it on.`;

const CODE_DESCRIPTION = `Execute JavaScript, TypeScript, or Python. The program starts in this agent's workspace (or a subdirectory given as cwd). cwd must stay inside that directory.

code_exec is not a filesystem sandbox beyond the existing process jail. The jail, when it starts, mounts the agent directory at /workspace and also mounts the paths that jail already allows, including a read-only /usr. A command can still name those paths. If the jail cannot start, this tool returns an error and does not run the program on the host.

JavaScript and TypeScript run on Bun. Python runs as \`python3 -I -B\`. The source is mounted read-only at /botanical. The same jail, environment scrub, timeout, and output cap as the shell tool apply. Network is disabled unless the operator turned it on.`;

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

/**
 * Working directory for this call. `agentId` comes from the turn, not from
 * tool arguments. The returned root is `<workspaceRoot>/agents/<agentId>`.
 */
async function bindWorkspace(
  ctx: ToolContext,
): Promise<{ root: string; agentScope: boolean } | ToolResult> {
  const missing = requireWorkspace(ctx);
  if (missing) return missing;
  const agentId = typeof ctx.agentId === "string" ? ctx.agentId.trim() : "";
  if (!agentId) return { root: ctx.workspaceRoot, agentScope: false };
  try {
    const root = await ensureAgentWorkspace(ctx.workspaceRoot, agentId);
    return { root, agentScope: true };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "invalid workspace";
    return {
      ok: false,
      error: message,
      content: `error: ${message}`,
      data: { errorCode: "invalid_workspace" },
    };
  }
}

function isBound(value: { root: string; agentScope: boolean } | ToolResult): value is {
  root: string;
  agentScope: boolean;
} {
  return "root" in value;
}

function sharedParameterProps(maxTimeoutMs: number): JsonObjectSchema["properties"] {
  return {
    cwd: {
      type: "string",
      description:
        "Working directory relative to this agent's workspace. `.` and `/` are that directory. Omit to start there. A cwd that leaves the directory is rejected. This does not add filesystem isolation beyond the process jail.",
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
      const bound = await bindWorkspace(ctx);
      if (!isBound(bound)) return bound;
      try {
        const parsed = parseShellArgs(args, options.limits);
        const argv = shellCommandArgv(parsed.command, options.shellAllowlist);
        const req: SandboxRequest = {
          workspaceRoot: bound.root,
          agentScope: bound.agentScope,
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
      const bound = await bindWorkspace(ctx);
      if (!isBound(bound)) return bound;
      try {
        const parsed = parseCodeArgs(args, options.limits, options.languages);
        resolveWorkspaceCwd(bound.root, parsed.cwd, { agentScope: bound.agentScope });
        const filename = `prog.${EXTENSION[parsed.language]}`;
        const argv = interpreterArgv(parsed.language, filename);
        const req: SandboxRequest = {
          workspaceRoot: bound.root,
          agentScope: bound.agentScope,
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
