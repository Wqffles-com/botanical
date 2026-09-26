import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function codeExec(): ToolDefinition {
  const tool = createShellTools({ network: false }).find((item) => item.name === "code_exec");
  if (!tool) throw new Error("code_exec missing");
  return tool;
}

describe("code_exec tool", () => {
  test("runs javascript, typescript, and python in the workspace", async () => {
    const root = scratch("botanical-ws-");
    const tool = codeExec();

    const js = await tool.execute(
      { language: "javascript", code: "console.log(6 * 7)" },
      { workspaceRoot: root },
    );
    expect(js.ok).toBe(true);
    expect(js.content).toContain("42");
    expect(js.content).toContain("cwd: /workspace");

    const ts = await tool.execute(
      {
        language: "typescript",
        code: "const n: number = 21;\nconsole.log(n * 2);\n",
      },
      { workspaceRoot: root },
    );
    expect(ts.ok).toBe(true);
    expect(ts.content).toContain("42");

    const py = await tool.execute(
      {
        language: "python",
        code: "from pathlib import Path\nPath('out.txt').write_text('py-ok\\n')\nprint(3 + 4)\n",
      },
      { workspaceRoot: root },
    );
    expect(py.ok).toBe(true);
    expect(py.content).toContain("7");
    expect(readFileSync(path.join(root, "out.txt"), "utf8")).toBe("py-ok\n");
  }, 30_000);

  test("stdin is delivered and the program cannot see the host sentinel", async () => {
    const root = scratch("botanical-ws-");
    const outside = scratch("botanical-out-");
    const marker = "CODE_SENTINEL_SECRET";
    const sentinel = path.join(outside, "secret.txt");
    await Bun.write(sentinel, marker);
    const result = await codeExec().execute(
      {
        language: "python",
        stdin: "from-stdin",
        code: [
          "import pathlib, sys",
          "print(sys.stdin.read())",
          `target = pathlib.Path(${JSON.stringify(sentinel)})`,
          "print('exists=' + str(target.exists()))",
          "print(pathlib.Path('/etc/passwd').read_text())",
        ].join("\n"),
      },
      { workspaceRoot: root },
    );
    expect(result.content).toContain("from-stdin");
    expect(result.content).toContain("exists=False");
    expect(result.content).not.toContain(marker);
    expect(result.content).toContain("root:x:0:0:root:/workspace:/bin/sh");
    expect(result.content).not.toContain(root);
  }, 20_000);

  test("network is off by default", async () => {
    const root = scratch("botanical-ws-");
    const result = await codeExec().execute(
      {
        language: "python",
        timeout_ms: 10_000,
        code: [
          "import socket",
          "s = socket.socket()",
          "s.settimeout(2)",
          "try:",
          "    s.connect(('1.1.1.1', 80))",
          "    print('CONNECTED')",
          "except Exception as exc:",
          "    print(type(exc).__name__)",
        ].join("\n"),
      },
      { workspaceRoot: root },
    );
    expect(result.content).not.toContain("CONNECTED");
    expect(result.content).toContain("OSError");
  }, 20_000);

  test("rejects unknown languages and empty code", async () => {
    const root = scratch("botanical-ws-");
    const tool = codeExec();
    const badLang = await tool.execute({ language: "ruby", code: "puts 1" }, { workspaceRoot: root });
    expect(badLang.ok).toBe(false);
    expect(badLang.content).toContain("language");
    const empty = await tool.execute({ language: "javascript", code: "   " }, { workspaceRoot: root });
    expect(empty.ok).toBe(false);
    expect(empty.content).toContain("code must be a non-empty string");
  });
});
