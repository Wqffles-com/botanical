import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createGitContributor } from "../src/github/git.ts";
import { createMemoryStore } from "../src/db/memory.ts";

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

let base: string;
let remoteRoot: string;
let workspace: string;

beforeAll(() => {
  if (!hasGit) return;
  base = mkdtempSync(path.join(tmpdir(), "botanical-git-"));
  remoteRoot = path.join(base, "remote");
  workspace = path.join(base, "workspace");
  mkdirSync(workspace, { recursive: true });
  const bare = path.join(remoteRoot, "octo", "garden.git");
  mkdirSync(bare, { recursive: true });
  sh(bare, "init", "--bare", "--initial-branch", "main");
  const seed = path.join(base, "seed");
  sh(base, "clone", bare, seed);
  writeFileSync(path.join(seed, "README.md"), "# Garden\n");
  sh(seed, "add", "README.md");
  sh(seed, "commit", "-m", "Plant the garden");
  sh(seed, "push", "origin", "main");
});

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

function tools() {
  const store = createMemoryStore({ encryptionKey: "test-encryption-key" });
  return createGitContributor(store, { webUrl: `file://${remoteRoot}` });
}

describe.skipIf(!hasGit)("git tools", () => {
  const ctx = () => ({ agentId: "agent-1", chatId: "chat", workspaceRoot: workspace });

  test("clone, commit, and push keep the git directory outside the agent's workspace", async () => {
    const git = tools();
    const cloned = await git.callTool("git_clone", { repo: "octo/garden" }, ctx());
    expect(cloned.isError).toBeFalsy();
    expect(cloned.content).toContain('"branch":"main"');

    const agentDir = path.join(workspace, "agents", "agent-1");
    const worktree = path.join(agentDir, "garden");
    expect(readFileSync(path.join(worktree, "README.md"), "utf8")).toBe("# Garden\n");
    const pointer = path.join(worktree, ".git");
    expect(lstatSync(pointer).isFile()).toBe(true);
    const gitDir = readFileSync(pointer, "utf8").replace(/^gitdir:\s*/, "").trim();
    expect(gitDir.startsWith(path.join(workspace, "git"))).toBe(true);
    expect(gitDir.startsWith(agentDir)).toBe(false);

    writeFileSync(path.join(worktree, "ferns.md"), "Water weekly.\n");
    const status = await git.callTool("git_status", { dir: "garden" }, ctx());
    expect(status.content).toContain("?? ferns.md");

    // An agent that rewrites the .git pointer cannot redirect the tools to a directory it controls.
    const planted = path.join(agentDir, "evil");
    mkdirSync(path.join(planted, "hooks"), { recursive: true });
    writeFileSync(path.join(planted, "hooks", "pre-commit"), "#!/bin/sh\ntouch \"$PWD/../pwned\"\n", { mode: 0o755 });
    writeFileSync(pointer, `gitdir: ${planted}\n`);

    const branch = await git.callTool("git_checkout", { dir: "garden", branch: "add-ferns", create: true }, ctx());
    expect(branch.isError).toBeFalsy();
    const commit = await git.callTool("git_commit", { dir: "garden", message: "Add fern care" }, ctx());
    expect(commit.isError).toBeFalsy();
    expect(commit.content).toContain("Add fern care");
    expect(existsSync(path.join(agentDir, "pwned"))).toBe(false);

    const again = await git.callTool("git_commit", { dir: "garden", message: "Nothing" }, ctx());
    expect(again.content).toBe("Nothing to commit.");

    const pushed = await git.callTool("git_push", { dir: "garden" }, ctx());
    expect(pushed.isError).toBeFalsy();
    const log = sh(path.join(remoteRoot, "octo", "garden.git"), "log", "--format=%s %an", "add-ferns");
    expect(log.split("\n")[0]).toBe("Add fern care Botanical agent");
  });

  test("git_init tracks files an agent made and refuses a foreign .git directory", async () => {
    const git = tools();
    const agentDir = path.join(workspace, "agents", "agent-1");
    mkdirSync(path.join(agentDir, "notes"), { recursive: true });
    writeFileSync(path.join(agentDir, "notes", "plan.md"), "Plan\n");
    const init = await git.callTool("git_init", { dir: "notes", repo: "octo/garden" }, ctx());
    expect(init.isError).toBeFalsy();
    const commit = await git.callTool("git_commit", { dir: "notes", message: "Notes" }, ctx());
    expect(commit.isError).toBeFalsy();
    const log = await git.callTool("git_log", { dir: "notes" }, ctx());
    expect(log.content).toContain("Notes");

    mkdirSync(path.join(agentDir, "other", ".git"), { recursive: true });
    const foreign = await git.callTool("git_init", { dir: "other" }, ctx());
    expect(foreign.isError).toBe(true);
    expect(foreign.content).toContain("own .git directory");
  });

  test("paths stay inside the agent's workspace and only managed repositories open", async () => {
    const git = tools();
    const escape = await git.callTool("git_status", { dir: "../../" }, ctx());
    expect(escape.isError).toBe(true);
    expect(escape.content).toContain("outside this agent's workspace");
    mkdirSync(path.join(workspace, "agents", "agent-1", "plain"), { recursive: true });
    const plain = await git.callTool("git_status", { dir: "plain" }, ctx());
    expect(plain.isError).toBe(true);
    expect(plain.content).toContain("git_clone or git_init");
    const branch = await git.callTool("git_checkout", { dir: "garden", branch: "--upload-pack=x" }, ctx());
    expect(branch.isError).toBe(true);
    const repo = await git.callTool("git_clone", { repo: "octo/garden/../x", dir: "x" }, ctx());
    expect(repo.isError).toBe(true);
  });
});
