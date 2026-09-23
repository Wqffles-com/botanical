/** Deployment flag from server config. Behavior is the same in v0; the client only badges it. */
export type DeploymentMode = "SELF_HOST" | "SAAS";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Health {
  ok: boolean;
  mode: DeploymentMode | null;
  version: string | null;
  brandName: string | null;
}

/** Bearer token when the server issues one. Empty token means cookie session only. */
export interface LoginResult {
  token: string;
  expiresAt: string | null;
  mode: DeploymentMode | null;
}

export interface Me {
  authenticated: true;
  mode: DeploymentMode | null;
  brandName: string | null;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  description: string | null;
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

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  toolIds?: string[];
}

/**
 * A chat is owned by exactly one agent.
 * `profileId` is the last explicit profile bound to the chat. Null means the
 * server did not store one — the UI must collect a profile before sending.
 */
export interface Chat {
  id: string;
  agentId: string;
  profileId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatInput {
  /** Exactly one owning agent. */
  agentId: string;
  /** Required. There is no server or client default profile. */
  profileId: string;
  title?: string;
}

export interface UpdateChatInput {
  title?: string;
  profileId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage | null;
}

export interface SendMessageInput {
  content: string;
  /** Required on every turn. The client refuses to post without it. */
  profileId: string;
}

export type ChatStreamEvent =
  | { type: "message-start"; messageId: string; role?: MessageRole }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "tool-result"; id: string; content: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: string }
  | { type: "done"; messageId?: string };

export const CLIENT_CONTRACT_VERSION = "1";
