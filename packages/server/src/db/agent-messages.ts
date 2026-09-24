import type { AgentMessageRepository, AgentMessageStatus, Store } from "../types.ts";
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
      ...store,
      agentMessages: adopted,
    };
  }
  const memory = createMemoryStore();
  return {
    ...store,
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
  if (
    typeof repo.updateStatus === "function" &&
    typeof repo.list === "function" &&
    typeof repo.create === "function" &&
    typeof repo.update === "function"
  ) {
    return repo as AgentMessageRepository;
  }
  const get = repo.get.bind(repo);
  const markRead = repo.markRead.bind(repo);
  const listForAgent = repo.listForAgent.bind(repo);
  const insert = repo.insert.bind(repo);
  async function updateStatus(id: string, status: AgentMessageStatus) {
    if (typeof repo.updateStatus === "function") return repo.updateStatus(id, status);
    const current = await get(id);
    if (!current) return null;
    if (current.status === status) return current;
    if (status === "read" && current.status === "delivered") {
      const updated = await markRead([id]);
      return updated.find((message) => message.id === id) ?? (await get(id));
    }
    throw new Error("agentMessages.updateStatus is not implemented by the persistence store");
  }
  return {
    insert,
    get,
    listForAgent,
    deliverPending: repo.deliverPending.bind(repo),
    markRead,
    updateStatus,
    list:
      typeof repo.list === "function"
        ? repo.list.bind(repo)
        : async (query) => {
            if (!query?.agentId) return [];
            return listForAgent(query.agentId, query.status ? { status: [query.status] } : {});
          },
    create: typeof repo.create === "function" ? repo.create.bind(repo) : async (input) => insert(input),
    update:
      typeof repo.update === "function"
        ? repo.update.bind(repo)
        : async (id, patch) => {
            if (patch.status === undefined) return get(id);
            return updateStatus(id, patch.status);
          },
  };
}
