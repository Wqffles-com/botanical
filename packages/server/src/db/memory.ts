import { randomUUID } from "node:crypto";
import { EXAMPLE_AGENTS, EXAMPLE_AGENTS_CREATED_AT } from "@botanical/core";
import type {
  Agent,
  AgentMessage,
  AgentMessageStatus,
  AgentPatch,
  Chat,
  ChatPatch,
  Message,
  NewAgent,
  NewAgentMessage,
  NewChat,
  NewMessage,
  Session,
  Store,
} from "../types.ts";

/**
 * Process-local stand-in used when DATABASE_URL is unset.
 * TODO(packages/db): do not use this for a real deploy once Postgres is wired.
 */
export function createMemoryStore(options?: { seed?: boolean }): Store {
  const agents = new Map<string, Agent>();
  const chats = new Map<string, Chat>();
  const messages: Message[] = [];
  const agentMessages: AgentMessage[] = [];
  const sessions = new Map<string, Session>();
  const sessionsByHash = new Map<string, string>();

  let clock = 0;
  const timestamp = (): string => {
    const millis = Math.max(Date.now(), clock + 1);
    clock = millis;
    return new Date(millis).toISOString();
  };

  if (options?.seed) {
    for (const example of EXAMPLE_AGENTS) {
      agents.set(example.id, {
        id: example.id,
        name: example.name,
        icon: example.icon,
        color: example.color,
        description: example.description,
        systemPrompt: example.prompt,
        toolIds: [...example.tools],
        defaultProfileId: null,
        createdAt: EXAMPLE_AGENTS_CREATED_AT,
        updatedAt: EXAMPLE_AGENTS_CREATED_AT,
      });
    }
  }

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
          icon: input.icon,
          color: input.color,
          description: input.description,
          systemPrompt: input.systemPrompt,
          toolIds: [...input.toolIds],
          defaultProfileId: input.defaultProfileId,
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
        if (patch.icon !== undefined) next.icon = patch.icon;
        if (patch.color !== undefined) next.color = patch.color;
        if (patch.description !== undefined) next.description = patch.description;
        if (patch.systemPrompt !== undefined) next.systemPrompt = patch.systemPrompt;
        if (patch.defaultProfileId !== undefined) next.defaultProfileId = patch.defaultProfileId;
        agents.set(id, next);
        return clone(next);
      },
      async delete(id) {
        const removed = agents.delete(id);
        if (!removed) return false;
        for (let index = agentMessages.length - 1; index >= 0; index -= 1) {
          const row = agentMessages[index];
          if (row && (row.fromAgentId === id || row.toAgentId === id)) {
            agentMessages.splice(index, 1);
          }
        }
        return true;
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
    agentMessages: {
      async insert(input: NewAgentMessage) {
        const now = timestamp();
        const row: AgentMessage = {
          id: input.id ?? randomUUID(),
          fromAgentId: input.fromAgentId,
          toAgentId: input.toAgentId,
          body: input.body,
          status: "pending",
          createdAt: now,
          updatedAt: now,
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
        const ordered = [...filtered].sort((a, b) => {
          const byTime = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
          return opts?.newestFirst ? -byTime : byTime;
        });
        return ordered.slice(0, limit).map(clone);
      },
      async deliverPending(opts) {
        const limit = opts?.limit ?? 50;
        const pending = agentMessages
          .filter((message) => {
            if (message.status !== "pending") return false;
            if (opts?.toAgentId && message.toAgentId !== opts.toAgentId) return false;
            return true;
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        const delivered: AgentMessage[] = [];
        for (const row of pending) {
          if (delivered.length >= limit) break;
          const now = timestamp();
          row.status = "delivered";
          row.deliveredAt = now;
          row.updatedAt = now;
          delivered.push(clone(row));
        }
        return delivered;
      },
      async markRead(ids) {
        const wanted = new Set(ids);
        const updated: AgentMessage[] = [];
        for (const row of agentMessages) {
          if (!wanted.has(row.id) || row.status !== "delivered") continue;
          const now = timestamp();
          row.status = "read";
          row.readAt = now;
          row.updatedAt = now;
          updated.push(clone(row));
        }
        return updated;
      },
      async updateStatus(id, status: AgentMessageStatus) {
        const row = agentMessages.find((message) => message.id === id);
        if (!row) return null;
        if (row.status === status) return clone(row);
        const now = timestamp();
        row.status = status;
        row.updatedAt = now;
        if (status === "delivered") row.deliveredAt = now;
        if (status === "read") row.readAt = now;
        return clone(row);
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
