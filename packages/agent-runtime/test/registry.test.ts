import { describe, expect, test } from "bun:test";
import { collectTools, toolAllowed } from "../src/tools";
import {
  TOOL_REGISTRY_VERSION,
  contributorFromBuiltins,
  contributorFromMcpCatalog,
  createToolRegistry,
  type ToolContributor,
} from "../src/registry";

const ctx = { agentId: "agent-1", chatId: "chat-1" };

function echoContributor(id: string, source: "builtin" | "mcp", names: string[]): ToolContributor {
  return {
    id,
    source,
    listTools() {
      return names.map((name) => ({
        id: name,
        name,
        description: name,
        parameters: { type: "object", properties: {} },
        source,
      }));
    },
    async callTool(toolId, args) {
      return { content: `${id}:${toolId}:${JSON.stringify(args)}` };
    },
  };
}

describe("tool registry", () => {
  test("version is pinned for m08 and m09", () => {
    expect(TOOL_REGISTRY_VERSION).toBe(1);
  });

  test("lists contributors, keeps the first id, and dispatches calls", async () => {
    const registry = createToolRegistry([
      echoContributor("builtin.files", "builtin", ["file_list", "file_read"]),
      echoContributor("mcp", "mcp", ["file_list", "mcp.docs.search"]),
    ]);
    const listed = await registry.list();
    expect(listed.map((tool) => tool.id)).toEqual(["file_list", "file_read", "mcp.docs.search"]);
    expect(listed.find((tool) => tool.id === "file_list")?.source).toBe("builtin");
    expect(listed.find((tool) => tool.id === "mcp.docs.search")?.source).toBe("mcp");

    const called = await registry.call("file_list", { path: "." }, ctx);
    expect(called.content).toBe('builtin.files:file_list:{"path":"."}');
    const missing = await registry.call("nope", {}, ctx);
    expect(missing.isError).toBe(true);
  });

  test("register replaces the same contributor id", async () => {
    const registry = createToolRegistry();
    registry.register(echoContributor("mcp", "mcp", ["mcp.docs.search"]));
    registry.register(echoContributor("mcp", "mcp", ["mcp.docs.fetch"]));
    expect((await registry.list()).map((tool) => tool.id)).toEqual(["mcp.docs.fetch"]);
    expect(registry.unregister("mcp")).toBe(true);
    expect(await registry.list()).toEqual([]);
  });

  test("tool sources honor the agent allowlist", async () => {
    const registry = createToolRegistry([
      echoContributor("builtin.files", "builtin", ["file_list", "file_read"]),
      echoContributor("mcp", "mcp", ["mcp.docs.search"]),
    ]);
    const visible = (await collectTools(registry.toToolSources())).filter((tool) =>
      toolAllowed(["file_list", "mcp.docs.*"], tool.name),
    );
    expect(visible.map((tool) => tool.name).sort()).toEqual(["file_list", "mcp.docs.search"]);
  });

  test("builtin and mcp adapters normalize results", async () => {
    const builtins = contributorFromBuiltins([
      {
        name: "file_list",
        description: "List",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { ok: true, content: "notes.txt file 6" };
        },
      },
      {
        name: "file_read",
        description: "Read",
        async execute() {
          throw new Error("denied");
        },
      },
    ], { id: "builtin.files" });
    const mcp = contributorFromMcpCatalog({
      tools: () => [
        {
          id: "mcp.docs.search",
          description: "Search",
          serverId: "docs",
          parameters: { type: "object", properties: {} },
        },
      ],
      async call(name) {
        return { content: `hit:${name}` };
      },
    });
    const registry = createToolRegistry([builtins, mcp]);
    expect((await registry.list()).map((tool) => [tool.id, tool.source, tool.serverId])).toEqual([
      ["file_list", "builtin", undefined],
      ["file_read", "builtin", undefined],
      ["mcp.docs.search", "mcp", "docs"],
    ]);
    expect((await registry.call("file_list", {}, ctx)).content).toContain("notes.txt");
    expect((await registry.call("file_read", {}, ctx)).isError).toBe(true);
    expect((await registry.call("mcp.docs.search", {}, ctx)).content).toBe("hit:mcp.docs.search");
  });
});
