import { and, asc, desc, eq, or, sql } from 'drizzle-orm';

import { createDb, ensureDatabase, type BotanicalDb } from './client.ts';
import { migrateDatabase } from './migrate.ts';
import { agentMessages } from './schema/agent-messages.ts';
import { agents } from './schema/agents.ts';
import { chats } from './schema/chats.ts';
import { messages } from './schema/messages.ts';
import { modelProfiles } from './schema/model-profiles.ts';
import { sessions } from './schema/sessions.ts';
import { users } from './schema/users.ts';
import type { AgentToolBinding, ModelProfileConfig, StoredToolCall } from './types.ts';

const AGENT_COLORS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'pink',
  'gray',
] as const;
type AgentColor = (typeof AGENT_COLORS)[number];

const AGENT_MESSAGE_STATUSES = ['pending', 'delivered', 'read', 'failed'] as const;
type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

const ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN_CONFIG_KEYS = ['apiKey', 'api_key', 'secret', 'token', 'password'] as const;

type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface Agent {
  id: string;
  name: string;
  icon: string;
  color: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  defaultProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAgent {
  name: string;
  icon?: string;
  color?: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  defaultProfileId?: string | null;
}

export interface AgentPatch {
  name?: string;
  icon?: string;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
  defaultProfileId?: string | null;
}

export interface Chat {
  id: string;
  agentId: string;
  profileId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewChat {
  agentId: string;
  profileId: string;
  title: string;
}

export interface ChatPatch {
  title?: string;
  profileId?: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  profileId?: string | null;
}

export interface NewMessage {
  chatId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  profileId?: string | null;
}

export interface Session {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  status: AgentMessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewAgentMessage {
  fromAgentId: string;
  toAgentId: string;
  body: string;
}

export interface AgentMessagePatch {
  status?: AgentMessageStatus;
}

export interface AgentMessageQuery {
  agentId?: string;
  status?: AgentMessageStatus;
}

/**
 * Persistence contract consumed by `@botanical/server`.
 * `kind` is always `"postgres"`. Profile objects never include API keys.
 */
export interface Store {
  readonly kind: 'postgres';
  readonly agents: {
    list(): Promise<Agent[]>;
    get(id: string): Promise<Agent | null>;
    create(input: NewAgent): Promise<Agent>;
    update(id: string, patch: AgentPatch): Promise<Agent | null>;
    delete(id: string): Promise<boolean>;
  };
  readonly chats: {
    list(): Promise<Chat[]>;
    get(id: string): Promise<Chat | null>;
    create(input: NewChat): Promise<Chat>;
    update(id: string, patch: ChatPatch): Promise<Chat | null>;
    delete(id: string): Promise<boolean>;
    countByAgent(agentId: string): Promise<number>;
  };
  readonly messages: {
    listByChat(chatId: string): Promise<Message[]>;
    create(input: NewMessage): Promise<Message>;
    deleteByChat(chatId: string): Promise<number>;
  };
  readonly sessions: {
    create(session: Session): Promise<Session>;
    getByTokenHash(tokenHash: string): Promise<Session | null>;
    delete(id: string): Promise<boolean>;
  };
  readonly profiles: {
    list(): Promise<ModelProfile[]>;
    get(id: string): Promise<ModelProfile | null>;
    upsert(profile: ModelProfile): Promise<ModelProfile>;
    delete(id: string): Promise<boolean>;
  };
  readonly agentMessages: {
    list(query?: AgentMessageQuery): Promise<AgentMessage[]>;
    get(id: string): Promise<AgentMessage | null>;
    create(input: NewAgentMessage): Promise<AgentMessage>;
    update(id: string, patch: AgentMessagePatch): Promise<AgentMessage | null>;
  };
  close(): Promise<void>;
}

/**
 * Migrate, bootstrap the single operator, and return a Store.
 * Called by the HTTP server when DATABASE_URL is set.
 */
export async function createStore(options: { connectionString: string }): Promise<Store> {
  const connectionString = options.connectionString?.trim();
  if (!connectionString) throw new Error('connectionString is required');
  await ensureDatabase(connectionString);
  await migrateDatabase(connectionString);
  const handle = createDb({ databaseUrl: connectionString });
  try {
    const userId = await ensureOperator(handle.db);
    return buildStore(handle.db, userId, () => handle.close());
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function ensureOperator(db: BotanicalDb): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(214011)`);
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(1);
    if (existing[0]) return existing[0].id;
    const inserted = await tx.insert(users).values({ displayName: 'Owner' }).returning({ id: users.id });
    const row = inserted[0];
    if (!row) throw new Error('Failed to create the operator user');
    return row.id;
  });
}

function buildStore(db: BotanicalDb, userId: string, closePool: () => Promise<void>): Store {
  let closed = false;

  async function requireProfileUuid(publicId: string): Promise<string> {
    const id = publicId.trim();
    if (!PROFILE_ID_PATTERN.test(id)) {
      throw new Error(`Unknown model profile ${JSON.stringify(publicId)}`);
    }
    const rows = await db
      .select({ id: modelProfiles.id })
      .from(modelProfiles)
      .where(and(eq(modelProfiles.userId, userId), eq(modelProfiles.publicId, id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Unknown model profile ${JSON.stringify(id)}. Upsert it before use.`);
    return row.id;
  }

  async function requireOwnedChat(chatId: string): Promise<boolean> {
    if (!isUuid(chatId)) return false;
    const rows = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
      .limit(1);
    return Boolean(rows[0]);
  }

  return {
    kind: 'postgres',
    async close() {
      if (closed) return;
      closed = true;
      await closePool();
    },
    agents: {
      async list() {
        const rows = await db
          .select()
          .from(agents)
          .where(eq(agents.userId, userId))
          .orderBy(asc(agents.createdAt), asc(agents.id));
        return rows.map(toAgent);
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, id), eq(agents.userId, userId)))
          .limit(1);
        return rows[0] ? toAgent(rows[0]) : null;
      },
      async create(input) {
        const inserted = await db
          .insert(agents)
          .values({
            userId,
            name: requireName(input.name),
            icon: normalizeIcon(input.icon),
            color: normalizeColor(input.color),
            description: input.description,
            prompt: input.systemPrompt,
            tools: toolIdsToBindings(input.toolIds),
            defaultProfileId: normalizeProfileId(input.defaultProfileId),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('agent insert failed');
        return toAgent(row);
      },
      async update(id, patch) {
        if (!isUuid(id)) return null;
        const values: {
          name?: string;
          icon?: string;
          color?: string;
          description?: string;
          prompt?: string;
          tools?: AgentToolBinding[];
          defaultProfileId?: string | null;
          updatedAt?: Date;
        } = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = requireName(patch.name);
        if (patch.icon !== undefined) values.icon = normalizeIcon(patch.icon);
        if (patch.color !== undefined) values.color = normalizeColor(patch.color);
        if (patch.description !== undefined) values.description = patch.description;
        if (patch.systemPrompt !== undefined) values.prompt = patch.systemPrompt;
        if (patch.toolIds !== undefined) values.tools = toolIdsToBindings(patch.toolIds);
        if (patch.defaultProfileId !== undefined) {
          values.defaultProfileId = normalizeProfileId(patch.defaultProfileId);
        }
        const updated = await db
          .update(agents)
          .set(values)
          .where(and(eq(agents.id, id), eq(agents.userId, userId)))
          .returning();
        return updated[0] ? toAgent(updated[0]) : null;
      },
      async delete(id) {
        if (!isUuid(id)) return false;
        const existing = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, id), eq(agents.userId, userId)))
          .limit(1);
        if (!existing[0]) return false;
        const owned = await db
          .select({ id: chats.id })
          .from(chats)
          .where(eq(chats.agentId, id))
          .limit(1);
        if (owned[0]) throw new Error('agent still owns chats');
        await db.delete(agents).where(and(eq(agents.id, id), eq(agents.userId, userId)));
        return true;
      },
    },
    chats: {
      async list() {
        const rows = await db
          .select({ chat: chats, profilePublicId: modelProfiles.publicId })
          .from(chats)
          .innerJoin(modelProfiles, eq(chats.profileId, modelProfiles.id))
          .where(eq(chats.userId, userId))
          .orderBy(desc(chats.updatedAt), desc(chats.id));
        return rows.map((row) => toChat(row.chat, row.profilePublicId));
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ chat: chats, profilePublicId: modelProfiles.publicId })
          .from(chats)
          .innerJoin(modelProfiles, eq(chats.profileId, modelProfiles.id))
          .where(and(eq(chats.id, id), eq(chats.userId, userId)))
          .limit(1);
        const row = rows[0];
        return row ? toChat(row.chat, row.profilePublicId) : null;
      },
      async create(input) {
        if (!isUuid(input.agentId)) throw new Error('agent not found');
        const agent = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, input.agentId), eq(agents.userId, userId)))
          .limit(1);
        if (!agent[0]) throw new Error('agent not found');
        const profileUuid = await requireProfileUuid(input.profileId);
        const inserted = await db
          .insert(chats)
          .values({
            userId,
            agentId: input.agentId,
            profileId: profileUuid,
            title: input.title,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('chat insert failed');
        return toChat(row, input.profileId.trim());
      },
      async update(id, patch) {
        if (!isUuid(id)) return null;
        const values: { title?: string; profileId?: string; updatedAt: Date } = { updatedAt: new Date() };
        if (patch.title !== undefined) values.title = patch.title;
        if (patch.profileId !== undefined) values.profileId = await requireProfileUuid(patch.profileId);
        const updated = await db
          .update(chats)
          .set(values)
          .where(and(eq(chats.id, id), eq(chats.userId, userId)))
          .returning();
        const row = updated[0];
        if (!row) return null;
        if (patch.profileId !== undefined) return toChat(row, patch.profileId.trim());
        const profile = await db
          .select({ publicId: modelProfiles.publicId })
          .from(modelProfiles)
          .where(eq(modelProfiles.id, row.profileId))
          .limit(1);
        return toChat(row, profile[0]?.publicId ?? row.profileId);
      },
      async delete(id) {
        if (!isUuid(id)) return false;
        return db.transaction(async (tx) => {
          const existing = await tx
            .select({ id: chats.id })
            .from(chats)
            .where(and(eq(chats.id, id), eq(chats.userId, userId)))
            .limit(1);
          if (!existing[0]) return false;
          await tx.delete(messages).where(eq(messages.chatId, id));
          const removed = await tx
            .delete(chats)
            .where(and(eq(chats.id, id), eq(chats.userId, userId)))
            .returning({ id: chats.id });
          return removed.length > 0;
        });
      },
      async countByAgent(agentId) {
        if (!isUuid(agentId)) return 0;
        const rows = await db
          .select({ id: chats.id })
          .from(chats)
          .where(and(eq(chats.agentId, agentId), eq(chats.userId, userId)));
        return rows.length;
      },
    },
    messages: {
      async listByChat(chatId) {
        if (!(await requireOwnedChat(chatId))) return [];
        const rows = await db
          .select({ message: messages, profilePublicId: modelProfiles.publicId })
          .from(messages)
          .leftJoin(modelProfiles, eq(messages.profileId, modelProfiles.id))
          .where(eq(messages.chatId, chatId))
          .orderBy(asc(messages.seq));
        return rows.map((row) => toMessage(row.message, row.profilePublicId));
      },
      async create(input) {
        if (!(await requireOwnedChat(input.chatId))) throw new Error('chat not found');
        if (input.role === 'tool' && !input.toolCallId?.trim()) {
          throw new Error('tool messages require toolCallId');
        }
        const profileUuid = input.profileId ? await requireProfileUuid(input.profileId) : null;
        const toolCalls = input.toolCalls && input.toolCalls.length > 0 ? input.toolCalls.map(copyToolCall) : null;
        const inserted = await db
          .insert(messages)
          .values({
            chatId: input.chatId,
            role: input.role,
            content: input.content,
            toolCalls,
            toolCallId: input.toolCallId?.trim() || null,
            name: input.name?.trim() || null,
            profileId: profileUuid,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('message insert failed');
        return toMessage(row, input.profileId?.trim() || null);
      },
      async deleteByChat(chatId) {
        if (!(await requireOwnedChat(chatId))) return 0;
        const removed = await db.delete(messages).where(eq(messages.chatId, chatId)).returning({ id: messages.id });
        return removed.length;
      },
    },
    sessions: {
      async create(session) {
        if (!isUuid(session.id)) throw new Error('session id must be a uuid');
        const inserted = await db
          .insert(sessions)
          .values({
            id: session.id,
            tokenHash: session.tokenHash,
            createdAt: asDate(session.createdAt, 'createdAt'),
            expiresAt: asDate(session.expiresAt, 'expiresAt'),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('session insert failed');
        return toSession(row);
      },
      async getByTokenHash(tokenHash) {
        const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
        return rows[0] ? toSession(rows[0]) : null;
      },
      async delete(id) {
        if (!isUuid(id)) return false;
        const removed = await db.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id });
        return removed.length > 0;
      },
    },
    profiles: {
      async list() {
        const rows = await db
          .select()
          .from(modelProfiles)
          .where(eq(modelProfiles.userId, userId))
          .orderBy(asc(modelProfiles.publicId));
        return rows.map(toProfile);
      },
      async get(id) {
        const rows = await db
          .select()
          .from(modelProfiles)
          .where(and(eq(modelProfiles.userId, userId), eq(modelProfiles.publicId, id)))
          .limit(1);
        return rows[0] ? toProfile(rows[0]) : null;
      },
      async upsert(profile) {
        const stored = sanitizeProfile(profile);
        const existing = await db
          .select()
          .from(modelProfiles)
          .where(and(eq(modelProfiles.userId, userId), eq(modelProfiles.publicId, stored.id)))
          .limit(1);
        const config = nextConfig(existing[0]?.config, stored.baseUrl);
        if (existing[0]) {
          const updated = await db
            .update(modelProfiles)
            .set({
              name: stored.name,
              provider: stored.provider,
              model: stored.model,
              config,
            })
            .where(eq(modelProfiles.id, existing[0].id))
            .returning();
          const row = updated[0];
          if (!row) throw new Error('profile update failed');
          return toProfile(row);
        }
        try {
          const inserted = await db
            .insert(modelProfiles)
            .values({
              userId,
              publicId: stored.id,
              name: stored.name,
              provider: stored.provider,
              model: stored.model,
              config,
            })
            .returning();
          const row = inserted[0];
          if (!row) throw new Error('profile insert failed');
          return toProfile(row);
        } catch (error) {
          if (pgCode(error) === '23505') {
            throw new Error(`A model profile named ${JSON.stringify(stored.name)} already exists`);
          }
          throw error;
        }
      },
      async delete(id) {
        const existing = await db
          .select({ id: modelProfiles.id })
          .from(modelProfiles)
          .where(and(eq(modelProfiles.userId, userId), eq(modelProfiles.publicId, id)))
          .limit(1);
        const row = existing[0];
        if (!row) return false;
        const used = await db.select({ id: chats.id }).from(chats).where(eq(chats.profileId, row.id)).limit(1);
        if (used[0]) throw new Error('profile is still used by a chat');
        await db.delete(modelProfiles).where(eq(modelProfiles.id, row.id));
        return true;
      },
    },
    agentMessages: {
      async list(query) {
        if (query?.status !== undefined) assertStatus(query.status);
        if (query?.agentId !== undefined && !isUuid(query.agentId)) return [];
        const endpoint =
          query?.agentId === undefined
            ? undefined
            : or(eq(agentMessages.fromAgent, query.agentId), eq(agentMessages.toAgent, query.agentId));
        const rows = await db
          .select({ message: agentMessages })
          .from(agentMessages)
          .innerJoin(agents, eq(agentMessages.fromAgent, agents.id))
          .where(
            and(
              eq(agents.userId, userId),
              endpoint,
              query?.status ? eq(agentMessages.status, query.status) : undefined,
            ),
          )
          .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
        return rows.map((row) => toAgentMessage(row.message));
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ message: agentMessages })
          .from(agentMessages)
          .innerJoin(agents, eq(agentMessages.fromAgent, agents.id))
          .where(and(eq(agentMessages.id, id), eq(agents.userId, userId)))
          .limit(1);
        return rows[0] ? toAgentMessage(rows[0].message) : null;
      },
      async create(input) {
        const body = input.body.trim();
        if (!body) throw new Error('agent message body is required');
        if (input.fromAgentId === input.toAgentId) {
          throw new Error('agent message endpoints must be different agents');
        }
        if (!isUuid(input.fromAgentId) || !isUuid(input.toAgentId)) {
          throw new Error('agent message endpoints must reference existing agents');
        }
        const owned = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.userId, userId), or(eq(agents.id, input.fromAgentId), eq(agents.id, input.toAgentId))));
        if (owned.length !== 2) {
          throw new Error('agent message endpoints must reference existing agents');
        }
        const inserted = await db
          .insert(agentMessages)
          .values({
            fromAgent: input.fromAgentId,
            toAgent: input.toAgentId,
            body,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('agent message insert failed');
        return toAgentMessage(row);
      },
      async update(id, patch) {
        if (!isUuid(id)) return null;
        if (patch.status !== undefined) assertStatus(patch.status);
        const current = await db
          .select({ id: agentMessages.id })
          .from(agentMessages)
          .innerJoin(agents, eq(agentMessages.fromAgent, agents.id))
          .where(and(eq(agentMessages.id, id), eq(agents.userId, userId)))
          .limit(1);
        if (!current[0]) return null;
        const updated = await db
          .update(agentMessages)
          .set(patch.status !== undefined ? { status: patch.status } : { updatedAt: new Date() })
          .where(eq(agentMessages.id, id))
          .returning();
        return updated[0] ? toAgentMessage(updated[0]) : null;
      },
    },
  };
}

type AgentRow = typeof agents.$inferSelect;
type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type ProfileRow = typeof modelProfiles.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type AgentMessageRow = typeof agentMessages.$inferSelect;

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: asColor(row.color),
    description: row.description,
    systemPrompt: row.prompt,
    toolIds: bindingsToToolIds(row.tools),
    defaultProfileId: row.defaultProfileId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toChat(row: ChatRow, profilePublicId: string): Chat {
  return {
    id: row.id,
    agentId: row.agentId,
    profileId: profilePublicId,
    title: row.title,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toMessage(row: MessageRow, profilePublicId: string | null): Message {
  const message: Message = {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    createdAt: iso(row.createdAt),
  };
  if (row.toolCalls && row.toolCalls.length > 0) {
    message.toolCalls = row.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
  }
  if (row.toolCallId) message.toolCallId = row.toolCallId;
  if (row.name) message.name = row.name;
  if (profilePublicId) message.profileId = profilePublicId;
  return message;
}

function toProfile(row: ProfileRow): ModelProfile {
  const profile: ModelProfile = {
    id: row.publicId,
    name: row.name,
    provider: row.provider,
    model: row.model,
  };
  if (typeof row.config?.baseUrl === 'string' && row.config.baseUrl.length > 0) {
    profile.baseUrl = row.config.baseUrl;
  }
  return profile;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    createdAt: iso(row.createdAt),
    expiresAt: iso(row.expiresAt),
  };
}

function toAgentMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    fromAgentId: row.fromAgent,
    toAgentId: row.toAgent,
    body: row.body,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toolIdsToBindings(toolIds: readonly string[]): AgentToolBinding[] {
  return toolIds.map((name) => ({ name, enabled: true }));
}

function bindingsToToolIds(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const ids: string[] = [];
  for (const item of tools) {
    if (typeof item === 'string' && item.length > 0) {
      ids.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as { name?: unknown; enabled?: unknown };
    if (typeof record.name !== 'string' || record.name.length === 0) continue;
    if (record.enabled === false) continue;
    ids.push(record.name);
  }
  return ids;
}

function copyToolCall(call: ToolCall): StoredToolCall {
  if (!call.id.trim() || !call.name.trim()) throw new Error('tool call id and name are required');
  let args: unknown = call.arguments === undefined ? {} : call.arguments;
  try {
    const encoded = JSON.stringify(args);
    if (encoded === undefined) throw new Error('tool call arguments must be JSON');
    args = JSON.parse(encoded) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === 'tool call arguments must be JSON') throw error;
    throw new Error('tool call arguments must be JSON');
  }
  return { id: call.id, name: call.name, arguments: args };
}

function sanitizeProfile(profile: ModelProfile): ModelProfile {
  const id = profile.id?.trim?.() ?? '';
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new Error("profile id must be 1-64 characters of letters, numbers, '_' or '-'");
  }
  const name = profile.name?.trim?.() ?? '';
  const provider = profile.provider?.trim?.() ?? '';
  const model = profile.model?.trim?.() ?? '';
  if (!name || !provider || !model) throw new Error('profile name, provider, and model are required');
  const stored: ModelProfile = { id, name, provider, model };
  if (profile.baseUrl !== undefined) {
    const baseUrl = profile.baseUrl.trim();
    if (baseUrl) stored.baseUrl = baseUrl;
  }
  return stored;
}

function nextConfig(previous: ModelProfileConfig | undefined, baseUrl: string | undefined): ModelProfileConfig {
  const record: Record<string, unknown> = { ...(previous ?? {}) };
  for (const key of FORBIDDEN_CONFIG_KEYS) delete record[key];
  if (baseUrl) record.baseUrl = baseUrl;
  else delete record.baseUrl;
  return record as ModelProfileConfig;
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) throw new Error('name must be 1-40 characters');
  return trimmed;
}

function normalizeIcon(icon: string | undefined): string {
  if (icon === undefined) return 'Bot';
  if (!ICON_PATTERN.test(icon)) throw new Error('icon must be a Lucide icon name such as "Bot"');
  return icon;
}

function normalizeColor(color: AgentColor | undefined): AgentColor {
  if (color === undefined) return 'green';
  return asColor(color);
}

function asColor(value: string): AgentColor {
  if (!(AGENT_COLORS as readonly string[]).includes(value)) {
    throw new Error(`color must be one of ${AGENT_COLORS.join(', ')}`);
  }
  return value as AgentColor;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!PROFILE_ID_PATTERN.test(trimmed)) throw new Error('defaultProfileId must be a profile id');
  return trimmed;
}

function assertStatus(status: AgentMessageStatus): void {
  if (!(AGENT_MESSAGE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`status must be one of ${AGENT_MESSAGE_STATUSES.join(', ')}`);
  }
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function asDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid timestamp`);
  return date;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp from postgres');
  return date.toISOString();
}

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return pgCode(error.cause);
  return undefined;
}
