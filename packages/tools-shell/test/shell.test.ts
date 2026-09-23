import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createShellTools } from "../src/index.ts";
import type { ToolDefinition } from "../src/types.ts";

const dirs: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function shell(options?: Parameters<typeof createShellTools>[0]): ToolDefinition {
  const tools = createShellTools({ network: false, ...options });
  const tool = tools.find((item) => item.name === "shell");
  if (!tool) throw new Error("shell tool missing");
  return tool;
}

describe("shell tool", () => {
  test("runs a command inside the workspace and returns stdout", async () => {
    const root = scratch("botanical-ws-");
    writeFileSync(path.join(root, "note.txt"), "hello-from-workspace\n");
    const result = await shell().execute({ command: "cat note.txt && pwd" }, { workspaceRoot: root });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("hello-from-workspace");
    expect(result.content).toContain("cwd: /workspace");
    expect(result.content).toContain("/workspace\n");
    expect(result.content).not.toContain(root);
  }, 20_000);

  test("writes files as the host user and honors a relative cwd", async () => {
    const root = scratch("botanical-ws-");
    const sub = path.join(root, "sub");
    await shell().execute(
      { command: "mkdir -p sub && echo hi > sub/owned.txt" },
      { workspaceRoot: root },
    );
    const stat = statSync(path.join(sub, "owned.txt"));
    const getuid = process.getuid;
    if (!getuid) throw new Error("getuid is unavailable");
    expect(stat.uid).toBe(getuid());
    expect(readFileSync(path.join(sub, "owned.txt"), "utf8")).toBe("hi\n");

    const nested = await shell().execute(
      { command: "pwd", cwd: "sub" },
      { workspaceRoot: root },
    );
    expect(nested.ok).toBe(true);
    expect(nested.content).toContain("cwd: /workspace/sub");
    expect(nested.content).toContain("/workspace/sub");
  }, 20_000);

  test("cannot read a host file outside the workspace, even through a symlink", async () => {
    const root = scratch("botanical-ws-");
    const outside = scratch("botanical-out-");
    const sentinel = path.join(outside, "sentinel.txt");
    const marker = "SENTINEL_SECRET_VALUE";
    writeFileSync(sentinel, marker);
    symlinkSync(sentinel, path.join(root, "leak"));
    symlinkSync(outside, path.join(root, "outside-link"));

    const direct = await shell().execute(
      {
        command:
          "cat leak /etc/passwd; touch /usr/bin/botanical-pwn-test; echo TOUCH:$?; ls /home >/dev/null 2>&1; echo HOME_LS:$?",
      },
      { workspaceRoot: root },
    );
    expect(direct.content).not.toContain(marker);
    expect(direct.content).not.toContain(root);
    expect(direct.content).not.toContain(outside);
    expect(direct.content).toContain("root:x:0:0:root:/workspace:/bin/sh");
    expect(direct.content).not.toContain("box:");
    expect(direct.content).toContain("TOUCH:");
    expect(direct.content).not.toContain("TOUCH:0");
    expect(direct.content).toContain("HOME_LS:");
    expect(direct.content).not.toContain("HOME_LS:0");
    expect(existsSync("/usr/bin/botanical-pwn-test")).toBe(false);

    const linkedCwd = await shell().execute(
      { command: "pwd", cwd: "outside-link" },
      { workspaceRoot: root },
    );
    expect(linkedCwd.ok).toBe(false);
    expect(linkedCwd.content).toContain("escapes the workspace");
  }, 20_000);

  test("does not receive parent secrets and rewrites HOME", async () => {
    const root = scratch("botanical-ws-");
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://keep-me-secret";
    try {
      const result = await shell({ extraEnv: { MY_FLAG: "pine" } }).execute(
        {
          command: 'printf "db=%s\\nhome=%s\\nflag=%s\\nhost=%s\\n" "$DATABASE_URL" "$HOME" "$MY_FLAG" "$BOTANICAL_WORKSPACE_HOST"',
        },
        { workspaceRoot: root },
      );
      expect(result.ok).toBe(true);
      expect(result.content).toContain("db=\n");
      expect(result.content).toContain("home=/workspace\n");
      expect(result.content).toContain("flag=pine\n");
      expect(result.content).toContain("host=\n");
      expect(result.content).not.toContain("keep-me-secret");
      expect(result.content).not.toContain(root);
    } finally {
      if (previous == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }, 20_000);

  test("kills the process group when the timeout fires", async () => {
    const root = scratch("botanical-ws-");
    const started = Date.now();
    const result = await shell().execute(
      { command: "sleep 30", timeout_ms: 1500 },
      { workspaceRoot: root },
    );
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("timed out");
    expect(result.content).toContain("timed_out: true");
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  test("abort signal kills the command", async () => {
    const root = scratch("botanical-ws-");
    const controller = new AbortController();
    const pending = shell().execute(
      { command: "sleep 30", timeout_ms: 30_000 },
      { workspaceRoot: root, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  test("caps combined stdout and stderr", async () => {
    const root = scratch("botanical-ws-");
    const result = await shell({ maxOutputBytes: 64 }).execute(
      { command: "python3 -c 'print(\"Y\" * 200000)'" },
      { workspaceRoot: root },
    );
    expect(result.truncated).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("output truncated");
    const stdout = result.content.split("--- stdout ---")[1] ?? "";
    expect(stdout.length).toBeLessThan(5_000);
  }, 20_000);

  test("allowlist mode runs echo and refuses a pipe", async () => {
    const root = scratch("botanical-ws-");
    const tool = shell({ shellAllowlist: ["echo"] });
    const ok = await tool.execute({ command: "echo allowlisted" }, { workspaceRoot: root });
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("allowlisted");
    const denied = await tool.execute({ command: "echo hi | wc -c" }, { workspaceRoot: root });
    expect(denied.ok).toBe(false);
    expect(denied.content).toContain("metacharacters");
  }, 20_000);

  test("rejects a missing workspace and an oversize timeout is clamped", async () => {
    const missing = await shell().execute({ command: "pwd" }, { workspaceRoot: "/tmp/botanical-does-not-exist-xyz" });
    expect(missing.ok).toBe(false);
    expect(missing.content).toContain("workspace does not exist");

    const root = scratch("botanical-ws-");
    const clamped = await shell({ maxTimeoutMs: 1000 }).execute(
      { command: "pwd", timeout_ms: 99_999 },
      { workspaceRoot: root },
    );
    expect(clamped.ok).toBe(true);
    expect(clamped.content).toContain("timeout_ms: 1000 (clamped)");
  }, 20_000);
});
