import { describe, expect, test } from "bun:test";
import { createAgentSchema } from "../src/agent";
import { createAgentMessageBus } from "../src/bus";
import { AgentNotFoundError } from "../src/errors";
import { createMemoryStore } from "../src/memory";
import { staticProfileResolver } from "../src/profiles";
import { createRuntimeToolSource } from "../src/runtime-tools";
import { runAgentTurn, type RuntimeDeps } from "../src/loop";
import { createScriptedProvider } from "../src/testing";
import { DeliveryWorker } from "../src/worker";
import type { RuntimeEvent } from "../src/events";
import { createBuiltinToolSource, type ExecutableTool } from "../src/tools";

async function collect(deps: RuntimeDeps, input: Parameters<typeof runAgentTurn>[1]) {
  const events: RuntimeEvent[] = [];
  for await (const event of runAgentTurn(deps, input)) events.push(event);
  return events;
}

describe("agent-to-agent bus", () => {
  test("send persists pending, the worker delivers, and the next turn reads it", async () => {
    const store = createMemoryStore();
    const bus = createAgentMessageBus(store.agents, store.agentMessages);
    const ada = await store.agents.create(
      createAgentSchema.parse({
        id: "ada",
        name: "Ada",
        prompt: "You are Ada.",
        toolAllowlist: [],
      }),
    );
    const bea = await store.agents.create(
      createAgentSchema.parse({
        id: "bea",
        name: "Bea",
        prompt: "You are Bea.",
        toolAllowlist: [],
      }),
    );
    const adaChat = await store.chats.create({ agentId: ada.id, title: "Ada thread" });
    const beaChat = await store.chats.create({ agentId: bea.id, title: "Bea thread" });

    const adaProvider = createScriptedProvider([
      () => [
        {
          type: "tool-call",
          id: "send_1",
          name: "agent_send",
          arguments: { toAgentId: "bea", body: "Need the soil notes", fromAgentId: "spoofed" },
        },
        { type: "done" },
      ],
      () => [{ type: "text-delta", text: "sent" }, { type: "done" }],
    ]);
    let beaSawInbox = false;
    const beaProvider = createScriptedProvider([
      (req) => {
        const inbox = req.messages.find((message) => message.name === "a2a-inbox");
        beaSawInbox = typeof inbox?.content === "string" && inbox.content.includes("Need the soil notes");
        return [{ type: "text-delta", text: beaSawInbox ? "got mail" : "empty" }, { type: "done" }];
      },
    ]);

    const adaDeps: RuntimeDeps = {
      store,
      bus,
      profiles: staticProfileResolver({ fast: { provider: adaProvider, model: "m" } }),
      toolSources: [createRuntimeToolSource(bus)],
    };
    const beaDeps: RuntimeDeps = {
      store,
      bus,
      profiles: staticProfileResolver({ fast: { provider: beaProvider, model: "m" } }),
      toolSources: [createRuntimeToolSource(bus)],
    };

    const sentEvents = await collect(adaDeps, {
      chatId: adaChat.id,
      content: "Ask Bea",
      profileId: "fast",
    });
    expect(sentEvents.some((event) => event.type === "a2a-sent")).toBe(true);
    const pending = await bus.listInbox(bea.id, { status: ["pending"] });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.fromAgentId).toBe("ada");
    expect(pending[0]?.body).toBe("Need the soil notes");

    const worker = new DeliveryWorker(bus, 60_000);
    expect(await worker.tick()).toBe(1);
    expect(await worker.tick()).toBe(0);
    worker.start();
    worker.stop();

    const beaEvents = await collect(beaDeps, {
      chatId: beaChat.id,
      content: "Anything new?",
      profileId: "fast",
    });
    expect(beaSawInbox).toBe(true);
    expect(beaEvents[0]).toMatchObject({ type: "inbox" });
    const read = await bus.get(pending[0]!.id);
    expect(read?.status).toBe("read");
    const transcript = await store.messages.listByChat(beaChat.id);
    expect(transcript.some((message) => message.name === "a2a-inbox")).toBe(true);
  });

  test("unknown recipients fail the tool call without leaving the loop", async () => {
    const store = createMemoryStore();
    const bus = createAgentMessageBus(store.agents, store.agentMessages);
    const ada = await store.agents.create(
      createAgentSchema.parse({ name: "Ada", prompt: "You are Ada.", toolAllowlist: [] }),
    );
    const chat = await store.chats.create({ agentId: ada.id, title: "t" });
    const provider = createScriptedProvider([
      () => [
        {
          type: "tool-call",
          id: "send_missing",
          name: "agent_send",
          arguments: { toAgentName: "Nobody", body: "hello" },
        },
        { type: "done" },
      ],
      () => [{ type: "text-delta", text: "no such agent" }, { type: "done" }],
    ]);
    const deps: RuntimeDeps = {
      store,
      bus,
      profiles: staticProfileResolver({ fast: { provider, model: "m" } }),
      toolSources: [createRuntimeToolSource(bus), createBuiltinToolSource([] as ExecutableTool[])],
    };
    const events = await collect(deps, { chatId: chat.id, content: "ping", profileId: "fast" });
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({ isError: true });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    await expect(bus.send({ fromAgentId: ada.id, toAgentId: "missing", body: "x" })).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  test("markRead is single-claim so two turns do not double-inject", async () => {
    const store = createMemoryStore();
    const bus = createAgentMessageBus(store.agents, store.agentMessages);
    const ada = await store.agents.create(
      createAgentSchema.parse({ id: "ada", name: "Ada", prompt: "p", toolAllowlist: [] }),
    );
    const bea = await store.agents.create(
      createAgentSchema.parse({ id: "bea", name: "Bea", prompt: "p", toolAllowlist: [] }),
    );
    await bus.send({ fromAgentId: ada.id, toAgentId: bea.id, body: "once" });
    await bus.deliverPending();
    const inbox = await bus.listInbox(bea.id, { status: ["delivered"] });
    const first = await bus.markRead(inbox.map((message) => message.id));
    const second = await bus.markRead(inbox.map((message) => message.id));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect((await bus.get(inbox[0]!.id))?.status).toBe("read");
  });
});
