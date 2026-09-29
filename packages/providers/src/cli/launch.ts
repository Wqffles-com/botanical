import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCliArgs } from "./args.ts";
import type { CliName } from "./types.ts";

/**
 * Env var the child CLI expands into the Botanical MCP `Authorization` header.
 * The token is not written into the config file.
 *
 * Grok Build 1.0.40 user guide (`07-mcp-servers.md`, shipped with the binary)
 * expands `${VAR}` in `[mcp_servers.*]` url, command, args, env, and headers.
 * `grok inspect` in a temp dir (2026-09-27) shows `[mcp_servers.botanical]`
 * from `./.grok/config.toml` is discovered; inspect does not print header
 * values, so the file is also mode 0600. Claude Code expands the same
 * `${VAR}` form in `--mcp-config` JSON:
 * https://code.claude.com/docs/en/mcp
 * Codex reads the bearer from `bearer_token_env_var` and does not need a file:
 * https://developers.openai.com/codex/mcp
 */
export const CLI_MCP_TOKEN_ENV = "BOTANICAL_MCP_TOKEN";

export const CLI_MCP_SERVER_NAME = "botanical";

/**
 * Grok only starts project-scoped (`./.grok/config.toml`) MCP servers in a
 * trusted folder (`grok mcp doctor`: "repo-local (project-scoped) server not
 * started for an untrusted folder"). Agent folders are never in the user's
 * trust store, and `--trust` would persist a grant into the CLI home
 * (`~/.grok/trusted_folders.toml`). `GROK_FOLDER_TRUST=0` ungates folder
 * trust for this child process only (user guide 10-hooks.md). The CLI already
 * runs with `--always-approve` in that folder, so this adds no new capability.
 */
export const GROK_FOLDER_TRUST_ENV = { GROK_FOLDER_TRUST: "0" } as const;

/**
 * Claude Code defers MCP tools behind `ToolSearch` by default: the model sees
 * only `mcp__botanical__*` names and must load each schema before calling it.
 * Headless turns often skip that step and report the tool as unavailable
 * (issue #69). Botanical exposes a small catalog, so load it up front.
 * https://code.claude.com/docs/en/mcp (`ENABLE_TOOL_SEARCH`)
 */
export const CLAUDE_TOOL_SEARCH_ENV = { ENABLE_TOOL_SEARCH: "false" } as const;

export interface CliMcpTarget {
  url: string;
  token: string;
}

export interface CliSpawnPlan {
  args: string[];
  /** Written to the child's stdin, then the stream is closed. Undefined for Grok. */
  stdin?: string;
  /** Overlay on the child environment. Never assigned onto `process.env`. */
  env: Record<string, string>;
  cleanup(): void;
}

/**
 * Prompt file plus the per-CLI MCP config, both removed by `cleanup`.
 * Grok's project config is `cwd/.grok/config.toml`. An existing file is
 * snapshotted and restored, including when it already defined `botanical`.
 * `.mcp.json` is never written. Claude's `--mcp-config` file lives in the
 * temp dir. Codex passes the URL on `-c` and the token only via the env var.
 */
export function prepareCliLaunch(input: {
  cli: CliName;
  cwd: string;
  prompt: string;
  model?: string;
  mcp?: CliMcpTarget;
}): CliSpawnPlan {
  const cleanups: Array<() => void> = [];
  try {
    const promptFile = input.cli === "grok" ? writePromptFile(input.prompt, cleanups) : undefined;
    const claudeConfig = input.cli === "claude" && input.mcp ? writeClaudeConfig(input.mcp, cleanups) : undefined;
    if (input.cli === "grok" && input.mcp) writeGrokConfig(input.cwd, input.mcp, cleanups);
    const args = buildCliArgs({
      cli: input.cli,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(promptFile ? { promptFile } : {}),
      ...(input.mcp
        ? {
            mcp: {
              url: input.mcp.url,
              tokenEnv: CLI_MCP_TOKEN_ENV,
              ...(claudeConfig ? { configPath: claudeConfig } : {}),
            },
          }
        : {}),
    });
    return {
      args,
      ...(input.cli === "grok" ? {} : { stdin: input.prompt }),
      env: input.mcp
        ? {
            [CLI_MCP_TOKEN_ENV]: input.mcp.token,
            ...(input.cli === "grok" ? GROK_FOLDER_TRUST_ENV : {}),
            ...(input.cli === "claude" ? CLAUDE_TOOL_SEARCH_ENV : {}),
          }
        : {},
      cleanup() {
        for (const fn of cleanups.reverse()) fn();
      },
    };
  } catch (error) {
    for (const fn of cleanups.reverse()) fn();
    throw error;
  }
}

function writePromptFile(prompt: string, cleanups: Array<() => void>): string {
  const path = join(tmpdir(), `botanical-cli-prompt-${randomBytes(12).toString("hex")}.txt`);
  writeFileSync(path, prompt, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  cleanups.push(() => rmQuiet(path));
  return path;
}

function writeClaudeConfig(mcp: CliMcpTarget, cleanups: Array<() => void>): string {
  const path = join(tmpdir(), `botanical-cli-mcp-${randomBytes(12).toString("hex")}.json`);
  const body = `${JSON.stringify(
    {
      mcpServers: {
        [CLI_MCP_SERVER_NAME]: {
          type: "http",
          url: mcp.url,
          headers: { Authorization: `Bearer \${${CLI_MCP_TOKEN_ENV}}` },
        },
      },
    },
    null,
    2,
  )}\n`;
  writeFileSync(path, body, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  cleanups.push(() => rmQuiet(path));
  return path;
}

/**
 * Merge `[mcp_servers.botanical]` into the project config. A pre-existing
 * file is restored byte for byte, mode included. `.mcp.json` is left alone
 * because Grok also reads it and a higher-priority config.toml entry wins
 * (user guide 07-mcp-servers.md; confirmed with `grok inspect` 1.0.40).
 */
function writeGrokConfig(cwd: string, mcp: CliMcpTarget, cleanups: Array<() => void>): void {
  const dir = join(cwd, ".grok");
  const path = join(dir, "config.toml");
  const dirExisted = exists(dir);
  const fileExisted = exists(path);
  const previous = fileExisted ? readFileSync(path) : undefined;
  const previousMode = fileExisted ? statSync(path).mode & 0o777 : undefined;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = previous ? withoutBotanicalTables(previous.toString("utf8")) : "";
  const separator = base.trim().length > 0 && !base.endsWith("\n") ? "\n" : base.length > 0 ? "" : "";
  const next = `${base}${separator}${grokBotanicalToml(mcp.url)}`;
  writeFileSync(path, next, { mode: 0o600 });
  chmodSync(path, 0o600);
  cleanups.push(() => {
    if (!fileExisted) {
      rmQuiet(path);
      if (!dirExisted) rmDirQuiet(dir);
      return;
    }
    if (previous) writeFileSync(path, previous);
    if (previousMode !== undefined) chmodSync(path, previousMode);
  });
}

export function grokBotanicalToml(url: string): string {
  return `[mcp_servers.${CLI_MCP_SERVER_NAME}]
url = ${tomlString(url)}
enabled = true

[mcp_servers.${CLI_MCP_SERVER_NAME}.headers]
Authorization = "Bearer \${${CLI_MCP_TOKEN_ENV}}"
`;
}

function withoutBotanicalTables(toml: string): string {
  const lines = toml.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const table = /^\[([^\]]+)\]$/.exec(trimmed);
    if (table) {
      const name = table[1] ?? "";
      skipping = name === `mcp_servers.${CLI_MCP_SERVER_NAME}` || name.startsWith(`mcp_servers.${CLI_MCP_SERVER_NAME}.`);
    }
    if (skipping) continue;
    if (trimmed.startsWith(`mcp_servers.${CLI_MCP_SERVER_NAME}.`) || trimmed.startsWith(`mcp_servers.${CLI_MCP_SERVER_NAME} `)) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function rmQuiet(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // already gone
  }
}

function rmDirQuiet(path: string): void {
  try {
    rmdirSync(path);
  } catch {
    // not empty, or already gone
  }
}
