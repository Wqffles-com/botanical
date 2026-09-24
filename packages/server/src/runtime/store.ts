import {
  AgentInUseError,
  AgentNotFoundError,
  ChatNotFoundError,
  ValidationError,
  newId,
  nowIso,
  type AgentMessageRecord,
  type AgentMessageRepository,
  type AgentRecord,
  type ChatRecord,
  type MessageRecord,
  type NewAgentMessage,
  type Store as RuntimeStore,
} from "@botanical/agent-runtime";
import type { Agent, Chat, Message, Store } from "../types.ts";

/**
 * Presents the HTTP store as the agent-runtime store.
 * Agent prompts are the server's `systemPrompt`. Allowlists are `toolIds`.
 * A2A rows stay in memory until the HTTP store grows an inbox table.
 */
export function adaptServerStore(store: Store): RuntimeStore {
  return {
    agents: {
      async get(id) {
        const agent = await store.agents.get(id);
        return agent ? toAgent(agent) : null;
      },
      async getByName(name) {
        const agents = await store.agents.list();
        const match = agents.find((agent) => agent.name === name);
        return match ? toAgent(match) : null;
      },
      async list(limit = 200) {
        const agents = await store.agents.list();
        return agents.slice(0, limit).map(toAgent);
      },
      async create(input) {
        const agent = await store.agents.create({
          name: input.name,
          description: input.description,
          systemPrompt: input.prompt,
          toolIds: [...input.toolAllowlist],
        });
        return toAgent(agent);
      },
      async update(id, patch) {
        const updated = await store.agents.update(id, {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.prompt !== undefined ? { systemPrompt: patch.prompt } : {}),
          ...(patch.toolAllowlist !== undefined ? { toolIds: [...patch.toolAllowlist] } : {}),
        });
        if (!updated) throw new AgentNotFoundError(id);
        return toAgent(updated);
      },
      async delete(id) {
        const existing = await store.agents.get(id);
        if (!existing) throw new AgentNotFoundError(id);
        const owned = await store.chats.countByAgent(id);
        if (owned > 0) throw new AgentInUseError(id);
        await store.agents.delete(id);
      },
    },
    chats: {
      async get(id) {
        const chat = await store.chats.get(id);
        return chat ? toChat(chat) : null;
      },
      async list(limit = 200) {
        const chats = await store.chats.list();
        return chats.slice(0, limit).map(toChat);
      },
      async listByAgent(agentId) {
        const chats = await store.chats.list();
        return chats.filter((chat) => chat.agentId === agentId).map(toChat);
      },
      async create() {
        throw new ValidationError("Create chats through POST /api/chats so a profile is explicit");
      },
      async updateTitle(id, title) {
        const updated = await store.chats.update(id, { title });
        if (!updated) throw new ChatNotFoundError(id);
        return toChat(updated);
      },
      async touch(id) {
        const updated = await store.chats.update(id, {});
        if (!updated) throw new ChatNotFoundError(id);
      },
    },
    messages: {
      async listByChat(chatId) {
        const messages = await store.messages.listByChat(chatId);
        return messages.map(toMessage);
      },
      async append(input) {
        const created = await store.messages.create({
          chatId: input.chatId,
          role: input.role,
          content: input.content,
          ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
          ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.profileId ? { profileId: input.profileId } : {}),
        });
        return toMessage(created);
      },
    },
    agentMessages: memoryAgentMessages(),
  };
}

function toAgent(agent: Agent): AgentRecord {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    prompt: agent.systemPrompt,
    toolAllowlist: [...agent.toolIds],
    a2aEnabled: false,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function toChat(chat: Chat): ChatRecord {
  return {
    id: chat.id,
    agentId: chat.agentId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

function toMessage(message: Message): MessageRecord {
  const row: MessageRecord = {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
  if (message.toolCalls) row.toolCalls = message.toolCalls;
  if (message.toolCallId) row.toolCallId = message.toolCallId;
  if (message.name) row.name = message.name;
  if (message.profileId) row.profileId = message.profileId;
  return row;
}

function memoryAgentMessages(): AgentMessageRepository {
  const rows: AgentMessageRecord[] = [];
  return {
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
      rows.push(row);
      return structuredClone(row);
    },
    async get(id) {
      const row = rows.find((message) => message.id === id);
      return row ? structuredClone(row) : null;
    },
    async listForAgent(agentId, opts) {
      const limit = opts?.limit ?? 100;
      const filtered = rows.filter((message) => {
        if (message.toAgentId !== agentId) return false;
        if (opts?.status && !opts.status.includes(message.status)) return false;
        return true;
      });
      const ordered = opts?.newestFirst ? [...filtered].reverse() : filtered;
      return ordered.slice(0, limit).map((message) => structuredClone(message));
    },
    async deliverPending(opts) {
      const limit = opts?.limit ?? 50;
      const delivered: AgentMessageRecord[] = [];
      for (const row of rows) {
        if (delivered.length >= limit) break;
        if (row.status !== "pending") continue;
        if (opts?.toAgentId && row.toAgentId !== opts.toAgentId) continue;
        row.status = "delivered";
        row.deliveredAt = nowIso();
        delivered.push(structuredClone(row));
      }
      return delivered;
    },
    async markRead(ids) {
      const wanted = new Set(ids);
      const updated: AgentMessageRecord[] = [];
      for (const row of rows) {
        if (!wanted.has(row.id) || row.status !== "delivered") continue;
        row.status = "read";
        row.readAt = nowIso();
        updated.push(structuredClone(row));
      }
      return updated;
    },
  };
}
