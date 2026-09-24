import {
  AgentInUseError,
  AgentNotFoundError,
  ChatNotFoundError,
  ValidationError,
  type AgentRecord,
  type ChatRecord,
  type MessageRecord,
  type Store as RuntimeStore,
} from "@botanical/agent-runtime";
import type { Agent, Chat, Message, Store } from "../types.ts";

/**
 * Presents the HTTP store as the agent-runtime store.
 * Agent prompts are the server's `systemPrompt`. Allowlists are `toolIds`.
 * A2A rows are the HTTP store's `agentMessages` repository.
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
          icon: "Bot",
          color: "green",
          description: input.description,
          systemPrompt: input.prompt,
          toolIds: [...input.toolAllowlist],
          defaultProfileId: null,
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
    agentMessages: store.agentMessages,
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

