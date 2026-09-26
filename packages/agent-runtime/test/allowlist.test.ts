import { describe, expect, test } from "bun:test";
import { toolAllowed } from "../src/tools";

describe("tool allowlist", () => {
  const cases: Array<{ allow: string[]; name: string; ok: boolean }> = [
    { allow: [], name: "web_search", ok: false },
    { allow: ["web_search"], name: "web_search", ok: true },
    { allow: ["web_search"], name: "web_fetch", ok: false },
    { allow: ["*"], name: "shell", ok: true },
    { allow: ["mcp.fs.*"], name: "mcp.fs.read_file", ok: true },
    { allow: ["mcp.fs.*"], name: "mcp.fs2.read_file", ok: false },
    { allow: ["mcp.*"], name: "mcp.github.create_issue", ok: true },
    { allow: ["mcp.*"], name: "web_search", ok: false },
    { allow: ["mcp.*.read"], name: "mcp.fs.read", ok: false },
    { allow: ["  web_fetch  "], name: "web_fetch", ok: true },
  ];

  for (const entry of cases) {
    test(`${JSON.stringify(entry.allow)} vs ${entry.name}`, () => {
      expect(toolAllowed(entry.allow, entry.name)).toBe(entry.ok);
    });
  }

  test("runtime tool names are not implicitly allowed", () => {
    expect(toolAllowed([], "agent_send")).toBe(false);
    expect(toolAllowed(["*"], "agent_send")).toBe(true);
  });
});
