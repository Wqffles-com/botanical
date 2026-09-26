import { ToolInputError } from "../errors.ts";

/**
 * Fixed PATH inside the jail. The parent process PATH is never copied:
 * a poisoned PATH is a common way to run unexpected binaries.
 */
export const FIXED_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Operator `extraEnv` keys that can change how a binary starts, or that
 * the jail script uses as control channels. Always rejected.
 */
const BLOCKED_EXACT = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "LD_BIND_NOW",
  "LD_DEBUG",
  "LD_PROFILE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "BUN_OPTIONS",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONINSPECT",
  "PYTHONEXECUTABLE",
  "BASH_ENV",
  "ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "GCONV_PATH",
  "IFS",
  "SSLKEYLOGFILE",
  "BOTANICAL_JAIL_ROOT",
  "BOTANICAL_WORKSPACE_HOST",
  "BOTANICAL_JAIL_CWD",
  "BOTANICAL_SCRATCH_HOST",
  "BOTANICAL_WORKSPACE",
  "BOTANICAL_SANDBOX",
]);

const BLOCKED_PREFIXES = ["LD_", "DYLD_", "BASH_FUNC_"];

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeExtraEnv(extra: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (!ENV_KEY.test(key) || BLOCKED_EXACT.has(key) || BLOCKED_PREFIXES.some((p) => key.startsWith(p))) {
      throw new ToolInputError(
        "unsafe_env",
        `refusing to inject environment variable ${key}`,
      );
    }
    if (value.includes("\0")) {
      throw new ToolInputError("unsafe_env", `environment value for ${key} contains NUL`);
    }
  }
}

/**
 * Build a fresh environment. Nothing is copied from `process.env`.
 * `HOME` is the jail path `/workspace`, not the host home directory.
 */
export function scrubEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
  if (extra) assertSafeExtraEnv(extra);
  const env: Record<string, string> = {
    PATH: FIXED_PATH,
    HOME: "/workspace",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONSAFEPATH: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    HISTFILE: "/dev/null",
    HISTSIZE: "0",
    XDG_CONFIG_HOME: "/tmp",
    XDG_CACHE_HOME: "/tmp",
    XDG_DATA_HOME: "/tmp",
    BOTANICAL_SANDBOX: "namespace",
    BOTANICAL_WORKSPACE: "/workspace",
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }
  return env;
}
