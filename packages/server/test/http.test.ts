import { describe, expect, test } from "bun:test";
import {
  createAgentMessageBus,
  createBuiltinToolSource,
  createMemoryStore,
  createRuntimeToolSource,
  staticProfileResolver,
  type ExecutableTool,
} from "@botanical/core";
import { createScriptedProvider } from "@botanical/core/testing";
import { createRuntimeApp } from "../src/app";

const echo: ExecutableTool = {
  name: "echo",
  description: "Echo text",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async execute(args) {
    const text =
      args && typeof args === "object" && "text" in args ? String((args as { text: unknown }).text) : "";
    return { output: `echo:${text}` };
  },
};

function appWith(script: Parameters<typeof createScriptedProvider>[0]) {
  const store = createMemoryStore();
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  const provider = createScriptedProvider(script);
  const app = createRuntimeApp({
    store,
    bus,
    profiles: staticProfileResolver({ fast: { provider, model: "test-model", providerId: "scripted" } }),
    toolSources: [createRuntimeToolSource(bus), createBuiltinToolSource([echo])],
    persistence: "memory",
  });
  return { app, store, bus, provider };
}

function parseSse(body: string): Array<{ event?: string; data: Record<string, unknown> }> {
  const events = [];
  for (const block of body.split(/\n\n/)) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) continue;
    events.push({ ...(event ? { event } : {}), data: JSON.parse(data.join("\n")) as Record<string, unknown> });
  }
  return events;
}

async function postJson(app: ReturnType<typeof createRuntimeApp>, path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("runtime HTTP", () => {
  test("health, profiles, agents, one-agent chats, streaming tools, and A2A", async () => {
    const { app, provider } = appWith([
      () => [
        { type: "tool-call", id: "call_1", name: "echo", arguments: { text: "leaf" } },
        { type: "done" },
      ],
      () => [{ type: "text-delta", text: "Noted." }, { type: "done" }],
      () => [
        {
          type: "tool-call",
          id: "send_1",
          name: "agent_send",
          arguments: { toAgentName: "Bea", body: "Check the ferns" },
        },
        { type: "done" },
      ],
      () => [{ type: "text-delta", text: "Asked Bea." }, { type: "done" }],
      (req) => {
        const inbox = req.messages.find((message) => message.name === "a2a-inbox");
        const seen = typeof inbox?.content === "string" && inbox.content.includes("Check the ferns");
        return [{ type: "text-delta", text: seen ? "mail" : "none" }, { type: "done" }];
      },
    ]);

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "botanical-runtime", persistence: "memory" });

    const profiles = await app.request("/api/profiles");
    expect(await profiles.json()).toEqual({
      defaultProfileId: null,
      profiles: [{ id: "fast", providerId: "scripted", model: "test-model" }],
    });

    const adaRes = await postJson(app, "/api/agents", {
      id: "ada",
      name: "Ada",
      prompt: "You are Ada.",
      toolAllowlist: ["echo"],
    });
    expect(adaRes.status).toBe(201);
    const beaRes = await postJson(app, "/api/agents", {
      id: "bea",
      name: "Bea",
      prompt: "You are Bea.",
      toolAllowlist: [],
    });
    expect(beaRes.status).toBe(201);

    const missingChat = await postJson(app, "/api/chats", { title: "no agent" });
    expect(missingChat.status).toBe(400);

    const chatRes = await postJson(app, "/api/chats", { agentId: "ada" });
    expect(chatRes.status).toBe(201);
    const chatId = ((await chatRes.json()) as { chat: { id: string; agentId: string } }).chat.id;

    const rebind = await postJson(app, `/api/chats/${chatId}`, { agentId: "bea", title: "nope" }, "PATCH");
    expect(rebind.status).toBe(409);
    expect(((await rebind.json()) as { code: string }).code).toBe("AGENT_BINDING");

    const renamed = await postJson(app, `/api/chats/${chatId}`, { title: "Ferns" }, "PATCH");
    expect(renamed.status).toBe(200);

    const noProfile = await postJson(app, `/api/chats/${chatId}/messages`, { content: "Hi" });
    expect(noProfile.status).toBe(400);

    const wrongProfile = await postJson(app, `/api/chats/${chatId}/messages`, {
      content: "Hi",
      profileId: "missing",
    });
    expect(wrongProfile.status).toBe(404);

    const wrongAgent = await postJson(app, `/api/chats/${chatId}/messages`, {
      content: "Hi",
      profileId: "fast",
      agentId: "bea",
    });
    expect(wrongAgent.status).toBe(409);

    const streamed = await postJson(app, `/api/chats/${chatId}/messages`, {
      content: "Echo leaf",
      profileId: "fast",
      agentId: "ada",
    });
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-type") ?? "").toContain("text/event-stream");
    const events = parseSse(await streamed.text());
    expect(events.some((event) => event.data.type === "tool-result" && event.data.result === "echo:leaf")).toBe(
      true,
    );
    expect(events.at(-1)?.data).toEqual({ type: "done", finishReason: "stop" });
    expect(events.filter((event) => event.data.type === "done")).toHaveLength(1);
    expect(provider.requests[0]?.model).toBe("test-model");
    expect(provider.requests[1]?.messages.some((message) => message.role === "tool")).toBe(true);

    const history = await app.request(`/api/chats/${chatId}/messages`);
    const saved = ((await history.json()) as { messages: Array<{ role: string }> }).messages;
    expect(saved.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    const ask = await postJson(app, `/api/chats/${chatId}/messages`, {
      content: "Ask Bea about ferns",
      profileId: "fast",
    });
    const askEvents = parseSse(await ask.text());
    expect(askEvents.some((event) => event.data.type === "a2a-sent")).toBe(true);

    const beaChat = await postJson(app, "/api/chats", { agentId: "bea", title: "Inbox" });
    const beaChatId = ((await beaChat.json()) as { chat: { id: string } }).chat.id;
    const beaTurn = await postJson(app, `/api/chats/${beaChatId}/messages`, {
      content: "Anything waiting?",
      profileId: "fast",
    });
    const beaEvents = parseSse(await beaTurn.text());
    expect(beaEvents[0]?.data.type).toBe("inbox");
    expect(beaEvents.some((event) => event.data.type === "text-delta" && event.data.text === "mail")).toBe(true);

    const direct = await postJson(app, "/api/a2a/messages", {
      fromAgentId: "bea",
      toAgentId: "ada",
      body: "Ferns are fine",
    });
    expect(direct.status).toBe(201);
    const polled = await postJson(app, "/api/a2a/poll", {});
    const delivered = ((await polled.json()) as { delivered: Array<{ body: string; status: string }> }).delivered;
    expect(delivered.some((message) => message.body === "Ferns are fine" && message.status === "delivered")).toBe(
      true,
    );

    const inbox = await app.request("/api/agents/ada/inbox?status=delivered");
    expect(inbox.status).toBe(200);
    const inboxBody = (await inbox.json()) as { inbox: Array<{ body: string }> };
    expect(inboxBody.inbox.some((message) => message.body === "Ferns are fine")).toBe(true);

    const inUse = await app.request("/api/agents/ada", { method: "DELETE" });
    expect(inUse.status).toBe(409);

    const spare = await postJson(app, "/api/agents", { name: "Temp", prompt: "Temporary." });
    const spareId = ((await spare.json()) as { agent: { id: string } }).agent.id;
    const removed = await app.request(`/api/agents/${spareId}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect((await app.request(`/api/agents/${spareId}`)).status).toBe(404);
  });
});
