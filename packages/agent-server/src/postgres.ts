import { readFile } from "node:fs/promises";
import {
  AgentInUseError,
  AgentNotFoundError,
  ChatNotFoundError,
  type AgentMessageRecord,
  type AgentMessageRepository,
  type AgentMessageStatus,
  type AgentRecord,
  type AgentRepository,
  type ChatRecord,
  type ChatRepository,
  type CreateAgentInput,
  type MessageRecord,
  type MessageRepository,
  type NewAgentMessage,
  type NewMessage,
  type Store,
  type ToolCall,
  type UpdateAgentInput,
} from "@botanical/agent-runtime";
import postgres from "postgres";
import { splitSqlStatements } from "./sql";

export interface PostgresHandle {
  store: Store;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: unknown;
  a2a_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ChatRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRecord["role"];
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
  name: string | null;
  profile_id: string | null;
  created_at: Date | string;
  seq: string | number;
}

interface AgentMessageRow {
  id: string;
  from_agent: string;
  to_agent: string;
  from_chat_id: string | null;
  body: string;
  status: AgentMessageStatus;
  error: string | null;
  created_at: Date | string;
  delivered_at: Date | string | null;
  read_at: Date | string | null;
  seq: string | number;
}

const SCHEMA_URL = new URL("../sql/001_runtime.sql", import.meta.url);

export function createPostgresStore(databaseUrl: string, options?: { max?: number }): PostgresHandle {
  const sql = postgres(databaseUrl, {
    max: options?.max ?? 10,
    onnotice: () => {},
  });

  const agents: AgentRepository = {
    async get(id) {
      const rows = await sql<AgentRow[]>`SELECT * FROM agents WHERE id = ${id}`;
      return rows[0] ? mapAgent(rows[0]) : null;
    },
    async getByName(name) {
      const rows = await sql<AgentRow[]>`
        SELECT * FROM agents WHERE name = ${name}
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `;
      return rows[0] ? mapAgent(rows[0]) : null;
    },
    async list(limit = 200) {
      const rows = await sql<AgentRow[]>`
        SELECT * FROM agents ORDER BY created_at ASC, id ASC LIMIT ${clamp(limit, 200, 500)}
      `;
      return rows.map(mapAgent);
    },
    async create(input: CreateAgentInput) {
      const id = input.id ?? crypto.randomUUID();
      const rows = await sql<AgentRow[]>`
        INSERT INTO agents (id, name, description, prompt, tools, a2a_enabled)
        VALUES (
          ${id},
          ${input.name},
          ${input.description},
          ${input.prompt},
          ${JSON.stringify(input.toolAllowlist)}::jsonb,
          ${input.a2aEnabled}
        )
        RETURNING *
      `;
      const row = rows[0];
      if (!row) throw new Error("agent insert returned no row");
      return mapAgent(row);
    },
    async update(id, patch: UpdateAgentInput) {
      const current = await agents.get(id);
      if (!current) throw new AgentNotFoundError(id);
      const next: AgentRecord = {
        ...current,
        name: patch.name ?? current.name,
        description: patch.description ?? current.description,
        prompt: patch.prompt ?? current.prompt,
        toolAllowlist: patch.toolAllowlist ? [...patch.toolAllowlist] : current.toolAllowlist,
        a2aEnabled: patch.a2aEnabled ?? current.a2aEnabled,
        updatedAt: new Date().toISOString(),
      };
      const rows = await sql<AgentRow[]>`
        UPDATE agents
        SET name = ${next.name},
            description = ${next.description},
            prompt = ${next.prompt},
            tools = ${JSON.stringify(next.toolAllowlist)}::jsonb,
            a2a_enabled = ${next.a2aEnabled},
            updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `;
      const row = rows[0];
      if (!row) throw new AgentNotFoundError(id);
      return mapAgent(row);
    },
    async delete(id) {
      const existing = await agents.get(id);
      if (!existing) throw new AgentNotFoundError(id);
      const owned = await sql<{ id: string }[]>`SELECT id FROM chats WHERE agent_id = ${id} LIMIT 1`;
      if (owned.length > 0) throw new AgentInUseError(id);
      await sql`DELETE FROM agents WHERE id = ${id}`;
    },
  };

  const chats: ChatRepository = {
    async get(id) {
      const rows = await sql<ChatRow[]>`SELECT * FROM chats WHERE id = ${id}`;
      return rows[0] ? mapChat(rows[0]) : null;
    },
    async list(limit = 200) {
      const rows = await sql<ChatRow[]>`
        SELECT * FROM chats ORDER BY updated_at DESC, id DESC LIMIT ${clamp(limit, 200, 500)}
      `;
      return rows.map(mapChat);
    },
    async listByAgent(agentId) {
      const rows = await sql<ChatRow[]>`SELECT * FROM chats WHERE agent_id = ${agentId} ORDER BY created_at ASC`;
      return rows.map(mapChat);
    },
    async create(input) {
      const id = input.id ?? crypto.randomUUID();
      try {
        const rows = await sql<ChatRow[]>`
          INSERT INTO chats (id, agent_id, title)
          VALUES (${id}, ${input.agentId}, ${input.title?.trim() ?? ""})
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("chat insert returned no row");
        return mapChat(row);
      } catch (error) {
        if (isPg(error, "23503")) throw new AgentNotFoundError(input.agentId);
        throw error;
      }
    },
    async updateTitle(id, title) {
      const rows = await sql<ChatRow[]>`
        UPDATE chats SET title = ${title}, updated_at = now() WHERE id = ${id} RETURNING *
      `;
      const row = rows[0];
      if (!row) throw new ChatNotFoundError(id);
      return mapChat(row);
    },
    async touch(id) {
      const rows = await sql<{ id: string }[]>`
        UPDATE chats SET updated_at = now() WHERE id = ${id} RETURNING id
      `;
      if (!rows[0]) throw new ChatNotFoundError(id);
    },
  };

  const messages: MessageRepository = {
    async listByChat(chatId) {
      const rows = await sql<MessageRow[]>`
        SELECT * FROM messages WHERE chat_id = ${chatId} ORDER BY seq ASC
      `;
      return rows.map(mapMessage);
    },
    async append(input: NewMessage) {
      const id = input.id ?? crypto.randomUUID();
      try {
        const rows = await sql<MessageRow[]>`
          INSERT INTO messages (id, chat_id, role, content, tool_calls, tool_call_id, name, profile_id)
          VALUES (
            ${id},
            ${input.chatId},
            ${input.role},
            ${input.content},
            ${input.toolCalls ? JSON.stringify(input.toolCalls) : null}::jsonb,
            ${input.toolCallId ?? null},
            ${input.name ?? null},
            ${input.profileId ?? null}
          )
          RETURNING *
        `;
        const row = rows[0];
        if (!row) throw new Error("message insert returned no row");
        return mapMessage(row);
      } catch (error) {
        if (isPg(error, "23503")) throw new ChatNotFoundError(input.chatId);
        throw error;
      }
    },
  };

  const agentMessages: AgentMessageRepository = {
    async insert(input: NewAgentMessage) {
      const id = input.id ?? crypto.randomUUID();
      const rows = await sql<AgentMessageRow[]>`
        INSERT INTO agent_messages (id, from_agent, to_agent, from_chat_id, body, status)
        VALUES (
          ${id},
          ${input.fromAgentId},
          ${input.toAgentId},
          ${input.fromChatId ?? null},
          ${input.body},
          'pending'
        )
        RETURNING *
      `;
      const row = rows[0];
      if (!row) throw new Error("agent message insert returned no row");
      return mapAgentMessage(row);
    },
    async get(id) {
      const rows = await sql<AgentMessageRow[]>`SELECT * FROM agent_messages WHERE id = ${id}`;
      return rows[0] ? mapAgentMessage(rows[0]) : null;
    },
    async listForAgent(agentId, opts) {
      const limit = clamp(opts?.limit, 100, 500);
      const statusFilter =
        opts?.status && opts.status.length > 0
          ? sql`AND status IN ${sql(opts.status)}`
          : sql``;
      const direction = opts?.newestFirst ? sql`DESC` : sql`ASC`;
      const rows = await sql<AgentMessageRow[]>`
        SELECT * FROM agent_messages
        WHERE to_agent = ${agentId}
        ${statusFilter}
        ORDER BY seq ${direction}
        LIMIT ${limit}
      `;
      return rows.map(mapAgentMessage);
    },
    async deliverPending(opts) {
      const limit = clamp(opts?.limit, 50, 500);
      const agentFilter = opts?.toAgentId ? sql`AND to_agent = ${opts.toAgentId}` : sql``;
      // One statement so SKIP LOCKED holds until the status flip commits.
      const rows = await sql<AgentMessageRow[]>`
        WITH picked AS (
          SELECT id FROM agent_messages
          WHERE status = 'pending'
          ${agentFilter}
          ORDER BY seq ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE agent_messages AS m
        SET status = 'delivered', delivered_at = now()
        FROM picked
        WHERE m.id = picked.id
        RETURNING m.*
      `;
      return rows
        .slice()
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .map(mapAgentMessage);
    },
    async markRead(ids) {
      if (ids.length === 0) return [];
      const rows = await sql<AgentMessageRow[]>`
        UPDATE agent_messages
        SET status = 'read', read_at = now()
        WHERE id IN ${sql([...ids])} AND status = 'delivered'
        RETURNING *
      `;
      return rows
        .slice()
        .sort((a, b) => Number(a.seq) - Number(b.seq))
        .map(mapAgentMessage);
    },
  };

  const store: Store = { agents, chats, messages, agentMessages };

  return {
    store,
    async migrate() {
      const ddl = await readFile(SCHEMA_URL, "utf8");
      for (const statement of splitSqlStatements(ddl)) {
        await sql.unsafe(statement);
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    toolAllowlist: asStringArray(row.tools),
    a2aEnabled: row.a2a_enabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  const message: MessageRecord = {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
  };
  const toolCalls = asToolCalls(row.tool_calls);
  if (toolCalls) message.toolCalls = toolCalls;
  if (row.tool_call_id) message.toolCallId = row.tool_call_id;
  if (row.name) message.name = row.name;
  if (row.profile_id) message.profileId = row.profile_id;
  return message;
}

function mapAgentMessage(row: AgentMessageRow): AgentMessageRecord {
  const message: AgentMessageRecord = {
    id: row.id,
    fromAgentId: row.from_agent,
    toAgentId: row.to_agent,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
  };
  if (row.from_chat_id) message.fromChatId = row.from_chat_id;
  if (row.error) message.error = row.error;
  if (row.delivered_at) message.deliveredAt = iso(row.delivered_at);
  if (row.read_at) message.readAt = iso(row.read_at);
  return message;
}

function asStringArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => String(entry));
}

function asToolCalls(value: unknown): ToolCall[] | undefined {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed.map((entry) => {
    const record = entry as Partial<ToolCall>;
    return {
      id: String(record.id ?? ""),
      name: String(record.name ?? ""),
      arguments: record.arguments,
    };
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function isPg(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
