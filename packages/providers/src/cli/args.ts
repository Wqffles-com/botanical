import type { CliName } from "./types.ts";

/**
 * Argv for a headless subscription CLI. The prompt is an argument, never
 * interpolated into a shell. Botanical tools are not passed — the CLI runs
 * its own tools in `cwd`.
 *
 * Grok uses `streaming-messages-json` plus `--include-partial-messages`
 * because that stream is Anthropic-style text deltas. ACP `streaming-json`
 * is still parsed if a binary emits it.
 */
export function buildCliArgs(input: { cli: CliName; prompt: string; cwd: string; model?: string }): string[] {
  const model = input.model?.trim() ?? "";
  switch (input.cli) {
    case "grok":
      return [
        "-p",
        input.prompt,
        "--output-format",
        "streaming-messages-json",
        "--include-partial-messages",
        "--always-approve",
        "--cwd",
        input.cwd,
        ...(model ? ["-m", model] : []),
      ];
    case "claude":
      return [
        "-p",
        input.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "bypassPermissions",
        "--add-dir",
        input.cwd,
        ...(model ? ["--model", model] : []),
      ];
    case "codex":
      return [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        input.cwd,
        ...(model ? ["-m", model] : []),
        "--",
        input.prompt,
      ];
    default: {
      const _never: never = input.cli;
      return _never;
    }
  }
}
