import { describe, expect, test } from "bun:test";
import { createAgentMessageBus } from "@botanical/agent-runtime";

import { adoptAgentMessages, attachAgentMessages } from "../src/db/agent-messages.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import type { AgentMessageRepository, Store } from "../src/types.ts";

describe("agent message store", () => {
  test("memory rows move pending → delivered → read through the runtime bus", async () => {
    const store = createMemoryStore();
    const scout = await store.agents.create({
      name: "Scout",
      icon: "Search",
      color: "teal",
      description: "",
      systemPrompt: "Look.",
      toolIds: [],
      defaultProfileId: null,
    });
    const keeper = await store.agents.create({
      name: "Keeper",
      icon: "Leaf",
      color: "green",
      description: "",
      systemPrompt: "Keep.",
      toolIds: [],
      defaultProfileId: null,
    });
    const bus = createAgentMessageBus(runtimeAgents(store), store.agentMessages);

    const pending = await bus.send({ fromAgentId: scout.id, toAgentId: keeper.id, body: "Water the ferns" });
    expect(pending.status).toBe("pending");

    const delivered = await bus.deliverPending({ toAgentId: keeper.id });
    expect(delivered.map((message) => message.status)).toEqual(["delivered"]);

    const read = await bus.markRead(delivered.map((message) => message.id));
    expect(read.map((message) => message.status)).toEqual(["read"]);
    expect(read[0]?.readAt).toBeTruthy();

    const again = await bus.markRead([pending.id]);
    expect(again).toEqual([]);

    await store.agents.delete(scout.id);
    expect(await store.agentMessages.get(pending.id)).toBeNull();
  });

  test("attaches the in-memory repository when postgres omits agent messages", async () => {
    const memory = createMemoryStore();
    const partial = {
      kind: "postgres",
      agents: memory.agents,
      chats: memory.chats,
      messages: memory.messages,
      sessions: memory.sessions,
    } as Store;
    const attached = attachAgentMessages(partial);
    expect(attached.kind).toBe("postgres");
    const row = await attached.agentMessages.insert({
      fromAgentId: "a",
      toAgentId: "b",
      body: "held in memory",
    });
    expect(row.status).toBe("pending");
    expect(await attached.agentMessages.get(row.id)).toEqual(row);
  });

  test("keeps a postgres repository that already implements the contract", async () => {
    const memory = createMemoryStore();
    const seen: string[] = [];
    const agentMessages: AgentMessageRepository = {
      ...memory.agentMessages,
      async insert(input) {
        seen.push(input.body);
        return memory.agentMessages.insert(input);
      },
    };
    const store: Store = { ...memory, kind: "postgres", agentMessages };
    const attached = attachAgentMessages(store);
    await attached.agentMessages.insert({ fromAgentId: "a", toAgentId: "b", body: "persisted" });
    expect(seen).toEqual(["persisted"]);
  });

  test("adopts a runtime repository and marks delivered rows read", async () => {
    const memory = createMemoryStore();
    const runtimeOnly = {
      insert: memory.agentMessages.insert.bind(memory.agentMessages),
      get: memory.agentMessages.get.bind(memory.agentMessages),
      listForAgent: memory.agentMessages.listForAgent.bind(memory.agentMessages),
      deliverPending: memory.agentMessages.deliverPending.bind(memory.agentMessages),
      markRead: memory.agentMessages.markRead.bind(memory.agentMessages),
    };
    const adopted = adoptAgentMessages(runtimeOnly);
    expect(adopted).not.toBeNull();
    const row = await adopted?.insert({ fromAgentId: "a", toAgentId: "b", body: "hello" });
    await adopted?.deliverPending({ toAgentId: "b" });
    const read = await adopted?.updateStatus(row?.id ?? "", "read");
    expect(read?.status).toBe("read");
    await expect(adopted?.updateStatus(row?.id ?? "", "failed")).rejects.toThrow(/updateStatus/);
  });
});

function runtimeAgents(store: Store) {
  return {
    async get(id: string) {
      const agent = await store.agents.get(id);
      if (!agent) return null;
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        prompt: agent.systemPrompt,
        toolAllowlist: agent.toolIds,
        a2aEnabled: true,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      };
    },
    async getByName(name: string) {
      const agents = await store.agents.list();
      const match = agents.find((agent) => agent.name === name);
      if (!match) return null;
      return this.get(match.id);
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("unused");
    },
    async update() {
      throw new Error("unused");
    },
    async delete() {
      throw new Error("unused");
    },
  };
}
