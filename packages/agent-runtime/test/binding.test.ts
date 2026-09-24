import { describe, expect, test } from "bun:test";
import { createAgentSchema } from "../src/agent";
import { assertChatAgentBinding, rejectAgentRebind } from "../src/binding";
import { AgentBindingError, AgentInUseError, AgentNotFoundError } from "../src/errors";
import { createMemoryStore } from "../src/memory";

describe("one agent per chat", () => {
  test("a different agent id is rejected and the binding stays", () => {
    const chat = { agentId: "ada" };
    expect(() => assertChatAgentBinding(chat, "bea")).toThrow(AgentBindingError);
    expect(() => assertChatAgentBinding(chat, "ada")).not.toThrow();
    expect(() => assertChatAgentBinding(chat, undefined)).not.toThrow();
    expect(() => rejectAgentRebind(chat)).toThrow(AgentBindingError);
  });

  test("creating a chat requires an existing agent and never changes it", async () => {
    const store = createMemoryStore();
    const ada = await store.agents.create(
      createAgentSchema.parse({ name: "Ada", prompt: "Research." }),
    );
    await expect(store.chats.create({ agentId: "missing" })).rejects.toBeInstanceOf(AgentNotFoundError);
    const chat = await store.chats.create({ agentId: ada.id, title: "Thread" });
    expect(chat.agentId).toBe(ada.id);
    await expect(store.agents.delete(ada.id)).rejects.toBeInstanceOf(AgentInUseError);
    expect(await store.agents.get(ada.id)).not.toBeNull();
  });
});
