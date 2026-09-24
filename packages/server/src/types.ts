/**
 * HTTP-layer domain types.
 *
 * TODO(packages/core): move shared agent, chat, message, and profile schemas
 * into packages/core when that package exists, and keep these routes aligned.
 * A2A message shapes already live in `@botanical/core` and are re-exported here.
 *
 * TODO(packages/db): the Store interfaces below are the persistence contract.
 * packages/db should export `createStore({ connectionString })` returning a
 * Store with kind "postgres". See src/db/postgres.ts.
 * `agentMessages` must persist to the `agent_messages` table. Until that
 * repository is present, the server attaches an in-memory one with the same methods.
 */

export const DEPLOYMENT_MODES = ["SELF_HOST", "SAAS"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "xai",
  "deepseek",
  "openrouter",
  "openai-compat",
  "mock",
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** Operator-configured model profile. API keys are never part of this object. */
export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NewAgent {
  name: string;
  description: string;
  systemPrompt: string;
  toolIds: string[];
}

export interface AgentPatch {
  name?: string;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
}

/** One chat is owned by exactly one agent. agentId is immutable after create. */
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

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface NewMessage {
  chatId: string;
  role: MessageRole;
  content: string;
}

export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

/**
 * One async agent-to-agent note. `insert` stores `pending`.
 * `deliverPending` moves pending → delivered. `markRead` moves delivered → read.
 */
export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  status: AgentMessageStatus;
  createdAt: string;
  updatedAt: string;
  fromChatId?: string;
  deliveredAt?: string;
  readAt?: string;
  error?: string;
}

export interface NewAgentMessage {
  id?: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  fromChatId?: string;
}

export interface AgentMessageRepository {
  insert(input: NewAgentMessage): Promise<AgentMessage>;
  get(id: string): Promise<AgentMessage | null>;
  /**
   * Inbox for `agentId` (rows whose recipient is that agent).
   * Oldest first unless `newestFirst`.
   */
  listForAgent(
    agentId: string,
    opts?: { status?: AgentMessageStatus[]; limit?: number; newestFirst?: boolean },
  ): Promise<AgentMessage[]>;
  /**
   * Atomically move pending rows to delivered.
   * Postgres implementations must use SKIP LOCKED so overlapping workers don't double-deliver.
   */
  deliverPending(opts?: { limit?: number; toAgentId?: string }): Promise<AgentMessage[]>;
  /** Transition delivered → read. Rows in any other status are left alone. */
  markRead(ids: readonly string[]): Promise<AgentMessage[]>;
  /**
   * Explicit status write for `PATCH /api/agent-messages/:id`.
   * Callers enforce allowed transitions. Returns null when the id is missing.
   */
  updateStatus(id: string, status: AgentMessageStatus): Promise<AgentMessage | null>;
}

export interface Session {
  id: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface AgentRepository {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | null>;
  create(input: NewAgent): Promise<Agent>;
  update(id: string, patch: AgentPatch): Promise<Agent | null>;
  delete(id: string): Promise<boolean>;
}

export interface ChatRepository {
  list(): Promise<Chat[]>;
  get(id: string): Promise<Chat | null>;
  create(input: NewChat): Promise<Chat>;
  update(id: string, patch: ChatPatch): Promise<Chat | null>;
  delete(id: string): Promise<boolean>;
  countByAgent(agentId: string): Promise<number>;
}

export interface MessageRepository {
  listByChat(chatId: string): Promise<Message[]>;
  create(input: NewMessage): Promise<Message>;
  deleteByChat(chatId: string): Promise<number>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  getByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(id: string): Promise<boolean>;
}

export interface Store {
  /** "memory" is process-local. "postgres" is packages/db. */
  readonly kind: "memory" | "postgres";
  readonly agents: AgentRepository;
  readonly chats: ChatRepository;
  readonly messages: MessageRepository;
  readonly sessions: SessionRepository;
  readonly agentMessages: AgentMessageRepository;
}

/** Single v0 operator. SaaS multi-user accounts are not implemented. */
export interface Operator {
  id: "operator";
}
