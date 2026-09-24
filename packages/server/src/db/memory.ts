import { randomUUID } from "node:crypto";
import {
  AGENT_COLORS,
  AGENT_MESSAGE_STATUSES,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  type Agent,
  type AgentColor,
  type AgentMessage,
  type AgentMessagePatch,
  type AgentMessageStatus,
  type AgentPatch,
  type Chat,
  type ChatPatch,
  type Message,
  type ModelProfile,
  type NewAgent,
  type NewAgentMessage,
  type NewChat,
  type NewMessage,
  type Session,
  type Store,
  type ToolCall,
} from "../types.ts";

const ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Process-local stand-in used when DATABASE_URL is unset.
 * Data does not survive a restart.
 */
export function createMemoryStore(): Store {
  const agents = new Map<string, Agent>();
  const chats = new Map<string, Chat>();
  const messages: Message[] = [];
  const sessions = new Map<string, Session>();
  const sessionsByHash = new Map<string, string>();
  const profiles = new Map<string, ModelProfile>();
  const agentMessages = new Map<string, AgentMessage>();

  let clock = 0;
  const timestamp = (): string => {
    const millis = Math.max(Date.now(), clock + 1);
    clock = millis;
    return new Date(millis).toISOString();
  };

  return {
    kind: "memory",
    async close() {},
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
          name: requireName(input.name),
          icon: normalizeIcon(input.icon),
          color: normalizeColor(input.color),
          description: input.description,
          systemPrompt: input.systemPrompt,
          toolIds: [...input.toolIds],
          defaultProfileId: normalizeProfileId(input.defaultProfileId),
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
        if (patch.name !== undefined) next.name = requireName(patch.name);
        if (patch.icon !== undefined) next.icon = normalizeIcon(patch.icon);
        if (patch.color !== undefined) next.color = normalizeColor(patch.color);
        if (patch.description !== undefined) next.description = patch.description;
        if (patch.systemPrompt !== undefined) next.systemPrompt = patch.systemPrompt;
        if (patch.defaultProfileId !== undefined) {
          next.defaultProfileId = normalizeProfileId(patch.defaultProfileId);
        }
        agents.set(id, next);
        return clone(next);
      },
      async delete(id) {
        if (!agents.has(id)) return false;
        for (const message of agentMessages.values()) {
          if (message.fromAgentId === id || message.toAgentId === id) {
            agentMessages.delete(message.id);
          }
        }
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
        const message = materializeMessage(input, randomUUID(), timestamp());
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
    profiles: {
      async list() {
        return [...profiles.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(copyProfile);
      },
      async get(id) {
        const profile = profiles.get(id);
        return profile ? copyProfile(profile) : null;
      },
      async upsert(profile: ModelProfile) {
        const stored = copyProfile(profile);
        profiles.set(stored.id, stored);
        return copyProfile(stored);
      },
      async delete(id) {
        return profiles.delete(id);
      },
    },
    agentMessages: {
      async list(query) {
        return [...agentMessages.values()]
          .filter((message) => matchesAgentMessage(message, query))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(clone);
      },
      async get(id) {
        const message = agentMessages.get(id);
        return message ? clone(message) : null;
      },
      async create(input: NewAgentMessage) {
        const body = input.body.trim();
        if (!body) throw new Error("agent message body is required");
        if (input.fromAgentId === input.toAgentId) {
          throw new Error("agent message endpoints must be different agents");
        }
        if (!agents.has(input.fromAgentId) || !agents.has(input.toAgentId)) {
          throw new Error("agent message endpoints must reference existing agents");
        }
        const now = timestamp();
        const message: AgentMessage = {
          id: randomUUID(),
          fromAgentId: input.fromAgentId,
          toAgentId: input.toAgentId,
          body,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        agentMessages.set(message.id, message);
        return clone(message);
      },
      async update(id: string, patch: AgentMessagePatch) {
        const current = agentMessages.get(id);
        if (!current) return null;
        if (patch.status !== undefined) assertAgentMessageStatus(patch.status);
        const next: AgentMessage = {
          ...current,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedAt: timestamp(),
        };
        agentMessages.set(id, next);
        return clone(next);
      },
    },
  };
}

function materializeMessage(input: NewMessage, id: string, createdAt: string): Message {
  if (input.role === "tool" && !input.toolCallId?.trim()) {
    throw new Error("tool messages require toolCallId");
  }
  const message: Message = {
    id,
    chatId: input.chatId,
    role: input.role,
    content: input.content,
    createdAt,
  };
  if (input.toolCalls && input.toolCalls.length > 0) {
    message.toolCalls = input.toolCalls.map(copyToolCall);
  }
  if (input.toolCallId?.trim()) message.toolCallId = input.toolCallId.trim();
  if (input.name?.trim()) message.name = input.name.trim();
  if (input.profileId) message.profileId = input.profileId;
  return message;
}

function copyToolCall(call: ToolCall): ToolCall {
  return {
    id: call.id,
    name: call.name,
    arguments: clone(call.arguments),
  };
}

function copyProfile(profile: ModelProfile): ModelProfile {
  if (!PROFILE_ID_PATTERN.test(profile.id)) {
    throw new Error("profile id must be 1-64 characters of letters, numbers, '_' or '-'");
  }
  const stored: ModelProfile = {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
  };
  if (profile.baseUrl !== undefined) stored.baseUrl = profile.baseUrl;
  return stored;
}

function matchesAgentMessage(
  message: AgentMessage,
  query: { agentId?: string; status?: AgentMessageStatus } | undefined,
): boolean {
  if (!query) return true;
  if (query.agentId && message.fromAgentId !== query.agentId && message.toAgentId !== query.agentId) {
    return false;
  }
  if (query.status && message.status !== query.status) return false;
  return true;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error("name must be 1-40 characters");
  }
  return trimmed;
}

function normalizeIcon(icon: string | undefined): string {
  if (icon === undefined) return DEFAULT_AGENT_ICON;
  if (!ICON_PATTERN.test(icon)) {
    throw new Error('icon must be a Lucide icon name such as "Bot"');
  }
  return icon;
}

function normalizeColor(color: AgentColor | undefined): AgentColor {
  if (color === undefined) return DEFAULT_AGENT_COLOR;
  if (!(AGENT_COLORS as readonly string[]).includes(color)) {
    throw new Error(`color must be one of ${AGENT_COLORS.join(", ")}`);
  }
  return color;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!PROFILE_ID_PATTERN.test(trimmed)) {
    throw new Error("defaultProfileId must be a profile id");
  }
  return trimmed;
}

function assertAgentMessageStatus(status: AgentMessageStatus): void {
  if (!(AGENT_MESSAGE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`status must be one of ${AGENT_MESSAGE_STATUSES.join(", ")}`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
