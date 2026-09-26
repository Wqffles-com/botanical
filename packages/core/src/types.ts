import type { AgentColor } from "./agents";

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
  /** Display name, 1–40 characters. */
  name: string;
  /** Lucide icon name. Defaults to "Bot" when the server omits it. */
  icon: string;
  /** Picker swatch. Defaults to "green" when the server omits it. */
  color: AgentColor;
  description: string;
  /** System prompt. Same text as `prompt`. */
  systemPrompt: string;
  /** System prompt. Same text as `systemPrompt` (shared contract name). */
  prompt: string;
  toolIds: string[];
  /** Tool ids. Same list as `toolIds` (shared contract name). */
  tools: string[];
  /**
   * Suggested profile only. Creating or sending a chat still requires an explicit profileId.
   * Null when the agent has no suggestion.
   */
  defaultProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  icon?: string;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  /** Alias of systemPrompt. If both are set they must match. */
  prompt?: string;
  toolIds?: string[];
  /** Alias of toolIds. If both are set they must match. */
  tools?: string[];
  defaultProfileId?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  icon?: string;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  prompt?: string;
  toolIds?: string[];
  tools?: string[];
  defaultProfileId?: string | null;
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
  toolCallId?: string;
  name?: string;
  profileId?: string | null;
  usage?: TokenUsage | null;
}

export interface SendMessageInput {
  content: string;
  /** Required on every turn. The client refuses to post without it. */
  profileId: string;
}

/** Async agent-to-agent mail. Status moves pending → delivered → read, or failed. */
export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

/**
 * Title of the recipient's dedicated inbox thread.
 * Autorun (`BOTANICAL_A2A_AUTORUN`) appends received mail there and takes one turn.
 */
export const INBOX_CHAT_TITLE = "Inbox";

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  status: AgentMessageStatus;
  createdAt: string;
  updatedAt?: string;
  deliveredAt?: string;
  readAt?: string;
  fromChatId?: string;
  error?: string;
}

export interface SendAgentMessageInput {
  fromAgentId: string;
  toAgentId: string;
  body: string;
}

export interface UpdateAgentMessageInput {
  status: AgentMessageStatus;
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
