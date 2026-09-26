import { describe, expect, test } from "bun:test";
import {
  createToolRegistry,
  staticProfileResolver,
  type ChatRequest,
  type LLMProvider,
  type ToolContributor,
} from "@botanical/agent-runtime";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

async function postJson(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("agent turn", () => {
  test("sends the agent prompt as the system message and only allowlisted tools", async () => {
    const calls: ChatRequest[] = [];
    const provider: LLMProvider = {
      id: "record",
      capabilities() {
        return { tools: true, parallelTools: false, vision: false, maxContext: 8000, streaming: true };
      },
      async *complete(request) {
        calls.push(request);
        yield { type: "text-delta", text: "noted" };
        yield { type: "done" };
      },
    };
    const profiles = staticProfileResolver({
      grok: { provider, model: "grok-4", providerId: "xai" },
      fast: { provider, model: "deepseek-chat", providerId: "deepseek" },
    });
    const { app } = setup({}, { profiles });
    const { token } = await login(app);
    const agent = await createAgent(app, token, {
      systemPrompt: "You keep the garden.",
      description: "Tends the plots",
      toolIds: ["file_list"],
    });
    const created = await postJson(app, "/api/chats", { agentId: agent.id, profileId: "grok" }, bearer(token));
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "Hello", profileId: "grok", stream: false },
      bearer(token),
    );
    expect(posted.status).toBe(201);
    const body = await readJson<{ assistantMessage: { content: string } }>(posted);
    expect(body.assistantMessage.content).toBe("noted");
    const request = calls[0];
    expect(request?.messages[0]?.role).toBe("system");
    expect(request?.messages[0]?.content).toContain("You keep the garden.");
    expect(request?.messages[0]?.content).toContain("Description: Tends the plots");
    expect(request?.tools?.map((tool) => tool.name)).toEqual(["file_list"]);
    expect(request?.messages.some((message) => message.role === "user" && message.content === "Hello")).toBe(true);
  });

  test("hides tools that are not on the agent allowlist", async () => {
    const profiles = [
      { id: "mock", name: "Mock echo", provider: "mock", model: "echo" },
      { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
    ];
    const { app } = setup({ BOTANICAL_PROFILES: JSON.stringify(profiles) });
    const { token } = await login(app);
    const agent = await createAgent(app, token, { toolIds: ["file_read"] });
    const created = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "mock" },
      bearer(token),
    );
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "List it", profileId: "mock", stream: false },
      bearer(token),
    );
    const body = await readJson<{ assistantMessage: { content: string }; toolCall?: { name: string } }>(posted);
    expect(body.toolCall).toBeUndefined();
    expect(body.assistantMessage.content).toBe("mock:List it");

    const catalog = await readJson<{ tools: Array<{ id: string; source: string }> }>(
      await app.fetch(new Request("http://localhost/api/tools", { headers: bearer(token) })),
    );
    const fileList = catalog.tools.find((tool) => tool.id === "file_list");
    expect(fileList?.source).toBe("builtin");
    expect(catalog.tools.some((tool) => tool.id === "file_read")).toBe(true);
  });

  test("GET /api/tools lists built-ins and registered MCP tools", async () => {
    const mcp: ToolContributor = {
      id: "mcp",
      source: "mcp",
      listTools() {
        return [
          {
            id: "mcp.docs.search",
            name: "mcp.docs.search",
            description: "Search docs",
            parameters: { type: "object", properties: {} },
            source: "mcp",
            serverId: "docs",
          },
        ];
      },
      async callTool() {
        return { content: "hit" };
      },
    };
    const toolRegistry = createToolRegistry([mcp]);
    const { app } = setup({}, { toolRegistry });
    const hidden = await app.fetch(new Request("http://localhost/api/tools"));
    expect(hidden.status).toBe(401);
    const { token } = await login(app);
    const response = await app.fetch(new Request("http://localhost/api/tools", { headers: bearer(token) }));
    expect(response.status).toBe(200);
    const body = await readJson<{
      tools: Array<{ id: string; name: string; description: string; source: string; serverId?: string; parameters: unknown }>;
    }>(response);
    expect(body.tools).toEqual([
      {
        id: "mcp.docs.search",
        name: "mcp.docs.search",
        description: "Search docs",
        parameters: { type: "object", properties: {} },
        source: "mcp",
        serverId: "docs",
      },
    ]);
  });
});
