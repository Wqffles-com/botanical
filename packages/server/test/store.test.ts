import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/db/memory.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

describe("memory store contract", () => {
  test("defaults agent icon and color and round-trips tool calls, profiles, and agent messages", async () => {
    const store = createMemoryStore();
    const agent = await store.agents.create({
      name: "Gardener",
      description: "Tends the plots",
      systemPrompt: "You keep the garden.",
      toolIds: ["web_search"],
    });
    expect(agent.icon).toBe("Bot");
    expect(agent.color).toBe("green");
    expect(agent.defaultProfileId).toBeNull();

    const sprout = await store.agents.create({
      name: "Sprout",
      icon: "Sprout",
      color: "teal",
      description: "",
      systemPrompt: "Grow.",
      toolIds: [],
      defaultProfileId: "grok",
    });
    expect(sprout).toMatchObject({ icon: "Sprout", color: "teal", defaultProfileId: "grok" });

    const profile = await store.profiles.upsert({
      id: "grok",
      name: "Grok",
      provider: "xai",
      model: "grok-4",
      baseUrl: "https://api.x.ai/v1",
    });
    expect(profile).toEqual({
      id: "grok",
      name: "Grok",
      provider: "xai",
      model: "grok-4",
      baseUrl: "https://api.x.ai/v1",
    });
    expect(JSON.stringify(profile)).not.toMatch(/apiKey|secret|password/i);

    const chat = await store.chats.create({
      agentId: sprout.id,
      profileId: "grok",
      title: "Watering",
    });
    const assistant = await store.messages.create({
      chatId: chat.id,
      role: "assistant",
      content: "",
      profileId: "grok",
      toolCalls: [{ id: "call_1", name: "web_search", arguments: { q: "tomato" } }],
    });
    const tool = await store.messages.create({
      chatId: chat.id,
      role: "tool",
      content: "Water when the top inch is dry.",
      toolCallId: "call_1",
      name: "web_search",
    });
    expect(assistant.toolCalls).toEqual([{ id: "call_1", name: "web_search", arguments: { q: "tomato" } }]);
    expect(tool.toolCallId).toBe("call_1");
    await expect(
      store.messages.create({ chatId: chat.id, role: "tool", content: "missing id" }),
    ).rejects.toThrow(/toolCallId/);

    const mail = await store.agentMessages.create({
      fromAgentId: agent.id,
      toAgentId: sprout.id,
      body: "Please file the note.",
    });
    expect(mail.status).toBe("pending");
    const read = await store.agentMessages.update(mail.id, { status: "read" });
    expect(read?.status).toBe("read");
    const inbox = await store.agentMessages.list({ agentId: sprout.id, status: "read" });
    expect(inbox.map((row) => row.id)).toEqual([mail.id]);
    await expect(
      store.agentMessages.create({ fromAgentId: agent.id, toAgentId: agent.id, body: "nope" }),
    ).rejects.toThrow(/different/);

    await store.close();
  });

  test("rejects a display name longer than 40 characters and an unknown color", async () => {
    const store = createMemoryStore();
    await expect(
      store.agents.create({
        name: "x".repeat(41),
        description: "",
        systemPrompt: "prompt",
        toolIds: [],
      }),
    ).rejects.toThrow(/1-40/);
    await expect(
      store.agents.create({
        name: "Ok",
        color: "magenta" as "green",
        description: "",
        systemPrompt: "prompt",
        toolIds: [],
      }),
    ).rejects.toThrow(/color/);
  });
});

describe("agent identity over HTTP", () => {
  test("stores icon, color, and the suggested profile", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({
          name: "Research",
          description: "Looks things up",
          systemPrompt: "Search carefully.",
          toolIds: ["web_search"],
          icon: "Search",
          color: "blue",
          defaultProfileId: "grok",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const created = await readJson<{
      agent: { icon: string; color: string; defaultProfileId: string | null };
    }>(response);
    expect(created.agent).toMatchObject({ icon: "Search", color: "blue", defaultProfileId: "grok" });

    const defaults = await createAgent(app, token);
    const fetched = await readJson<{ agent: { icon: string; color: string; defaultProfileId: string | null } }>(
      await app.fetch(new Request(`http://localhost/api/agents/${defaults.id}`, { headers: bearer(token) })),
    );
    expect(fetched.agent.icon).toBe("Bot");
    expect(fetched.agent.color).toBe("green");
    expect(fetched.agent.defaultProfileId).toBeNull();

    const patched = await app.fetch(
      new Request(`http://localhost/api/agents/${defaults.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ icon: "Leaf", color: "not-a-color" }),
      }),
    );
    expect(patched.status).toBe(400);
  });
});
