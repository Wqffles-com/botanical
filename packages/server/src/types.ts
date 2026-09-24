/**
 * HTTP-layer domain types. This Store is the persistence contract.
 *
 * packages/db exports `createStore({ connectionString })` returning a Store
 * with kind "postgres". Field names here (`systemPrompt`, `toolIds`) are the
 * HTTP shape. The database columns are `prompt` and `tools`.
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

export const AGENT_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "blue",
  "violet",
  "pink",
  "gray",
] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

export const DEFAULT_AGENT_ICON = "Bot";
export const DEFAULT_AGENT_COLOR: AgentColor = "green";

export interface Agent {
  id: string;
  /** Display name, 1–40 characters. */
  name: string;
  /** Lucide icon name, for example "Bot" or "Sprout". */
  icon: string;
  color: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  /** Suggestion only. The chat still requires an explicit profile pick. */
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

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  /** Set on role "tool". References the assistant tool call this result answers. */
  toolCallId?: string;
  /** Tool name for a tool result. */
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

export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

/** Async agent-to-agent inbox row. It does not belong to a user chat. */
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

/**
 * Profile metadata only. Implementations must not persist API keys, tokens, or passwords.
 * `id` is the public profile id (for example "grok"), not an internal row id.
 */
export interface ProfileRepository {
  list(): Promise<ModelProfile[]>;
  get(id: string): Promise<ModelProfile | null>;
  upsert(profile: ModelProfile): Promise<ModelProfile>;
  delete(id: string): Promise<boolean>;
}

export interface AgentMessageRepository {
  /**
   * `agentId` matches either endpoint. `status` filters that column.
   * Order is oldest first.
   */
  list(query?: { agentId?: string; status?: AgentMessageStatus }): Promise<AgentMessage[]>;
  get(id: string): Promise<AgentMessage | null>;
  create(input: NewAgentMessage): Promise<AgentMessage>;
  update(id: string, patch: AgentMessagePatch): Promise<AgentMessage | null>;
}

export interface Store {
  /** "memory" is process-local. "postgres" is packages/db. */
  readonly kind: "memory" | "postgres";
  readonly agents: AgentRepository;
  readonly chats: ChatRepository;
  readonly messages: MessageRepository;
  readonly sessions: SessionRepository;
  readonly profiles: ProfileRepository;
  readonly agentMessages: AgentMessageRepository;
  /** Release the backing pool. Memory stores resolve immediately. */
  close(): Promise<void>;
}

/** Single v0 operator. SaaS multi-user accounts are not implemented. */
export interface Operator {
  id: "operator";
}
