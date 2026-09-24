import { describe, expect, test } from "bun:test";

import { ToolRegistry } from "../src/registry.ts";
import { isTool, toToolDefinition, type Tool } from "../src/types.ts";
import { builtinWebTools, webFetchTool, webSearchTool } from "../src/web/index.ts";

describe("tool interface", () => {
  test("web tools expose name, description, JSON Schema parameters, and execute", () => {
    for (const tool of builtinWebTools()) {
      expect(isTool(tool)).toBe(true);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required?.length).toBeGreaterThan(0);
      const definition = JSON.parse(JSON.stringify(toToolDefinition(tool)));
      expect(definition.execute).toBeUndefined();
      expect(definition.name).toBe(tool.name);
      expect(definition.parameters.properties).toBeTruthy();
    }
    expect(builtinWebTools().map((tool) => tool.name)).toEqual(["web_search", "web_fetch"]);
  });

  test("registry lists definitions and executes by name", async () => {
    const registry = new ToolRegistry().registerAll(builtinWebTools());
    expect(registry.definitions().map((tool) => tool.name)).toEqual(["web_search", "web_fetch"]);
    expect(registry.get("web_fetch")).toBe(webFetchTool);
    const missing = await registry.execute("nope", {});
    expect(missing.ok).toBe(false);
    expect(missing.errorCode).toBe("unknown_tool");
    const stub = await registry.execute("web_search", { query: "ferns" }, { env: {} });
    expect(stub.ok).toBe(false);
    expect(stub.errorCode).toBe("search_unconfigured");
    expect(stub.content).toContain("ferns");
  });

  test("duplicate registration fails and thrown tools become results", async () => {
    const registry = new ToolRegistry().register(webSearchTool);
    expect(() => registry.register(webSearchTool)).toThrow(/already registered/);
    const boom: Tool = {
      name: "boom",
      description: "Always throws.",
      parameters: { type: "object", properties: {} },
      execute() {
        throw new Error("nope");
      },
    };
    registry.register(boom);
    const thrown = await registry.execute("boom", {});
    expect(thrown).toEqual({ ok: false, errorCode: "tool_error", content: "nope" });

    const aborted: Tool = {
      name: "stop",
      description: "Aborts.",
      parameters: { type: "object", properties: {} },
      execute() {
        throw new DOMException("stopped", "AbortError");
      },
    };
    registry.register(aborted);
    const result = await registry.execute("stop", {});
    expect(result.errorCode).toBe("aborted");
  });
});
