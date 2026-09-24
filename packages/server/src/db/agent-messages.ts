import type { AgentMessageRepository, Store } from "../types.ts";
import { createMemoryStore } from "./memory.ts";

/**
 * Use the persistence store's `agentMessages` when it implements the contract
 * (m11's Postgres repository against `agent_messages`). Otherwise attach the
 * in-memory repository so callers see one interface.
 */
export function attachAgentMessages(store: Store): Store {
  const adopted = adoptAgentMessages(store.agentMessages);
  if (adopted && adopted === store.agentMessages) return store;
  if (adopted) {
    return {
      kind: store.kind,
      agents: store.agents,
      chats: store.chats,
      messages: store.messages,
      sessions: store.sessions,
      agentMessages: adopted,
    };
  }
  const memory = createMemoryStore();
  return {
    kind: store.kind,
    agents: store.agents,
    chats: store.chats,
    messages: store.messages,
    sessions: store.sessions,
    agentMessages: memory.agentMessages,
  };
}

/**
 * Accept a full repository, or the agent-runtime subset (`insert`, `get`,
 * `listForAgent`, `deliverPending`, `markRead`) and fill `updateStatus`
 * from `markRead` when the only requested write is delivered → read.
 */
export function adoptAgentMessages(value: unknown): AgentMessageRepository | null {
  if (!value || typeof value !== "object") return null;
  const repo = value as Partial<AgentMessageRepository>;
  if (
    typeof repo.insert !== "function" ||
    typeof repo.get !== "function" ||
    typeof repo.listForAgent !== "function" ||
    typeof repo.deliverPending !== "function" ||
    typeof repo.markRead !== "function"
  ) {
    return null;
  }
  if (typeof repo.updateStatus === "function") {
    return repo as AgentMessageRepository;
  }
  const get = repo.get.bind(repo);
  const markRead = repo.markRead.bind(repo);
  return {
    insert: repo.insert.bind(repo),
    get,
    listForAgent: repo.listForAgent.bind(repo),
    deliverPending: repo.deliverPending.bind(repo),
    markRead,
    async updateStatus(id, status) {
      const current = await get(id);
      if (!current) return null;
      if (current.status === status) return current;
      if (status === "read" && current.status === "delivered") {
        const updated = await markRead([id]);
        return updated.find((message) => message.id === id) ?? (await get(id));
      }
      throw new Error(
        "agentMessages.updateStatus is not implemented by the persistence store",
      );
    },
  };
}
