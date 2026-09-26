import { describe, expect, test } from "bun:test";
import { BotanicalApiError } from "@botanical/core";
import {
  deriveProviderKeys,
  filterMessagesByAgent,
  missingEndpoint,
  parseAgentList,
  parseAgentMessages,
  parseMcpServers,
  parseSettings,
  parseToolList,
} from "./parse";

describe("parse catalogs", () => {
  test("reads agents with icon and color defaults", () => {
    const agents = parseAgentList({
      agents: [
        { id: "a1", name: "Gardener", icon: "Sprout", color: "green" },
        { id: "a2", name: "Builder" },
      ],
    });
    expect(agents).toEqual([
      { id: "a1", name: "Gardener", description: "", icon: "Sprout", color: "green" },
      { id: "a2", name: "Builder", description: "", icon: "Bot", color: "green" },
    ]);
  });

  test("splits builtin and MCP tools", () => {
    const tools = parseToolList({
      tools: [
        { id: "web_search", name: "web_search", source: "builtin", description: "Search the web" },
        {
          name: "mcp__github__list_issues",
          origin: "mcp",
          sourceId: "github",
          serverId: "github",
          description: "List issues",
        },
      ],
    });
    expect(tools[0]?.source).toBe("builtin");
    expect(tools[1]).toMatchObject({ source: "mcp", serverId: "github" });
  });

  test("reads MCP server status rows", () => {
    const servers = parseMcpServers({
      servers: [
        { id: "github", transport: "stdio", state: "ready", toolCount: 4, serverName: "GitHub" },
        { id: "broken", transport: "http", status: "error", error: "connect refused" },
      ],
    });
    expect(servers[0]).toMatchObject({ id: "github", state: "ready", toolCount: 4 });
    expect(servers[1]).toMatchObject({ id: "broken", state: "error", error: "connect refused" });
  });

  test("reads A2A messages and filters by agent", () => {
    const messages = parseAgentMessages({
      messages: [
        {
          id: "m1",
          fromAgentId: "a1",
          toAgentId: "a2",
          body: "hello",
          status: "pending",
          createdAt: "2026-09-24T00:00:00.000Z",
        },
        {
          id: "m2",
          from_agent: "a3",
          to_agent: "a1",
          preview: "note",
          read: true,
          created_at: "2026-09-24T01:00:00.000Z",
        },
      ],
    });
    expect(messages[1]).toMatchObject({ fromAgentId: "a3", toAgentId: "a1", status: "read", body: "note" });
    expect(filterMessagesByAgent(messages, "a2").map((m) => m.id)).toEqual(["m1"]);
    expect(filterMessagesByAgent(messages, "all")).toHaveLength(2);
  });

  test("settings fall back to health fields and derive provider keys", () => {
    const settings = parseSettings({
      deploymentMode: "SAAS",
      brand: { name: "Botanical Cloud" },
      version: "0.2.0",
      features: { billingEnabled: false },
      providers: [{ id: "xai", configured: true }],
    });
    expect(settings.deploymentMode).toBe("SAAS");
    expect(settings.brandName).toBe("Botanical Cloud");
    const keys = deriveProviderKeys([{ provider: "anthropic" }], settings.providers);
    const byId = Object.fromEntries(keys.map((row) => [row.id, row.configured]));
    expect(byId.xai).toBe(true);
    expect(byId.anthropic).toBe(true);
    expect(byId.mock).toBe(true);
    expect(byId.openai).toBe(false);
  });

  test("missingEndpoint recognizes 404/501", () => {
    expect(missingEndpoint(new BotanicalApiError("nope", { status: 404 }))).toBe(true);
    expect(missingEndpoint(new BotanicalApiError("nope", { status: 400 }))).toBe(false);
  });
});
