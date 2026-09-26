import { ToolInputError } from "../errors.ts";
import { FIXED_PATH } from "../sandbox/env.ts";
import { resolveTimeoutMs, type ResolvedLimits } from "../sandbox/limits.ts";
import { whichOnFixedPath } from "../sandbox/paths.ts";
import { CODE_LANGUAGES, type CodeLanguage } from "./options.ts";

const SHELL_META = /[|&;<>`$()\\\n\r]/;

export function splitShellWords(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (quote) throw new ToolInputError("invalid_args", "unbalanced quotes");
  if (current) out.push(current);
  return out;
}

/**
 * Full shell, or a direct exec when an allowlist is configured.
 * Allowlist mode does not invoke `/bin/sh`, so metacharacters are not operators.
 */
export function shellCommandArgv(command: string, allowlist: readonly string[] | undefined): string[] {
  if (allowlist == null) return ["/bin/sh", "-c", command];
  if (SHELL_META.test(command)) {
    throw new ToolInputError(
      "not_allowlisted",
      "allowlist mode rejects shell metacharacters; pass one program and its arguments",
    );
  }
  const words = splitShellWords(command.trim());
  const bin = words[0];
  if (bin == null || bin.includes("/") || !allowlist.includes(bin)) {
    throw new ToolInputError(
      "not_allowlisted",
      bin ? `command is not in the shell allowlist: ${bin}` : "command is empty",
    );
  }
  const resolved = whichOnFixedPath(bin, FIXED_PATH);
  if (!resolved) {
    throw new ToolInputError("not_allowlisted", `allowlisted program was not found on the sandbox PATH: ${bin}`);
  }
  return [resolved, ...words.slice(1)];
}

export interface ParsedInvocation {
  cwd?: string;
  stdin?: string;
  timeoutMs: number;
  timeoutClamped: boolean;
}

function assertObject(args: unknown): Record<string, unknown> {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolInputError("invalid_args", "arguments must be an object");
  }
  return args as Record<string, unknown>;
}

function rejectUnknown(rec: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(rec)) {
    if (!allowed.includes(key)) {
      throw new ToolInputError("invalid_args", `unknown argument: ${key}`);
    }
  }
}

function optionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError("invalid_args", `${key} must be a string`);
  }
  return value;
}

function parseCommon(
  rec: Record<string, unknown>,
  limits: ResolvedLimits,
): ParsedInvocation {
  const cwd = optionalString(rec, "cwd");
  const stdin = optionalString(rec, "stdin");
  let timeout: { timeoutMs: number; clamped: boolean };
  try {
    timeout = resolveTimeoutMs(rec.timeout_ms, limits);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid timeout_ms";
    throw new ToolInputError("invalid_args", message);
  }
  const parsed: ParsedInvocation = {
    timeoutMs: timeout.timeoutMs,
    timeoutClamped: timeout.clamped,
  };
  if (cwd != null) parsed.cwd = cwd;
  if (stdin != null) parsed.stdin = stdin;
  return parsed;
}

export interface ParsedShellArgs extends ParsedInvocation {
  command: string;
}

export function parseShellArgs(args: unknown, limits: ResolvedLimits): ParsedShellArgs {
  const rec = assertObject(args);
  rejectUnknown(rec, ["command", "cwd", "timeout_ms", "stdin"]);
  if (typeof rec.command !== "string" || rec.command.trim() === "") {
    throw new ToolInputError("invalid_args", "command must be a non-empty string");
  }
  if (Buffer.byteLength(rec.command) > limits.maxCommandBytes) {
    throw new ToolInputError("invalid_args", "command is too long");
  }
  return { command: rec.command, ...parseCommon(rec, limits) };
}

export interface ParsedCodeArgs extends ParsedInvocation {
  language: CodeLanguage;
  code: string;
}

export function parseCodeArgs(
  args: unknown,
  limits: ResolvedLimits,
  languages: readonly CodeLanguage[],
): ParsedCodeArgs {
  const rec = assertObject(args);
  rejectUnknown(rec, ["language", "code", "cwd", "timeout_ms", "stdin"]);
  if (typeof rec.language !== "string" || !CODE_LANGUAGES.includes(rec.language as CodeLanguage)) {
    throw new ToolInputError(
      "invalid_args",
      `language must be one of: ${CODE_LANGUAGES.join(", ")}`,
    );
  }
  const language = rec.language as CodeLanguage;
  if (!languages.includes(language)) {
    throw new ToolInputError("invalid_args", `language is not enabled: ${language}`);
  }
  if (typeof rec.code !== "string" || rec.code.trim() === "") {
    throw new ToolInputError("invalid_args", "code must be a non-empty string");
  }
  if (Buffer.byteLength(rec.code) > limits.maxCodeBytes) {
    throw new ToolInputError("invalid_args", "code is too long");
  }
  return { language, code: rec.code, ...parseCommon(rec, limits) };
}
