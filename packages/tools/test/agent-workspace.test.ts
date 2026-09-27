import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentWorkspacePath,
  createFileTools,
  createToolRegistry,
  sanitizeAgentId,
  type ToolRegistry,
} from "../src/index.ts";

const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "botanical-agent-ws-"));
  cleanups.push(root);
  return root;
}

function registryFor(root: string): ToolRegistry {
  return createToolRegistry(createFileTools({ workspaceRoot: root }));
}

const agentA = "agent-a";
const agentB = "agent-b";

describe("per-agent workspace", () => {
  test("sanitizes agent ids the same way the server cwd helper does", () => {
    expect(sanitizeAgentId("agent-a")).toBe("agent-a");
    expect(sanitizeAgentId("a/b")).toBe("a_b");
    expect(sanitizeAgentId("")).toBe("agent");
    expect(sanitizeAgentId("../etc")).toBe("___etc");
    const root = "/data/workspace";
    expect(agentWorkspacePath(root, "agent-a")).toBe(path.join(root, "agents", "agent-a"));
  });

  test("agent A can read, write, and list only inside its own directory", async () => {
    const root = await makeRoot();
    const registry = registryFor(root);
    const ctxA = { agentId: agentA, workspaceRoot: root };
    const ctxB = { agentId: agentB, workspaceRoot: root };

    const wrote = await registry.execute(
      "file_write",
      { path: "notes/plot.txt", content: "from-a\n" },
      ctxA,
    );
    expect(wrote.ok).toBe(true);
    expect(wrote.content).toContain("notes/plot.txt");

    const read = await registry.execute("file_read", { path: "notes/plot.txt" }, ctxA);
    expect(read.ok).toBe(true);
    expect(read.content).toBe("from-a\n");

    const listed = await registry.execute("file_list", { path: "." }, ctxA);
    expect(listed.ok).toBe(true);
    expect(listed.content).toContain("notes");
    expect(listed.content).not.toContain("agent-b");

    const slash = await registry.execute("file_list", { path: "/", recursive: true }, ctxA);
    expect(slash.ok).toBe(true);
    expect(slash.content).toContain("plot.txt");

    const onDisk = await readFile(path.join(agentWorkspacePath(root, agentA), "notes/plot.txt"), "utf8");
    expect(onDisk).toBe("from-a\n");

    const beeRead = await registry.execute("file_read", { path: "notes/plot.txt" }, ctxB);
    expect(beeRead.ok).toBe(false);
    expect(beeRead.content).not.toContain("from-a");

    const beeList = await registry.execute("file_list", { path: ".", recursive: true }, ctxB);
    expect(beeList.ok).toBe(true);
    expect(beeList.content).not.toContain("plot.txt");
    expect(beeList.content).not.toContain("from-a");
  });

  test("rejects .., absolute paths, and symlinks that leave the agent directory", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(path.join(tmpdir(), "botanical-agent-out-"));
    cleanups.push(outside);
    await writeFile(path.join(outside, "secret.txt"), "top-secret");
    const registry = registryFor(root);
    const ctxA = { agentId: agentA, workspaceRoot: root };
    const ctxB = { agentId: agentB, workspaceRoot: root };

    await registry.execute("file_write", { path: "secret.txt", content: "bee-secret" }, ctxB);
    const beeFile = path.join(agentWorkspacePath(root, agentB), "secret.txt");
    const agentDir = agentWorkspacePath(root, agentA);
    await mkdir(agentDir, { recursive: true });
    await symlink(beeFile, path.join(agentDir, "leak"));
    await symlink(outside, path.join(agentDir, "out"));

    const cases = [
      "../agent-b/secret.txt",
      beeFile,
      path.join(outside, "secret.txt"),
      "leak",
      "out/secret.txt",
    ];
    for (const userPath of cases) {
      const result = await registry.execute("file_read", { path: userPath }, ctxA);
      expect(result.ok).toBe(false);
      expect(result.content).toBe(`path ${JSON.stringify(userPath)} is outside this agent's workspace`);
      expect(result.content).not.toContain("bee-secret");
      expect(result.content).not.toContain("top-secret");
    }

    const wrote = await registry.execute(
      "file_write",
      { path: "../agent-b/pwned.txt", content: "nope" },
      ctxA,
    );
    expect(wrote.ok).toBe(false);
    expect(wrote.content).toContain('path "../agent-b/pwned.txt" is outside this agent\'s workspace');
    await expect(lstat(path.join(agentWorkspacePath(root, agentB), "pwned.txt"))).rejects.toThrow();

    const throughLink = await registry.execute(
      "file_write",
      { path: "out/brand-new.txt", content: "pwned" },
      ctxA,
    );
    expect(throughLink.ok).toBe(false);
    expect(throughLink.content).toBe(
      `path "out/brand-new.txt" is outside this agent's workspace`,
    );
    await expect(lstat(path.join(outside, "brand-new.txt"))).rejects.toThrow();

    const nested = await registry.execute(
      "file_write",
      { path: "out/missing/file.txt", content: "pwned" },
      ctxA,
    );
    expect(nested.ok).toBe(false);
    expect(nested.content).toContain("outside this agent's workspace");
    await expect(lstat(path.join(outside, "missing"))).rejects.toThrow();
  });

  test("a missing write target whose parent stays inside the agent directory is created there", async () => {
    const root = await makeRoot();
    const registry = registryFor(root);
    const ctxA = { agentId: agentA, workspaceRoot: root };
    const wrote = await registry.execute(
      "file_write",
      { path: "fresh/dir/note.txt", content: "inside" },
      ctxA,
    );
    expect(wrote.ok).toBe(true);
    const file = path.join(agentWorkspacePath(root, agentA), "fresh/dir/note.txt");
    expect(await readFile(file, "utf8")).toBe("inside");
    await mkdir(path.join(root, "agents", agentB), { recursive: true });
    expect(await readFile(file, "utf8")).toBe("inside");
  });
});
