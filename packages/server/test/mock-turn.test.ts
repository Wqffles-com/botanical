import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

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

describe("mock profile and file_list", () => {
  test("echoes the user and lists the workspace", async () => {
    const workspace = join(tmpdir(), `botanical-mock-${Date.now()}`);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "notes.txt"), "garden");
    process.env.BOTANICAL_WORKSPACE = workspace;

    const profiles = [
      { id: "mock", name: "Mock echo", provider: "mock", model: "echo" },
      { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
    ];
    const { app } = setup({ BOTANICAL_PROFILES: JSON.stringify(profiles) });
    const { token } = await login(app);
    const agent = await createAgent(app, token, { toolIds: ["file_list"] });
    const created = await postJson(
      app,
      "/api/chats",
      { agentId: agent.id, profileId: "mock", title: "Plot" },
      bearer(token),
    );
    expect(created.status).toBe(201);
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;

    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "What is in the workspace?", profileId: "mock", stream: false },
      bearer(token),
    );
    expect(posted.status).toBe(201);
    const body = await readJson<{
      assistantMessage: { content: string };
      toolCall: { name: string };
    }>(posted);
    expect(body.toolCall.name).toBe("file_list");
    expect(body.assistantMessage.content).toContain("mock:What is in the workspace?");
    expect(body.assistantMessage.content).toContain("notes.txt");

    const streamed = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...bearer(token),
        },
        body: JSON.stringify({ content: "Again", profileId: "mock", stream: true }),
      }),
    );
    expect(streamed.status).toBe(200);
    const events = await streamed.text();
    expect(events).toContain("event: tool-call");
    expect(events).toContain("file_list");
    expect(events).toContain("event: text-delta");
    expect(events).toContain("mock:Again");
  });
});
