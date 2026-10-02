import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { AccountRepository, PrefsRepository, SecretRepository } from './account-types.ts';
import { createAccountServices } from './accounts.ts';
import { currentUserId, pinStore } from './actor.ts';
import {
  ALWAYS_ON_SETTING_KEYS,
  alwaysOnToRaw,
  createAlwaysOnSettingsAccessor,
  type AlwaysOnSettingsRepository,
} from './always-on-settings.ts';
import { createDb, ensureDatabase, type BotanicalDb } from './client.ts';
import { migrateDatabase } from './migrate.ts';
import { createAlwaysOn, type AlwaysOn } from './always-on.ts';
import {
  createMvp2,
  type AgentRoleSummary,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryScope,
  type RolePermissions,
  type RoleRecord,
} from './mvp2.ts';
import { agentMessages } from './schema/agent-messages.ts';
import { agents } from './schema/agents.ts';
import { chats } from './schema/chats.ts';
import { messages } from './schema/messages.ts';
import { modelProfiles } from './schema/model-profiles.ts';
import { sessions } from './schema/sessions.ts';
import { settings } from './schema/settings.ts';
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

const AGENT_SHAPES = ['circle', 'squircle', 'square', 'hexagon', 'diamond', 'shield'] as const;
type AgentShape = (typeof AGENT_SHAPES)[number];

const PICTURE_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PICTURE_MAX = 200_000;
const TITLE_MAX = 60;

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
  description?: string | null;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  kind?: string;
  cli?: string;
  bin?: string;
  timeoutMs?: number;
  passModel?: boolean;
  botanicalTools?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  icon: string;
  shape: AgentShape;
  picture: string | null;
  color: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  defaultProfileId: string | null;
  createdByAgentId: string | null;
  roleIds: string[];
  roles: AgentRoleSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface NewAgent {
  name: string;
  title?: string;
  icon?: string;
  shape?: AgentShape;
  picture?: string | null;
  color?: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  defaultProfileId?: string | null;
  createdByAgentId?: string | null;
  roleIds?: string[];
}

export interface AgentPatch {
  name?: string;
  title?: string;
  icon?: string;
  shape?: AgentShape;
  picture?: string | null;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
  defaultProfileId?: string | null;
  roleIds?: string[];
}

export interface Chat {
  id: string;
  agentId: string;
  memberIds: string[];
  profileId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewChat {
  agentId: string;
  memberIds?: string[];
  profileId: string;
  title: string;
}

export interface ChatPatch {
  title?: string;
  profileId?: string;
  memberIds?: string[];
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
  agentId?: string | null;
}

export interface MessageSearchQuery {
  q: string;
  chatIds: readonly string[];
  role?: 'user' | 'assistant';
  from?: string;
  to?: string;
  limit: number;
}

export interface NewMessage {
  chatId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  profileId?: string | null;
  agentId?: string | null;
}

export interface Session {
  id: string;
  userId: string;
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
    /** User and assistant text rows matching `q` in the given chats (full-text or substring), newest first. */
    search(query: MessageSearchQuery): Promise<Message[]>;
    create(input: NewMessage): Promise<Message>;
    /** Replace a message's text. Null when the message is not in this chat. */
    updateContent(chatId: string, id: string, content: string): Promise<Message | null>;
    /** Delete the given messages of one chat. Returns how many were removed. */
    deleteMany(chatId: string, ids: readonly string[]): Promise<number>;
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
  readonly memories: {
    list(query?: MemoryQuery): Promise<MemoryRecord[]>;
    listVisible(agentId: string, opts?: { limit?: number }): Promise<MemoryRecord[]>;
    get(id: string): Promise<MemoryRecord | null>;
    create(input: {
      scope: MemoryScope;
      agentId?: string | null;
      content: string;
      tags?: string[];
    }): Promise<MemoryRecord>;
    update(id: string, patch: { content?: string; tags?: string[] }): Promise<MemoryRecord | null>;
    delete(id: string): Promise<boolean>;
    deleteVisible(id: string, agentId: string): Promise<'deleted' | 'missing' | 'forbidden'>;
  };
  readonly routines: AlwaysOn['routines'];
  readonly routineRuns: AlwaysOn['routineRuns'];
  readonly listeners: AlwaysOn['listeners'];
  readonly listenerDeliveries: AlwaysOn['listenerDeliveries'];
  readonly notifications: AlwaysOn['notifications'];
  /** Instance-admin tuning for background work. Not per-user. */
  readonly alwaysOnSettings: AlwaysOnSettingsRepository;
  readonly accounts: AccountRepository;
  readonly secrets: SecretRepository;
  readonly prefs: PrefsRepository;
  readonly globalProfiles: {
    list(): Promise<ModelProfile[]>;
    get(id: string): Promise<ModelProfile | null>;
    upsert(profile: ModelProfile): Promise<ModelProfile>;
    delete(id: string): Promise<boolean>;
  };
  /** Acting user, or null on the shared store outside a request. */
  readonly scopeUserId: string | null;
  forUser(userId: string): Store;
  readonly roles: {
    list(): Promise<RoleRecord[]>;
    get(id: string): Promise<RoleRecord | null>;
    getByName(name: string): Promise<RoleRecord | null>;
    create(input: { name: string; description?: string; permissions: RolePermissions }): Promise<RoleRecord>;
    update(
      id: string,
      patch: { name?: string; description?: string; permissions?: RolePermissions },
    ): Promise<RoleRecord | null>;
    delete(id: string): Promise<boolean>;
    listForAgent(agentId: string): Promise<RoleRecord[]>;
    setForAgent(agentId: string, roleIds: readonly string[]): Promise<RoleRecord[]>;
  };
  close(): Promise<void>;
}

/**
 * Migrate, bootstrap the single operator, and return a Store.
 * Called by the HTTP server when DATABASE_URL is set.
 */
export async function createStore(options: { connectionString: string; encryptionKey?: string }): Promise<Store> {
  const connectionString = options.connectionString?.trim();
  if (!connectionString) throw new Error('connectionString is required');
  await ensureDatabase(connectionString);
  await migrateDatabase(connectionString);
  const handle = createDb({ databaseUrl: connectionString });
  try {
    const userId = await ensureOperator(handle.db);
    return buildStore(handle.db, userId, () => handle.close(), options.encryptionKey);
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

function buildStore(
  db: BotanicalDb,
  legacyUserId: string,
  closePool: () => Promise<void>,
  encryptionKey?: string,
): Store {
  let closed = false;
  function bound(): string {
    return currentUserId() ?? legacyUserId;
  }
  const mvp2 = createMvp2(db, bound);
  const alwaysOn = createAlwaysOn(db, legacyUserId);
  const services = createAccountServices(db, { encryptionKey, legacyUserId });
  const alwaysOnKeys = Object.values(ALWAYS_ON_SETTING_KEYS);
  const alwaysOnSettings = createAlwaysOnSettingsAccessor({
    async read() {
      const rows = await db.select().from(settings).where(inArray(settings.key, alwaysOnKeys));
      const raw: Record<string, unknown> = {};
      for (const row of rows) raw[row.key] = row.value;
      return raw;
    },
    async write(value) {
      const raw = alwaysOnToRaw(value);
      for (const [key, stored] of Object.entries(raw)) {
        await db
          .insert(settings)
          .values({ key, value: stored })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: stored, updatedAt: new Date() },
          });
      }
    },
  });

  async function hydrate(rows: AgentRow[]): Promise<Agent[]> {
    const grouped = await mvp2.loadRoles(rows.map((row) => row.id));
    return rows.map((row) => toAgent(row, grouped.get(row.id) ?? []));
  }

  async function requireProfileUuid(publicId: string): Promise<string> {
    const id = publicId.trim();
    if (!PROFILE_ID_PATTERN.test(id)) {
      throw new Error(`Unknown model profile ${JSON.stringify(publicId)}`);
    }
    const own = await db
      .select({ id: modelProfiles.id })
      .from(modelProfiles)
      .where(and(eq(modelProfiles.userId, bound()), eq(modelProfiles.publicId, id)))
      .limit(1);
    if (own[0]) return own[0].id;
    const global = await db
      .select({ id: modelProfiles.id })
      .from(modelProfiles)
      .where(and(isNull(modelProfiles.userId), eq(modelProfiles.publicId, id)))
      .limit(1);
    if (global[0]) return global[0].id;
    throw new Error(`Unknown model profile ${JSON.stringify(id)}. Upsert it before use.`);
  }

  /** The ids, each once, after checking every one is an agent of the bound user. */
  async function requireOwnedAgents(ids: readonly string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (!unique.every(isUuid)) throw new Error('agent not found');
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(inArray(agents.id, unique), eq(agents.userId, bound())));
    if (rows.length !== unique.length) throw new Error('agent not found');
    return unique;
  }

  async function requireOwnedChat(chatId: string): Promise<boolean> {
    if (!isUuid(chatId)) return false;
    const rows = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, bound())))
      .limit(1);
    return Boolean(rows[0]);
  }

  const store: Store = {
    kind: 'postgres',
    get scopeUserId() {
      return currentUserId();
    },
    forUser(userId: string) {
      return pinStore(store, userId);
    },
    accounts: services.accounts,
    secrets: services.secrets,
    prefs: services.prefs,
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
          .where(eq(agents.userId, bound()))
          .orderBy(asc(agents.createdAt), asc(agents.id));
        return hydrate(rows);
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select()
          .from(agents)
          .where(and(eq(agents.id, id), eq(agents.userId, bound())))
          .limit(1);
        const hydrated = await hydrate(rows);
        return hydrated[0] ?? null;
      },
      async create(input) {
        const inserted = await db
          .insert(agents)
          .values({
            userId: bound(),
            name: requireName(input.name),
            title: normalizeTitle(input.title),
            icon: normalizeIcon(input.icon),
            shape: normalizeShape(input.shape),
            picture: normalizePicture(input.picture),
            color: normalizeColor(input.color),
            description: input.description,
            prompt: input.systemPrompt,
            tools: toolIdsToBindings(input.toolIds),
            defaultProfileId: normalizeProfileId(input.defaultProfileId),
            createdByAgentId: input.createdByAgentId ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('agent insert failed');
        if (input.roleIds && input.roleIds.length > 0) {
          await mvp2.roles.setForAgent(row.id, input.roleIds);
        }
        const hydrated = await hydrate([row]);
        const agent = hydrated[0];
        if (!agent) throw new Error('agent insert failed');
        return agent;
      },
      async update(id, patch) {
        if (!isUuid(id)) return null;
        const values: {
          name?: string;
          title?: string;
          icon?: string;
          shape?: AgentShape;
          picture?: string | null;
          color?: AgentColor;
          description?: string;
          prompt?: string;
          tools?: AgentToolBinding[];
          defaultProfileId?: string | null;
          updatedAt?: Date;
        } = { updatedAt: new Date() };
        if (patch.name !== undefined) values.name = requireName(patch.name);
        if (patch.title !== undefined) values.title = normalizeTitle(patch.title);
        if (patch.icon !== undefined) values.icon = normalizeIcon(patch.icon);
        if (patch.shape !== undefined) values.shape = normalizeShape(patch.shape);
        if (patch.picture !== undefined) values.picture = normalizePicture(patch.picture);
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
          .where(and(eq(agents.id, id), eq(agents.userId, bound())))
          .returning();
        const row = updated[0];
        if (!row) return null;
        if (patch.roleIds !== undefined) await mvp2.roles.setForAgent(id, patch.roleIds);
        const hydrated = await hydrate([row]);
        return hydrated[0] ?? null;
      },
      async delete(id) {
        if (!isUuid(id)) return false;
        const existing = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, id), eq(agents.userId, bound())))
          .limit(1);
        if (!existing[0]) return false;
        const owned = await db
          .select({ id: chats.id })
          .from(chats)
          .where(or(eq(chats.agentId, id), sql`${id}::uuid = any(${chats.memberIds})`))
          .limit(1);
        if (owned[0]) throw new Error('agent still owns chats');
        await db.delete(agents).where(and(eq(agents.id, id), eq(agents.userId, bound())));
        return true;
      },
    },
    chats: {
      async list() {
        const rows = await db
          .select({ chat: chats, profilePublicId: modelProfiles.publicId })
          .from(chats)
          .innerJoin(modelProfiles, eq(chats.profileId, modelProfiles.id))
          .where(eq(chats.userId, bound()))
          .orderBy(desc(chats.updatedAt), desc(chats.id));
        return rows.map((row) => toChat(row.chat, row.profilePublicId));
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const rows = await db
          .select({ chat: chats, profilePublicId: modelProfiles.publicId })
          .from(chats)
          .innerJoin(modelProfiles, eq(chats.profileId, modelProfiles.id))
          .where(and(eq(chats.id, id), eq(chats.userId, bound())))
          .limit(1);
        const row = rows[0];
        return row ? toChat(row.chat, row.profilePublicId) : null;
      },
      async create(input) {
        if (!isUuid(input.agentId)) throw new Error('agent not found');
        const agent = await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, input.agentId), eq(agents.userId, bound())))
          .limit(1);
        if (!agent[0]) throw new Error('agent not found');
        const memberIds = await requireOwnedAgents(input.memberIds ?? []);
        const profileUuid = await requireProfileUuid(input.profileId);
        const inserted = await db
          .insert(chats)
          .values({
            userId: bound(),
            agentId: input.agentId,
            memberIds,
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
        const values: { title?: string; profileId?: string; memberIds?: string[]; updatedAt: Date } = {
          updatedAt: new Date(),
        };
        if (patch.title !== undefined) values.title = patch.title;
        if (patch.memberIds !== undefined) values.memberIds = await requireOwnedAgents(patch.memberIds);
        if (patch.profileId !== undefined) values.profileId = await requireProfileUuid(patch.profileId);
        const updated = await db
          .update(chats)
          .set(values)
          .where(and(eq(chats.id, id), eq(chats.userId, bound())))
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
            .where(and(eq(chats.id, id), eq(chats.userId, bound())))
            .limit(1);
          if (!existing[0]) return false;
          await tx.delete(messages).where(eq(messages.chatId, id));
          const removed = await tx
            .delete(chats)
            .where(and(eq(chats.id, id), eq(chats.userId, bound())))
            .returning({ id: chats.id });
          return removed.length > 0;
        });
      },
      async countByAgent(agentId) {
        if (!isUuid(agentId)) return 0;
        const rows = await db
          .select({ id: chats.id })
          .from(chats)
          .where(
            and(
              or(eq(chats.agentId, agentId), sql`${agentId}::uuid = any(${chats.memberIds})`),
              eq(chats.userId, bound()),
            ),
          );
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
      async search(query) {
        const ids = query.chatIds.filter(isUuid);
        if (ids.length === 0) return [];
        // Chat ownership is checked in one query, so ids the caller does not own match nothing.
        const owned = await db
          .select({ id: chats.id })
          .from(chats)
          .where(and(inArray(chats.id, ids), eq(chats.userId, bound())));
        if (owned.length === 0) return [];
        const escaped = query.q.replace(/[\\%_]/g, '\\$&');
        const match = or(
          sql`to_tsvector('simple', ${messages.content}) @@ websearch_to_tsquery('simple', ${query.q})`,
          ilike(messages.content, `%${escaped}%`),
        );
        const rows = await db
          .select({ message: messages, profilePublicId: modelProfiles.publicId })
          .from(messages)
          .leftJoin(modelProfiles, eq(messages.profileId, modelProfiles.id))
          .where(
            and(
              inArray(
                messages.chatId,
                owned.map((row) => row.id),
              ),
              query.role ? eq(messages.role, query.role) : inArray(messages.role, ['user', 'assistant']),
              query.from ? gte(messages.createdAt, new Date(query.from)) : undefined,
              query.to ? lte(messages.createdAt, new Date(query.to)) : undefined,
              match,
            ),
          )
          .orderBy(desc(messages.seq))
          .limit(query.limit);
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
            agentId: input.agentId && isUuid(input.agentId) ? input.agentId : null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new Error('message insert failed');
        return toMessage(row, input.profileId?.trim() || null);
      },
      async updateContent(chatId, id, content) {
        if (!isUuid(id) || !(await requireOwnedChat(chatId))) return null;
        const updated = await db
          .update(messages)
          .set({ content, updatedAt: new Date() })
          .where(and(eq(messages.chatId, chatId), eq(messages.id, id)))
          .returning();
        const row = updated[0];
        if (!row) return null;
        const profile = row.profileId
          ? await db
              .select({ publicId: modelProfiles.publicId })
              .from(modelProfiles)
              .where(eq(modelProfiles.id, row.profileId))
          : [];
        return toMessage(row, profile[0]?.publicId ?? null);
      },
      async deleteMany(chatId, ids) {
        const valid = ids.filter(isUuid);
        if (valid.length === 0 || !(await requireOwnedChat(chatId))) return 0;
        const removed = await db
          .delete(messages)
          .where(and(eq(messages.chatId, chatId), inArray(messages.id, valid)))
          .returning({ id: messages.id });
        return removed.length;
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
        if (!isUuid(session.userId)) throw new Error('session user id must be a uuid');
        const inserted = await db
          .insert(sessions)
          .values({
            id: session.id,
            userId: session.userId,
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
        const globals = await db.select().from(modelProfiles).where(isNull(modelProfiles.userId));
        const own = await db.select().from(modelProfiles).where(eq(modelProfiles.userId, bound()));
        const byId = new Map<string, ProfileRow>();
        for (const row of globals) byId.set(row.publicId, row);
        for (const row of own) byId.set(row.publicId, row);
        return [...byId.values()].map(toProfile);
      },
      async get(id) {
        const own = await db
          .select()
          .from(modelProfiles)
          .where(and(eq(modelProfiles.userId, bound()), eq(modelProfiles.publicId, id)))
          .limit(1);
        if (own[0]) return toProfile(own[0]);
        const global = await db
          .select()
          .from(modelProfiles)
          .where(and(isNull(modelProfiles.userId), eq(modelProfiles.publicId, id)))
          .limit(1);
        return global[0] ? toProfile(global[0]) : null;
      },
      async upsert(profile) {
        const stored = sanitizeProfile(profile);
        const existing = await db
          .select()
          .from(modelProfiles)
          .where(and(eq(modelProfiles.userId, bound()), eq(modelProfiles.publicId, stored.id)))
          .limit(1);
        const config = nextConfig(existing[0]?.config, stored);
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
              userId: bound(),
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
          .where(and(eq(modelProfiles.userId, bound()), eq(modelProfiles.publicId, id)))
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
              eq(agents.userId, bound()),
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
          .where(and(eq(agentMessages.id, id), eq(agents.userId, bound())))
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
          .where(and(eq(agents.userId, bound()), or(eq(agents.id, input.fromAgentId), eq(agents.id, input.toAgentId))));
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
          .where(and(eq(agentMessages.id, id), eq(agents.userId, bound())))
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
    memories: mvp2.memories,
    roles: mvp2.roles,
    routines: alwaysOn.routines,
    routineRuns: alwaysOn.routineRuns,
    listeners: alwaysOn.listeners,
    listenerDeliveries: alwaysOn.listenerDeliveries,
    notifications: alwaysOn.notifications,
    alwaysOnSettings,
    globalProfiles: {
      async list() {
        const rows = await db
          .select()
          .from(modelProfiles)
          .where(isNull(modelProfiles.userId))
          .orderBy(asc(modelProfiles.createdAt), asc(modelProfiles.publicId));
        return rows.map(toProfile);
      },
      async get(id) {
        const rows = await db
          .select()
          .from(modelProfiles)
          .where(and(isNull(modelProfiles.userId), eq(modelProfiles.publicId, id)))
          .limit(1);
        return rows[0] ? toProfile(rows[0]) : null;
      },
      async upsert(profile) {
        const stored = sanitizeProfile(profile);
        const existing = await db
          .select()
          .from(modelProfiles)
          .where(and(isNull(modelProfiles.userId), eq(modelProfiles.publicId, stored.id)))
          .limit(1);
        const config = nextConfig(existing[0]?.config, stored);
        if (existing[0]) {
          const updated = await db
            .update(modelProfiles)
            .set({ name: stored.name, provider: stored.provider, model: stored.model, config })
            .where(eq(modelProfiles.id, existing[0].id))
            .returning();
          const row = updated[0];
          if (!row) throw new Error('profile update failed');
          return toProfile(row);
        }
        const inserted = await db
          .insert(modelProfiles)
          .values({
            userId: null,
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
      },
      async delete(id) {
        const existing = await db
          .select({ id: modelProfiles.id })
          .from(modelProfiles)
          .where(and(isNull(modelProfiles.userId), eq(modelProfiles.publicId, id)))
          .limit(1);
        const row = existing[0];
        if (!row) return false;
        const used = await db.select({ id: chats.id }).from(chats).where(eq(chats.profileId, row.id)).limit(1);
        if (used[0]) throw new Error('profile is still used by a chat');
        await db.delete(modelProfiles).where(eq(modelProfiles.id, row.id));
        return true;
      },
    },
  };
  return store;
}

type AgentRow = typeof agents.$inferSelect;
type ChatRow = typeof chats.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type ProfileRow = typeof modelProfiles.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type AgentMessageRow = typeof agentMessages.$inferSelect;

function toAgent(row: AgentRow, assigned: AgentRoleSummary[]): Agent {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    icon: row.icon,
    shape: asShape(row.shape),
    picture: row.picture,
    color: asColor(row.color),
    description: row.description,
    systemPrompt: row.prompt,
    toolIds: bindingsToToolIds(row.tools),
    defaultProfileId: row.defaultProfileId,
    createdByAgentId: row.createdByAgentId,
    roleIds: assigned.map((role) => role.id),
    roles: assigned,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toChat(row: ChatRow, profilePublicId: string): Chat {
  return {
    id: row.id,
    agentId: row.agentId,
    memberIds: [...(row.memberIds ?? [])],
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
  if (row.agentId) message.agentId = row.agentId;
  return message;
}

function toProfile(row: ProfileRow): ModelProfile {
  const profile: ModelProfile = {
    id: row.publicId,
    name: row.name,
    provider: row.provider,
    model: row.model,
  };
  const config = row.config ?? {};
  if (typeof config.baseUrl === 'string' && config.baseUrl.length > 0) profile.baseUrl = config.baseUrl;
  if (typeof config.maxTokens === 'number') profile.maxTokens = config.maxTokens;
  if (typeof config.temperature === 'number') profile.temperature = config.temperature;
  const extra = config.extra ?? {};
  if (typeof extra.kind === 'string') profile.kind = extra.kind;
  if (typeof extra.cli === 'string') profile.cli = extra.cli;
  if (typeof extra.bin === 'string') profile.bin = extra.bin;
  if (typeof extra.description === 'string') profile.description = extra.description;
  if (typeof extra.timeoutMs === 'number') profile.timeoutMs = extra.timeoutMs;
  if (typeof extra.passModel === 'boolean') profile.passModel = extra.passModel;
  if (typeof extra.botanicalTools === 'boolean') profile.botanicalTools = extra.botanicalTools;
  return profile;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
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
  if (profile.description) stored.description = profile.description;
  if (profile.baseUrl !== undefined) {
    const baseUrl = profile.baseUrl.trim();
    if (baseUrl) stored.baseUrl = baseUrl;
  }
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

function nextConfig(previous: ModelProfileConfig | undefined, profile: ModelProfile): ModelProfileConfig {
  const record: Record<string, unknown> = { ...(previous ?? {}) };
  for (const key of FORBIDDEN_CONFIG_KEYS) delete record[key];
  if (profile.baseUrl) record.baseUrl = profile.baseUrl;
  else delete record.baseUrl;
  if (profile.maxTokens !== undefined) record.maxTokens = profile.maxTokens;
  if (profile.temperature !== undefined) record.temperature = profile.temperature;
  const extra = { ...((record.extra as Record<string, unknown> | undefined) ?? {}) };
  if (profile.kind) extra.kind = profile.kind;
  if (profile.cli) extra.cli = profile.cli;
  if (profile.bin) extra.bin = profile.bin;
  if (profile.description) extra.description = profile.description;
  if (profile.timeoutMs !== undefined) extra.timeoutMs = profile.timeoutMs;
  if (profile.passModel !== undefined) extra.passModel = profile.passModel;
  if (profile.botanicalTools !== undefined) extra.botanicalTools = profile.botanicalTools;
  if (Object.keys(extra).length > 0) record.extra = extra;
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

function normalizeTitle(title: string | undefined): string {
  const trimmed = (title ?? '').trim();
  if (trimmed.length > TITLE_MAX) throw new Error(`title must be at most ${TITLE_MAX} characters`);
  return trimmed;
}

function normalizeShape(shape: AgentShape | string | undefined): AgentShape {
  if (shape === undefined) return 'squircle';
  return asShape(shape);
}

function normalizePicture(picture: string | null | undefined): string | null {
  if (picture === undefined || picture === null) return null;
  const trimmed = picture.trim();
  if (!trimmed) return null;
  if (trimmed.length > PICTURE_MAX || !PICTURE_PATTERN.test(trimmed)) {
    throw new Error('picture must be a PNG, JPEG, or WebP data URL');
  }
  return trimmed;
}

function asShape(value: string): AgentShape {
  if (!(AGENT_SHAPES as readonly string[]).includes(value)) {
    throw new Error(`shape must be one of ${AGENT_SHAPES.join(', ')}`);
  }
  return value as AgentShape;
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
