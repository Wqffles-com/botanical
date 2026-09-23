import { describe, expect, test } from "bun:test";

import { canonicalToolName, parseToolName, providerToolName } from "../src/names.js";

describe("tool names", () => {
  test("round-trips the architectural and provider forms", () => {
    expect(canonicalToolName("filesystem", "read_file")).toBe("mcp.filesystem.read_file");
    expect(providerToolName("filesystem", "read_file")).toBe("mcp__filesystem__read_file");
    expect(parseToolName("mcp.filesystem.read_file")).toEqual({
      serverId: "filesystem",
      toolName: "read_file",
      form: "canonical",
    });
    expect(parseToolName("mcp__filesystem__read_file")).toEqual({
      serverId: "filesystem",
      toolName: "read_file",
      form: "provider",
    });
  });

  test("keeps dots and double underscores inside the remote tool name", () => {
    expect(parseToolName("mcp.docs.search.v2")?.toolName).toBe("search.v2");
    expect(parseToolName("mcp__docs__search__v2")?.toolName).toBe("search__v2");
  });

  test("rejects names that are not MCP tools", () => {
    expect(parseToolName("web_search")).toBeNull();
    expect(parseToolName("mcp.")).toBeNull();
    expect(parseToolName("mcp__")).toBeNull();
    expect(parseToolName("mcp.bad id.tool")).toBeNull();
  });

  test("sanitizes tool names the provider grammar rejects", () => {
    expect(providerToolName("docs", "search.v2")).toBe("mcp__docs__search_v2");
  });
});
