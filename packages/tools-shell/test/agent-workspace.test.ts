import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ensureAgentWorkspace } from "@botanical/tools";
import { ToolInputError } from "../src/errors.ts";
import { resolveWorkspaceCwd } from "../src/sandbox/paths.ts";
import { checkShellSandbox } from "../src/sandbox/run.ts";
import { createCodeExecTool, createShellTool } from "../src/shell/tools.ts";
import { resolveShellOptions } from "../src/shell/options.ts";

const dirs: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("per-agent shell cwd", () => {
  test("defaults to the agent directory and rejects paths that leave it", async () => {
    const root = scratch("botanical-shell-root-");
    const outside = scratch("botanical-shell-out-");
    const agentDir = await ensureAgentWorkspace(root, "agent-a");
    mkdirSync(path.join(agentDir, "sub"));
    writeFileSync(path.join(agentDir, "mine.txt"), "mine");
    symlinkSync(outside, path.join(agentDir, "escape"));

    const home = resolveWorkspaceCwd(agentDir, undefined, { agentScope: true });
    expect(home.workspaceReal).toBe(realpathSync(agentDir));
    expect(home.jailCwd).toBe("/workspace");
    expect(resolveWorkspaceCwd(agentDir, "/", { agentScope: true }).jailCwd).toBe("/workspace");
    expect(resolveWorkspaceCwd(agentDir, ".", { agentScope: true }).jailCwd).toBe("/workspace");
    expect(resolveWorkspaceCwd(agentDir, "sub", { agentScope: true }).jailCwd).toBe("/workspace/sub");

    expect(() => resolveWorkspaceCwd(agentDir, "..", { agentScope: true })).toThrow(ToolInputError);
    expect(() => resolveWorkspaceCwd(agentDir, "..", { agentScope: true })).toThrow(
      'path ".." is outside this agent\'s workspace',
    );
    expect(() => resolveWorkspaceCwd(agentDir, outside, { agentScope: true })).toThrow(
      `path ${JSON.stringify(outside)} is outside this agent's workspace`,
    );
    expect(() => resolveWorkspaceCwd(agentDir, "escape", { agentScope: true })).toThrow(
      'path "escape" is outside this agent\'s workspace',
    );
  });

  test("shell and code_exec use the calling agent's directory as cwd", async () => {
    const root = scratch("botanical-shell-root-");
    const options = resolveShellOptions({ network: false });
    const shell = createShellTool(options);
    const code = createCodeExecTool(options);
    const ctxA = { workspaceRoot: root, agentId: "agent-a" };
    const agentDir = await ensureAgentWorkspace(root, "agent-a");
    const otherDir = await ensureAgentWorkspace(root, "agent-b");
    mkdirSync(path.join(agentDir, "sub"));
    writeFileSync(path.join(agentDir, "mine.txt"), "mine\n");
    writeFileSync(path.join(otherDir, "theirs.txt"), "theirs\n");

    const escaped = await shell.execute({ command: "pwd", cwd: ".." }, ctxA);
    expect(escaped.ok).toBe(false);
    expect(escaped.content).toContain('path ".." is outside this agent\'s workspace');

    const absolute = await shell.execute({ command: "pwd", cwd: otherDir }, ctxA);
    expect(absolute.ok).toBe(false);
    expect(absolute.content).toContain("outside this agent's workspace");
    expect(absolute.content).toContain(otherDir);

    symlinkSync(otherDir, path.join(agentDir, "escape"));
    const linked = await shell.execute({ command: "pwd", cwd: "escape" }, ctxA);
    expect(linked.ok).toBe(false);
    expect(linked.content).toContain('path "escape" is outside this agent\'s workspace');

    const codeEscaped = await code.execute(
      { language: "javascript", code: "console.log(1)", cwd: ".." },
      ctxA,
    );
    expect(codeEscaped.ok).toBe(false);
    expect(codeEscaped.content).toContain('path ".." is outside this agent\'s workspace');

    const nested = await shell.execute({ command: "pwd && ls", cwd: "sub" }, ctxA);
    expect(nested.content).not.toContain("cwd does not exist");
    expect(nested.content).not.toContain("outside this agent's workspace");

    if (!checkShellSandbox().ok) return;

    expect(nested.ok).toBe(true);
    expect(nested.content).toContain("cwd: /workspace/sub");

    const listed = await shell.execute({ command: "pwd && ls" }, ctxA);
    expect(listed.ok).toBe(true);
    expect(listed.content).toContain("cwd: /workspace");
    expect(listed.content).toContain("mine.txt");
    expect(listed.content).not.toContain("theirs.txt");
    expect(listed.content).not.toContain(root);
  }, 30_000);
});
