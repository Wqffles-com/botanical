import type { AgentRecord, CreateAgentInput, UpdateAgentInput } from "./agent";
import type { AgentMessageRecord, NewAgentMessage } from "./a2a";
import type { ChatRecord } from "./chat";
import { AgentInUseError, AgentNotFoundError, ChatNotFoundError } from "./errors";
import { newId, nowIso } from "./ids";
import type { MessageRecord, NewMessage } from "./message";
import type {
  AgentMessageRepository,
  AgentRepository,
  ChatRepository,
  MessageRepository,
  Store,
} from "./store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Process-local store used by tests and by the server when DATABASE_URL is unset.
 * Ordering follows insertion, which matches the Postgres identity-column order.
 */
export function createMemoryStore(): Store {
  const agents = new Map<string, AgentRecord>();
  const chats = new Map<string, ChatRecord>();
  const messages: MessageRecord[] = [];
  const agentMessages: AgentMessageRecord[] = [];

  const agentRepo: AgentRepository = {
    async get(id) {
      const row = agents.get(id);
      return row ? clone(row) : null;
    },
    async getByName(name) {
      const matches = [...agents.values()]
        .filter((agent) => agent.name === name)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return matches[0] ? clone(matches[0]) : null;
    },
    async list(limit = 200) {
      return [...agents.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(clone);
    },
    async create(input: CreateAgentInput) {
      const ts = nowIso();
      const row: AgentRecord = {
        id: input.id ?? newId(),
        name: input.name,
        description: input.description,
        prompt: input.prompt,
        toolAllowlist: [...input.toolAllowlist],
        a2aEnabled: input.a2aEnabled,
        createdAt: ts,
        updatedAt: ts,
      };
      agents.set(row.id, row);
      return clone(row);
    },
    async update(id, patch: UpdateAgentInput) {
      const current = agents.get(id);
      if (!current) throw new AgentNotFoundError(id);
      const next: AgentRecord = {
        ...current,
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        prompt: patch.prompt ?? current.prompt,
        toolAllowlist: patch.toolAllowlist ? [...patch.toolAllowlist] : [...current.toolAllowlist],
        a2aEnabled: patch.a2aEnabled ?? current.a2aEnabled,
        updatedAt: nowIso(),
      };
      agents.set(id, next);
      return clone(next);
    },
    async delete(id) {
      if (!agents.has(id)) throw new AgentNotFoundError(id);
      const ownsChat = [...chats.values()].some((chat) => chat.agentId === id);
      if (ownsChat) throw new AgentInUseError(id);
      agents.delete(id);
      for (let i = agentMessages.length - 1; i >= 0; i -= 1) {
        const row = agentMessages[i];
        if (row && (row.fromAgentId === id || row.toAgentId === id)) {
          agentMessages.splice(i, 1);
        }
      }
    },
  };

  const chatRepo: ChatRepository = {
    async get(id) {
      const row = chats.get(id);
      return row ? clone(row) : null;
    },
    async list(limit = 200) {
      return [...chats.values()]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(clone);
    },
    async listByAgent(agentId) {
      return [...chats.values()].filter((chat) => chat.agentId === agentId).map(clone);
    },
    async create(input) {
      if (!agents.has(input.agentId)) throw new AgentNotFoundError(input.agentId);
      const ts = nowIso();
      const row: ChatRecord = {
        id: input.id ?? newId(),
        agentId: input.agentId,
        title: input.title?.trim() ?? "",
        createdAt: ts,
        updatedAt: ts,
      };
      chats.set(row.id, row);
      return clone(row);
    },
    async updateTitle(id, title) {
      const current = chats.get(id);
      if (!current) throw new ChatNotFoundError(id);
      current.title = title;
      current.updatedAt = nowIso();
      return clone(current);
    },
    async touch(id) {
      const current = chats.get(id);
      if (!current) throw new ChatNotFoundError(id);
      current.updatedAt = nowIso();
    },
  };

  const messageRepo: MessageRepository = {
    async listByChat(chatId) {
      return messages.filter((message) => message.chatId === chatId).map(clone);
    },
    async append(input: NewMessage) {
      if (!chats.has(input.chatId)) throw new ChatNotFoundError(input.chatId);
      const row: MessageRecord = {
        id: input.id ?? newId(),
        chatId: input.chatId,
        role: input.role,
        content: input.content,
        createdAt: nowIso(),
      };
      if (input.toolCalls) row.toolCalls = clone(input.toolCalls);
      if (input.toolCallId) row.toolCallId = input.toolCallId;
      if (input.name) row.name = input.name;
      if (input.profileId) row.profileId = input.profileId;
      messages.push(row);
      return clone(row);
    },
  };

  const agentMessageRepo: AgentMessageRepository = {
    async insert(input: NewAgentMessage) {
      const row: AgentMessageRecord = {
        id: input.id ?? newId(),
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        body: input.body,
        status: "pending",
        createdAt: nowIso(),
      };
      if (input.fromChatId) row.fromChatId = input.fromChatId;
      agentMessages.push(row);
      return clone(row);
    },
    async get(id) {
      const row = agentMessages.find((message) => message.id === id);
      return row ? clone(row) : null;
    },
    async listForAgent(agentId, opts) {
      const limit = opts?.limit ?? 100;
      const filtered = agentMessages.filter((message) => {
        if (message.toAgentId !== agentId) return false;
        if (opts?.status && !opts.status.includes(message.status)) return false;
        return true;
      });
      const ordered = opts?.newestFirst ? [...filtered].reverse() : filtered;
      return ordered.slice(0, limit).map(clone);
    },
    async deliverPending(opts) {
      const limit = opts?.limit ?? 50;
      const delivered: AgentMessageRecord[] = [];
      for (const row of agentMessages) {
        if (delivered.length >= limit) break;
        if (row.status !== "pending") continue;
        if (opts?.toAgentId && row.toAgentId !== opts.toAgentId) continue;
        row.status = "delivered";
        row.deliveredAt = nowIso();
        delivered.push(clone(row));
      }
      return delivered;
    },
    async markRead(ids) {
      const wanted = new Set(ids);
      const updated: AgentMessageRecord[] = [];
      for (const row of agentMessages) {
        if (!wanted.has(row.id) || row.status !== "delivered") continue;
        row.status = "read";
        row.readAt = nowIso();
        updated.push(clone(row));
      }
      return updated;
    },
  };

  return {
    agents: agentRepo,
    chats: chatRepo,
    messages: messageRepo,
    agentMessages: agentMessageRepo,
  };
}
