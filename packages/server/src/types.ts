/**
 * HTTP-layer domain types.
 *
 * TODO(packages/core): move shared agent, chat, message, and profile schemas
 * into packages/core when that package exists, and keep these routes aligned.
 *
 * TODO(packages/db): the Store interfaces below are the persistence contract.
 * packages/db should export `createStore({ connectionString })` returning a
 * Store with kind "postgres". See src/db/postgres.ts.
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
}

/** Single v0 operator. SaaS multi-user accounts are not implemented. */
export interface Operator {
  id: "operator";
}
