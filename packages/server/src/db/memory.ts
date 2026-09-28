import { randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  EXAMPLE_AGENTS,
  EXAMPLE_AGENTS_CREATED_AT,
  isAgentColor,
  isAgentIcon,
  type AgentColor,
} from "@botanical/core";
import { currentUserId, pinStore } from "@botanical/db";
import { createAlwaysOn, MEMORY_OPERATOR_ID } from "./always-on.ts";
import { createMemoryAccounts } from "./memory-accounts.ts";
import { createPlatform } from "./platform.ts";
import {
  AGENT_MESSAGE_STATUSES,
  type Agent,
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

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Process-local stand-in used when DATABASE_URL is unset.
 * Data does not survive a restart.
 * Pass `{ seed: true }` for the three example agents (Gardener, Builder, Scout).
 */
export function createMemoryStore(options?: { seed?: boolean; now?: () => Date; encryptionKey?: string }): Store {
  const agents = new Map<string, Agent>();
  const alwaysOn = createAlwaysOn({
    now: options?.now ?? (() => new Date()),
    hasAgent: (id) => agents.has(id),
  });
  const chats = new Map<string, Chat>();
  const messages: Message[] = [];
  const agentMessages = new Map<string, AgentMessage>();
  const sessions = new Map<string, Session>();
  const sessionsByHash = new Map<string, string>();
  const profiles = new Map<string, ModelProfile>();
  const profileOwners = new Map<string, string | null>();
  const agentOwners = new Map<string, string>();
  const chatOwners = new Map<string, string>();
  const memoryOwners = new Map<string, string>();

  function acting(): string {
    return currentUserId() ?? MEMORY_OPERATOR_ID;
  }

  function seesAgent(id: string): boolean {
    const owner = agentOwners.get(id);
    if (!owner) return currentUserId() === null;
    return owner === acting();
  }

  function profileKey(owner: string | null, id: string): string {
    return `${owner ?? "global"}\0${id}`;
  }

  let clock = 0;
  const timestamp = (): string => {
    const millis = Math.max(Date.now(), clock + 1);
    clock = millis;
    return new Date(millis).toISOString();
  };

  const platform = createPlatform(timestamp);

  function presentAgent(agent: Agent): Agent {
    const roleIds = platform.roleIds(agent.id);
    return clone({
      ...agent,
      toolIds: [...agent.toolIds],
      roleIds,
      roles: platform.summaries(roleIds),
    });
  }

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
        createdByAgentId: null,
        roleIds: [],
        roles: [],
        createdAt: EXAMPLE_AGENTS_CREATED_AT,
        updatedAt: EXAMPLE_AGENTS_CREATED_AT,
      });
      agentOwners.set(example.id, MEMORY_OPERATOR_ID);
    }
  }

  function adoptLegacy(userId: string): void {
    for (const [id, owner] of agentOwners) {
      if (owner === MEMORY_OPERATOR_ID) agentOwners.set(id, userId);
    }
    for (const [id, owner] of chatOwners) {
      if (owner === MEMORY_OPERATOR_ID) chatOwners.set(id, userId);
    }
    for (const [id, owner] of memoryOwners) {
      if (owner === MEMORY_OPERATOR_ID) memoryOwners.set(id, userId);
    }
    for (const [key, owner] of profileOwners) {
      if (owner === MEMORY_OPERATOR_ID) profileOwners.set(key, userId);
    }
    alwaysOn.reassign(MEMORY_OPERATOR_ID, userId);
  }

  const services = createMemoryAccounts({
    encryptionKey: options?.encryptionKey,
    now: timestamp,
    adoptLegacy,
    legacyUserId: MEMORY_OPERATOR_ID,
  });

  function visibleProfiles(): ModelProfile[] {
    const merged = new Map<string, ModelProfile>();
    for (const [key, profile] of profiles) {
      if (profileOwners.get(key) === null) merged.set(profile.id, copyProfile(profile));
    }
    for (const [key, profile] of profiles) {
      if (profileOwners.get(key) === acting()) merged.set(profile.id, copyProfile(profile));
    }
    return [...merged.values()];
  }

  const store: Store = {
    kind: "memory",
    get scopeUserId() {
      return currentUserId();
    },
    forUser(userId: string) {
      return pinStore(store, userId);
    },
    accounts: services.accounts,
    secrets: services.secrets,
    prefs: services.prefs,
    async close() {},
    agents: {
      async list() {
        return [...agents.values()]
          .filter((agent) => agentOwners.get(agent.id) === acting())
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(presentAgent);
      },
      async get(id) {
        const agent = agents.get(id);
        if (!agent || agentOwners.get(id) !== acting()) return null;
        return presentAgent(agent);
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
          createdByAgentId: input.createdByAgentId ?? null,
          roleIds: [],
          roles: [],
          createdAt: now,
          updatedAt: now,
        };
        agents.set(agent.id, agent);
        agentOwners.set(agent.id, acting());
        if (input.roleIds && input.roleIds.length > 0) {
          await platform.roles.setForAgent(agent.id, input.roleIds);
          agent.roleIds = platform.roleIds(agent.id);
        }
        return presentAgent(agent);
      },
      async update(id: string, patch: AgentPatch) {
        const current = agents.get(id);
        if (!current || agentOwners.get(id) !== acting()) return null;
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
        if (patch.roleIds !== undefined) {
          await platform.roles.setForAgent(id, patch.roleIds);
          next.roleIds = platform.roleIds(id);
        }
        return presentAgent(next);
      },
      async delete(id) {
        if (!agents.has(id) || agentOwners.get(id) !== acting()) return false;
        agentOwners.delete(id);
        platform.onAgentDeleted(id);
        alwaysOn.onAgentDeleted(id);
        for (const agent of agents.values()) {
          if (agent.createdByAgentId === id) agent.createdByAgentId = null;
        }
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
          .filter((chat) => chatOwners.get(chat.id) === acting())
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
          .map(clone);
      },
      async get(id) {
        const chat = chats.get(id);
        if (!chat || chatOwners.get(id) !== acting()) return null;
        return clone(chat);
      },
      async create(input: NewChat) {
        if (agentOwners.get(input.agentId) !== acting()) throw new Error("agent not found");
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
        chatOwners.set(chat.id, acting());
        return clone(chat);
      },
      async update(id: string, patch: ChatPatch) {
        const current = chats.get(id);
        if (!current || chatOwners.get(id) !== acting()) return null;
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
        if (chatOwners.get(id) !== acting()) return false;
        chatOwners.delete(id);
        return chats.delete(id);
      },
      async countByAgent(agentId) {
        if (agentOwners.get(agentId) !== acting()) return 0;
        let count = 0;
        for (const chat of chats.values()) {
          if (chat.agentId === agentId && chatOwners.get(chat.id) === acting()) count += 1;
        }
        return count;
      },
    },
    messages: {
      async listByChat(chatId) {
        if (chatOwners.get(chatId) !== acting()) return [];
        return messages.filter((message) => message.chatId === chatId).map(clone);
      },
      async create(input: NewMessage) {
        if (chatOwners.get(input.chatId) !== acting()) throw new Error("chat not found");
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
        return visibleProfiles();
      },
      async get(id) {
        const own = profiles.get(profileKey(acting(), id));
        if (own) return copyProfile(own);
        const global = profiles.get(profileKey(null, id));
        return global ? copyProfile(global) : null;
      },
      async upsert(profile: ModelProfile) {
        const stored = copyProfile(profile);
        const key = profileKey(acting(), stored.id);
        profiles.set(key, stored);
        profileOwners.set(key, acting());
        return copyProfile(stored);
      },
      async delete(id) {
        const key = profileKey(acting(), id);
        profileOwners.delete(key);
        return profiles.delete(key);
      },
    },
    globalProfiles: {
      async list() {
        const rows: ModelProfile[] = [];
        for (const [key, profile] of profiles) {
          if (profileOwners.get(key) === null) rows.push(copyProfile(profile));
        }
        return rows.sort((a, b) => a.id.localeCompare(b.id));
      },
      async get(id) {
        const profile = profiles.get(profileKey(null, id));
        return profile ? copyProfile(profile) : null;
      },
      async upsert(profile: ModelProfile) {
        const stored = copyProfile(profile);
        const key = profileKey(null, stored.id);
        profiles.set(key, stored);
        profileOwners.set(key, null);
        return copyProfile(stored);
      },
      async delete(id) {
        const key = profileKey(null, id);
        profileOwners.delete(key);
        return profiles.delete(key);
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
        agentMessages.set(row.id, row);
        return clone(row);
      },
      async get(id) {
        const row = agentMessages.get(id);
        if (!row || !seesAgent(row.fromAgentId)) return null;
        return clone(row);
      },
      async listForAgent(agentId, opts) {
        if (agentOwners.get(agentId) !== acting()) return [];
        const limit = opts?.limit ?? 100;
        const filtered = [...agentMessages.values()].filter((message) => {
          if (message.toAgentId !== agentId) return false;
          if (opts?.status && !opts.status.includes(message.status)) return false;
          return true;
        });
        const ordered = filtered.sort((a, b) => {
          const byTime = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
          return opts?.newestFirst ? -byTime : byTime;
        });
        return ordered.slice(0, limit).map(clone);
      },
      async deliverPending(opts) {
        const limit = opts?.limit ?? 50;
        const pending = [...agentMessages.values()]
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
        for (const row of agentMessages.values()) {
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
        const row = agentMessages.get(id);
        if (!row) return null;
        if (row.status === status) return clone(row);
        const now = timestamp();
        row.status = status;
        row.updatedAt = now;
        if (status === "delivered") row.deliveredAt = now;
        if (status === "read") row.readAt = now;
        return clone(row);
      },
      async list(query) {
        return [...agentMessages.values()]
          .filter((message) => agentOwners.get(message.fromAgentId) === acting())
          .filter((message) => matchesAgentMessage(message, query))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
          .map(clone);
      },
      async create(input: NewAgentMessage) {
        const body = input.body.trim();
        if (!body) throw new Error("agent message body is required");
        if (input.fromAgentId === input.toAgentId) {
          throw new Error("agent message endpoints must be different agents");
        }
        if (agentOwners.get(input.fromAgentId) !== acting() || agentOwners.get(input.toAgentId) !== acting()) {
          throw new Error("agent message endpoints must reference existing agents");
        }
        const now = timestamp();
        const message: AgentMessage = {
          id: input.id ?? randomUUID(),
          fromAgentId: input.fromAgentId,
          toAgentId: input.toAgentId,
          body,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        if (input.fromChatId) message.fromChatId = input.fromChatId;
        agentMessages.set(message.id, message);
        return clone(message);
      },
      async update(id: string, patch: AgentMessagePatch) {
        const current = agentMessages.get(id);
        if (!current) return null;
        if (patch.status !== undefined) assertAgentMessageStatus(patch.status);
        const now = timestamp();
        const next: AgentMessage = {
          ...current,
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedAt: now,
        };
        if (patch.status === "delivered") next.deliveredAt = now;
        if (patch.status === "read") next.readAt = now;
        agentMessages.set(id, next);
        return clone(next);
      },
    },
    memories: {
      async list(query) {
        const rows = await platform.memories.list(query);
        return rows.filter((row) => memoryOwners.get(row.id) === acting());
      },
      async listVisible(agentId, opts) {
        if (agentOwners.get(agentId) !== acting()) return [];
        const rows = await platform.memories.listVisible(agentId, opts);
        return rows.filter((row) => memoryOwners.get(row.id) === acting());
      },
      async get(id) {
        if (memoryOwners.get(id) !== acting()) return null;
        return platform.memories.get(id);
      },
      async create(input) {
        if (input.agentId && agentOwners.get(input.agentId) !== acting()) throw new Error("agent not found");
        const row = await platform.memories.create(input);
        memoryOwners.set(row.id, acting());
        return row;
      },
      async update(id, patch) {
        if (memoryOwners.get(id) !== acting()) return null;
        return platform.memories.update(id, patch);
      },
      async delete(id) {
        if (memoryOwners.get(id) !== acting()) return false;
        memoryOwners.delete(id);
        return platform.memories.delete(id);
      },
      async deleteVisible(id, agentId) {
        if (memoryOwners.get(id) !== acting()) return "missing";
        const result = await platform.memories.deleteVisible(id, agentId);
        if (result === "deleted") memoryOwners.delete(id);
        return result;
      },
    },
    roles: platform.roles,
    routines: alwaysOn.routines,
    routineRuns: alwaysOn.routineRuns,
    listeners: alwaysOn.listeners,
    listenerDeliveries: alwaysOn.listenerDeliveries,
    notifications: alwaysOn.notifications,
    alwaysOnSettings: alwaysOn.alwaysOnSettings,
  };
  return store;
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
  if (profile.description !== undefined) stored.description = profile.description;
  if (profile.baseUrl !== undefined) stored.baseUrl = profile.baseUrl;
  if (profile.maxTokens !== undefined) stored.maxTokens = profile.maxTokens;
  if (profile.temperature !== undefined) stored.temperature = profile.temperature;
  if (profile.kind) stored.kind = profile.kind;
  if (profile.cli) stored.cli = profile.cli;
  if (profile.bin) stored.bin = profile.bin;
  if (profile.timeoutMs !== undefined) stored.timeoutMs = profile.timeoutMs;
  if (profile.passModel !== undefined) stored.passModel = profile.passModel;
  if (profile.botanicalTools !== undefined) stored.botanicalTools = profile.botanicalTools;
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
  if (!isAgentIcon(icon)) {
    throw new Error('icon must be a Lucide icon name such as "Bot"');
  }
  return icon;
}

function normalizeColor(color: AgentColor | undefined): AgentColor {
  if (color === undefined) return DEFAULT_AGENT_COLOR;
  if (!isAgentColor(color)) {
    throw new Error("color must be one of red, orange, amber, green, teal, cyan, blue, violet, pink, gray");
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
