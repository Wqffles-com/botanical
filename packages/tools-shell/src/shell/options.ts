import { ToolInputError } from "../errors.ts";
import { assertSafeExtraEnv } from "../sandbox/env.ts";
import {
  DEFAULT_MAX_CODE_BYTES,
  DEFAULT_MAX_COMMAND_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_STDIN_BYTES,
  DEFAULT_NOFILE,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  clampInt,
  readPositiveIntEnv,
  type ResolvedLimits,
} from "../sandbox/limits.ts";

export const CODE_LANGUAGES = ["javascript", "typescript", "python"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export interface ShellToolsOptions {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  maxStdinBytes?: number;
  maxCodeBytes?: number;
  maxCommandBytes?: number;
  /** RLIMIT_FSIZE for the jailed process. */
  maxFileBytes?: number;
  /** RLIMIT_NOFILE for the jailed process. */
  nofile?: number;
  /**
   * Host network inside the jail. Default **false** (unshare `--net`).
   * Set true, or `BOTANICAL_SHELL_NETWORK=1`, to allow outbound network.
   * The model cannot override this.
   */
  network?: boolean;
  /**
   * Operator-trusted variables merged into the scrubbed environment.
   * `PATH`, `HOME`, `LD_*`, and other loader/interpreter controls are rejected.
   */
  extraEnv?: Readonly<Record<string, string>>;
  /**
   * When set, `shell` execs a single allowlisted basename with arguments.
   * Shell metacharacters are rejected. Unset means full `/bin/sh -c`.
   * `BOTANICAL_SHELL_ALLOWLIST=echo,git` is the env form.
   */
  shellAllowlist?: readonly string[];
  /** Languages `code_exec` accepts. Default: javascript, typescript, python. */
  languages?: readonly CodeLanguage[];
}

export interface ResolvedShellOptions {
  limits: ResolvedLimits;
  network: boolean;
  extraEnv?: Readonly<Record<string, string>>;
  shellAllowlist?: readonly string[];
  languages: readonly CodeLanguage[];
}

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return undefined;
}

function normalizeAllowlist(list: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const entry of list) {
    const bin = entry.trim();
    if (bin === "") continue;
    if (!/^[A-Za-z0-9._+-]+$/.test(bin)) {
      throw new ToolInputError("invalid_allowlist", `invalid shell allowlist entry: ${bin}`);
    }
    out.push(bin);
  }
  return out;
}

function positive(name: string, value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ToolInputError("invalid_options", `${name} must be a positive integer`);
  }
  return value;
}

/** Explicit options win. Otherwise the matching `BOTANICAL_SHELL_*` env var, then the default. */
export function resolveShellOptions(options: ShellToolsOptions = {}): ResolvedShellOptions {
  const maxTimeoutMs = clampInt(
    positive(
      "maxTimeoutMs",
      options.maxTimeoutMs ?? readPositiveIntEnv("BOTANICAL_SHELL_MAX_TIMEOUT_MS"),
      MAX_TIMEOUT_MS,
    ),
    MIN_TIMEOUT_MS,
    10 * 60 * 1000,
  );
  const defaultTimeoutMs = clampInt(
    positive(
      "defaultTimeoutMs",
      options.defaultTimeoutMs ?? readPositiveIntEnv("BOTANICAL_SHELL_DEFAULT_TIMEOUT_MS"),
      DEFAULT_TIMEOUT_MS,
    ),
    MIN_TIMEOUT_MS,
    maxTimeoutMs,
  );

  const limits: ResolvedLimits = {
    defaultTimeoutMs,
    maxTimeoutMs,
    maxOutputBytes: positive(
      "maxOutputBytes",
      options.maxOutputBytes ?? readPositiveIntEnv("BOTANICAL_SHELL_MAX_OUTPUT_BYTES"),
      DEFAULT_MAX_OUTPUT_BYTES,
    ),
    maxStdinBytes: positive("maxStdinBytes", options.maxStdinBytes, DEFAULT_MAX_STDIN_BYTES),
    maxCodeBytes: positive("maxCodeBytes", options.maxCodeBytes, DEFAULT_MAX_CODE_BYTES),
    maxCommandBytes: positive("maxCommandBytes", options.maxCommandBytes, DEFAULT_MAX_COMMAND_BYTES),
    maxFileBytes: positive("maxFileBytes", options.maxFileBytes, DEFAULT_MAX_FILE_BYTES),
    nofile: positive("nofile", options.nofile, DEFAULT_NOFILE),
  };

  let shellAllowlist: readonly string[] | undefined;
  if (options.shellAllowlist) {
    shellAllowlist = normalizeAllowlist(options.shellAllowlist);
  } else if (process.env.BOTANICAL_SHELL_ALLOWLIST != null && process.env.BOTANICAL_SHELL_ALLOWLIST.trim() !== "") {
    shellAllowlist = normalizeAllowlist(process.env.BOTANICAL_SHELL_ALLOWLIST.split(","));
  }

  const languages = options.languages ?? CODE_LANGUAGES;
  for (const language of languages) {
    if (!CODE_LANGUAGES.includes(language)) {
      throw new ToolInputError("invalid_options", `unsupported code_exec language: ${language}`);
    }
  }

  const resolved: ResolvedShellOptions = {
    limits,
    network: options.network ?? envFlag("BOTANICAL_SHELL_NETWORK") ?? false,
    languages,
  };
  if (options.extraEnv) {
    assertSafeExtraEnv(options.extraEnv);
    resolved.extraEnv = options.extraEnv;
  }
  if (shellAllowlist) resolved.shellAllowlist = shellAllowlist;
  return resolved;
}
