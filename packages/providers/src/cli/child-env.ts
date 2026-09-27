import type { CliName } from "./types.ts";

/** Botanical and database secrets. Never given to a coding-agent child. */
const ALWAYS_STRIP = new Set([
  "BOTANICAL_PASSWORD",
  "BOTANICAL_PASSWORD_HASH",
  "BOTANICAL_PASSWORD_FILE",
  "BOTANICAL_PASSCODE",
  "BOTANICAL_PASSCODE_FILE",
  "BOTANICAL_SESSION_SECRET",
  "BOTANICAL_SESSION_SECRET_FILE",
  "DATABASE_URL",
  "DATABASE_URL_FILE",
  "POSTGRES_PASSWORD",
  "PGPASSWORD",
  "BOTANICAL_MCP_SERVERS",
]);

/** Keys a CLI may use for its own auth. Every other `*_API_KEY` is removed. */
const AUTH_KEYS: Record<CliName, ReadonlySet<string>> = {
  grok: new Set(["XAI_API_KEY"]),
  claude: new Set(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
  codex: new Set(["OPENAI_API_KEY", "CODEX_API_KEY"]),
};

/**
 * Copy `env` for a coding-agent child.
 * Empty and whitespace-only values are omitted so Compose's blank
 * `XAI_API_KEY=` does not override a device login. Botanical passwords,
 * the database URL, and provider keys this CLI does not use are omitted.
 * PATH, HOME, TMPDIR, LANG, proxy variables, and `USE_BUILTIN_RIPGREP` stay.
 */
export function scrubCliEnv(env: Record<string, string | undefined>, cli: CliName): Record<string, string> {
  const allowed = AUTH_KEYS[cli];
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (ALWAYS_STRIP.has(key)) continue;
    if (key === "CLAUDE_CODE_OAUTH_TOKEN" && !allowed.has(key)) continue;
    if (key.endsWith("_API_KEY") && !allowed.has(key)) continue;
    if (key.endsWith("_API_KEY_FILE") && !allowed.has(key)) continue;
    next[key] = value;
  }
  return next;
}

/** Env for install, login, and `login status` / `auth status` / `--version`. */
export function installChildEnv(
  env: Record<string, string | undefined>,
  home: string,
  root: string,
  cli: CliName,
): Record<string, string> {
  const next = scrubCliEnv(env, cli);
  next.HOME = home;
  next.BOTANICAL_CLI_HOME = home;
  next.BOTANICAL_CLI_BIN = root;
  const dir = `${root}/bin`;
  const parts = (next.PATH ?? "").split(":").filter((part) => part.length > 0);
  if (!parts.includes(dir)) next.PATH = [dir, ...parts].join(":");
  return next;
}

/**
 * Env for a chat turn. `extra` is applied last so the per-run MCP token
 * and `GROK_FOLDER_TRUST` are not dropped.
 */
export function runCliChildEnv(
  env: Record<string, string | undefined> | undefined,
  extra: Record<string, string>,
  cli: CliName,
): Record<string, string> {
  const source = env ?? process.env;
  const next = scrubCliEnv(source, cli);
  const home = source.BOTANICAL_CLI_HOME?.trim() || (typeof source.HOME === "string" ? source.HOME.trim() : "");
  if (home) next.HOME = home;
  const binRoot = source.BOTANICAL_CLI_BIN?.trim();
  if (binRoot) {
    const dir = `${binRoot}/bin`;
    const parts = (next.PATH ?? "").split(":").filter((part) => part.length > 0);
    if (!parts.includes(dir)) next.PATH = [dir, ...parts].join(":");
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value.trim() !== "") next[key] = value;
  }
  return next;
}
