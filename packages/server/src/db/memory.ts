import { randomUUID } from "node:crypto";
import type {
  Agent,
  AgentPatch,
  Chat,
  ChatPatch,
  Message,
  NewAgent,
  NewChat,
  NewMessage,
  Session,
  Store,
} from "../types.ts";

/**
 * Process-local stand-in used when DATABASE_URL is unset.
 * TODO(packages/db): do not use this for a real deploy once Postgres is wired.
 */
export function createMemoryStore(): Store {
  const agents = new Map<string, Agent>();
  const chats = new Map<string, Chat>();
  const messages: Message[] = [];
  const sessions = new Map<string, Session>();
  const sessionsByHash = new Map<string, string>();

  let clock = 0;
  const timestamp = (): string => {
    const millis = Math.max(Date.now(), clock + 1);
    clock = millis;
    return new Date(millis).toISOString();
  };

  return {
    kind: "memory",
    agents: {
      async list() {
        return [...agents.values()]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(clone);
      },
      async get(id) {
        const agent = agents.get(id);
        return agent ? clone(agent) : null;
      },
      async create(input: NewAgent) {
        const now = timestamp();
        const agent: Agent = {
          id: randomUUID(),
          name: input.name,
          description: input.description,
          systemPrompt: input.systemPrompt,
          toolIds: [...input.toolIds],
          createdAt: now,
          updatedAt: now,
        };
        agents.set(agent.id, agent);
        return clone(agent);
      },
      async update(id: string, patch: AgentPatch) {
        const current = agents.get(id);
        if (!current) return null;
        const next: Agent = {
          ...current,
          toolIds: patch.toolIds !== undefined ? [...patch.toolIds] : current.toolIds,
          updatedAt: timestamp(),
        };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.description !== undefined) next.description = patch.description;
        if (patch.systemPrompt !== undefined) next.systemPrompt = patch.systemPrompt;
        agents.set(id, next);
        return clone(next);
      },
      async delete(id) {
        return agents.delete(id);
      },
    },
    chats: {
      async list() {
        return [...chats.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
          .map(clone);
      },
      async get(id) {
        const chat = chats.get(id);
        return chat ? clone(chat) : null;
      },
      async create(input: NewChat) {
        const now = timestamp();
        const chat: Chat = {
          id: randomUUID(),
          agentId: input.agentId,
          profileId: input.profileId,
          title: input.title,
          createdAt: now,
          updatedAt: now,
        };
        chats.set(chat.id, chat);
        return clone(chat);
      },
      async update(id: string, patch: ChatPatch) {
        const current = chats.get(id);
        if (!current) return null;
        const next: Chat = {
          ...current,
          updatedAt: timestamp(),
        };
        if (patch.title !== undefined) next.title = patch.title;
        if (patch.profileId !== undefined) next.profileId = patch.profileId;
        chats.set(id, next);
        return clone(next);
      },
      async delete(id) {
        return chats.delete(id);
      },
      async countByAgent(agentId) {
        let count = 0;
        for (const chat of chats.values()) {
          if (chat.agentId === agentId) count += 1;
        }
        return count;
      },
    },
    messages: {
      async listByChat(chatId) {
        return messages.filter((message) => message.chatId === chatId).map(clone);
      },
      async create(input: NewMessage) {
        const message: Message = {
          id: randomUUID(),
          chatId: input.chatId,
          role: input.role,
          content: input.content,
          createdAt: timestamp(),
        };
        if (input.toolCalls) message.toolCalls = clone(input.toolCalls);
        if (input.toolCallId) message.toolCallId = input.toolCallId;
        if (input.name) message.name = input.name;
        if (input.profileId) message.profileId = input.profileId;
        messages.push(message);
        return clone(message);
      },
      async deleteByChat(chatId) {
        let removed = 0;
        for (let index = messages.length - 1; index >= 0; index--) {
          if (messages[index]?.chatId === chatId) {
            messages.splice(index, 1);
            removed += 1;
          }
        }
        return removed;
      },
    },
    sessions: {
      async create(session: Session) {
        const stored = clone(session);
        sessions.set(stored.id, stored);
        sessionsByHash.set(stored.tokenHash, stored.id);
        return clone(stored);
      },
      async getByTokenHash(tokenHash) {
        const id = sessionsByHash.get(tokenHash);
        if (!id) return null;
        const session = sessions.get(id);
        return session ? clone(session) : null;
      },
      async delete(id) {
        const current = sessions.get(id);
        if (!current) return false;
        sessions.delete(id);
        sessionsByHash.delete(current.tokenHash);
        return true;
      },
    },
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
