import type { CliName } from "./types.ts";

/**
 * Argv for a headless subscription CLI. The prompt is never an argument
 * (ARG_MAX). Grok reads `--prompt-file`. Claude Code reads stdin with `-p`.
 * Codex reads stdin when the prompt argument is `-`.
 *
 * Botanical tools are not embedded in argv. When `mcp` is set, each CLI is
 * pointed at one streamable-HTTP server named `botanical`:
 *
 * - Grok Build 1.0.40 has no `--mcp-config` (`grok --help`). It discovers
 *   `[mcp_servers.botanical]` from `./.grok/config.toml` in the cwd. The file
 *   is written by `prepareCliLaunch`, not by these flags.
 * - Claude Code: `--mcp-config` plus `--strict-mcp-config` so only that file
 *   is used, and `--allowedTools mcp__botanical__*` with bypassPermissions.
 *   https://code.claude.com/docs/en/cli-reference
 *   https://code.claude.com/docs/en/headless
 * - Codex: `codex exec -c mcp_servers.botanical.url=...` and
 *   `bearer_token_env_var` (streamable HTTP). The prompt `-` reads stdin.
 *   https://developers.openai.com/codex/cli/reference
 *   https://developers.openai.com/codex/noninteractive
 *   https://developers.openai.com/codex/mcp
 *
 * Claude Code reads its prompt as `--input-format stream-json` user messages,
 * so more messages can be written to stdin while it runs (steering). stdin is
 * closed once the CLI reports a `result`.
 *
 * Grok uses `streaming-messages-json` plus `--include-partial-messages`
 * because that stream is Anthropic-style text deltas. ACP `streaming-json`
 * is still parsed if a binary emits it.
 */
export interface CliArgInput {
  cli: CliName;
  cwd: string;
  model?: string;
  /** Grok only. Path of the 0600 prompt file. */
  promptFile?: string;
  /**
   * Per-run Botanical MCP endpoint. Omitted when the profile opts out
   * (`botanicalTools: false`). The bearer token itself is an env var, not an arg.
   */
  mcp?: { url: string; tokenEnv: string; configPath?: string };
}

export function buildCliArgs(input: CliArgInput): string[] {
  const model = input.model?.trim() ?? "";
  switch (input.cli) {
    case "grok":
      if (!input.promptFile) {
        throw new Error("grok requires --prompt-file; the prompt is not passed as an argument");
      }
      return [
        "--output-format",
        "streaming-messages-json",
        "--include-partial-messages",
        "--always-approve",
        "--cwd",
        input.cwd,
        "--prompt-file",
        input.promptFile,
        ...(model ? ["-m", model] : []),
      ];
    case "claude":
      return [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        input.cwd,
        ...(input.mcp?.configPath
          ? ["--mcp-config", input.mcp.configPath, "--strict-mcp-config", "--allowedTools", "mcp__botanical__*"]
          : []),
        ...(model ? ["--model", model] : []),
        "-p",
      ];
    case "codex":
      return [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        input.cwd,
        ...(input.mcp
          ? [
              "-c",
              `mcp_servers.botanical.url=${input.mcp.url}`,
              "-c",
              `mcp_servers.botanical.bearer_token_env_var=${input.mcp.tokenEnv}`,
            ]
          : []),
        ...(model ? ["-m", model] : []),
        "--",
        "-",
      ];
    default: {
      const _never: never = input.cli;
      return _never;
    }
  }
}
