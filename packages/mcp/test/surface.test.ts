import { describe, expect, test } from "bun:test";

import { createAgentToolSurface, resolveToolPolicy } from "../src/surface.js";
import type { AgentToolResult, McpRuntimeStatus, McpToolInfo, ToolExecContext } from "../src/types.js";
import type { McpToolSource } from "../src/runtime.js";

function echoSource(calls: string[]): McpToolSource {
  const tool: McpToolInfo = {
    serverId: "docs",
    toolName: "echo",
    canonicalName: "mcp.docs.echo",
    providerName: "mcp__docs__echo",
    description: "Echo",
    parameters: { type: "object", properties: { message: { type: "string" } } },
  };
  return {
    tools: () => [tool],
    warnings: () => ["MCP server \"down\" is unavailable: connection refused"],
    status: (): McpRuntimeStatus => ({ disabled: false, source: "env", servers: [] }),
    async call(name, args): Promise<AgentToolResult> {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return { ok: true, content: "from-mcp" };
    },
  };
}

const builtin = {
  name: "web_search",
  description: "Search",
  parameters: { type: "object", properties: { query: { type: "string" } } },
  async execute(args: Record<string, unknown>) {
    return `searched ${String(args.query)}`;
  },
};

describe("createAgentToolSurface", () => {
  test("lists built-ins and provider-safe MCP tools together", async () => {
    const calls: string[] = [];
    const surface = createAgentToolSurface({
      builtins: [builtin],
      mcp: echoSource(calls),
      modelSupportsTools: true,
    });

    expect(surface.definitions().map((tool) => tool.name)).toEqual(["web_search", "mcp__docs__echo"]);
    expect(surface.catalog().find((tool) => tool.source === "mcp")?.canonicalName).toBe("mcp.docs.echo");

    const searched = await surface.execute("web_search", { query: "ferns" });
    expect(searched.content).toBe("searched ferns");

    const echoed = await surface.execute("mcp__docs__echo", '{"message":"hi"}');
    expect(echoed.content).toBe("from-mcp");
    expect(calls).toEqual(['mcp__docs__echo:{"message":"hi"}']);

    const dotted = await surface.execute("mcp.docs.echo", { message: "x" });
    expect(dotted.ok).toBe(true);
    expect(surface.warnings().some((warning) => warning.includes("down"))).toBe(true);
  });

  test("a model without tools advertises nothing", async () => {
    const calls: string[] = [];
    const surface = createAgentToolSurface({
      builtins: [builtin],
      mcp: echoSource(calls),
      modelSupportsTools: false,
    });
    expect(surface.definitions()).toEqual([]);
    expect(surface.warnings()[0]).toMatch(/does not support tools/);
    const result = await surface.execute("web_search", { query: "x" });
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(resolveToolPolicy({ modelSupportsTools: false }).mcpEnabled).toBe(false);
  });

  test("mcpEnabled false keeps built-ins and drops MCP", async () => {
    const calls: string[] = [];
    const surface = createAgentToolSurface({
      builtins: [builtin],
      mcp: echoSource(calls),
      modelSupportsTools: true,
      mcpEnabled: false,
    });
    expect(surface.definitions().map((tool) => tool.name)).toEqual(["web_search"]);
    const hidden = await surface.execute("mcp.docs.echo", {});
    expect(hidden.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("approval can deny before a tool runs", async () => {
    const calls: string[] = [];
    const surface = createAgentToolSurface({
      builtins: [builtin],
      mcp: echoSource(calls),
      modelSupportsTools: true,
    });
    const ctx: ToolExecContext = { approve: () => false };
    const denied = await surface.execute("mcp__docs__echo", { message: "no" }, ctx);
    expect(denied.content).toMatch(/denied/);
    expect(calls).toEqual([]);
  });

  test("rejects built-ins that steal the MCP prefix", () => {
    expect(() => createAgentToolSurface({
      builtins: [{ name: "mcp__docs__echo", async execute() { return "x"; } }],
      modelSupportsTools: true,
    })).toThrow(/reserved/);
  });
});
