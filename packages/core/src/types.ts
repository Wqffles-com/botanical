import type { AccentColor } from "./appearance";
import type { AgentColor, AgentShape } from "./agents";

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

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "member";
}

export interface Me {
  authenticated: true;
  mode: DeploymentMode | null;
  brandName: string | null;
  user: AccountUser | null;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  description: string | null;
  /** `api` for vendor profiles, `cli` for a subscription coding-agent binary. */
  kind?: "api" | "cli";
  /** False when a CLI binary is missing or not logged in. Listed API profiles are available. */
  available?: boolean;
  unavailableReason?: string | null;
  /** Set on CLI profiles: `grok`, `claude`, or `codex`. */
  cli?: string | null;
  /** True on a CLI profile that lets the CLI choose its own model. `model` then names the binary, not a model. */
  defaultModel?: boolean;
}

export interface RolePermissions {
  capabilities: string[];
  mcp: Array<{ server: string; tools?: string[] }>;
}

export interface AgentRoleRef {
  id: string;
  name: string;
  builtin: boolean;
  permissions: RolePermissions;
}

/**
 * Union of the agent's roles. `unrestricted` means the agent has no roles and
 * tools are gated only by its allowlist (the pre-roles behavior).
 */
export interface EffectivePermissions {
  unrestricted: boolean;
  capabilities: string[];
  mcp: Array<{ server: string; tools?: string[] }>;
  roleNames: string[];
}

export type MemoryScope = "shared" | "agent";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  agentId: string | null;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** One entry in an agent's workspace directory (`GET /api/agents/:id/files`). */
export interface WorkspaceEntry {
  name: string;
  /** POSIX path relative to the agent's workspace. */
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
}

export interface WorkspaceListing {
  /** Directory listed, relative to the workspace. `.` is the root. */
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface WorkspaceFile {
  path: string;
  content: string;
  bytes: number;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Appearance {
  accent: AccentColor;
}

export interface Agent {
  id: string;
  /** Display name, 1–40 characters. */
  name: string;
  /** Short role label. Empty when the bot has none. */
  title: string;
  /** Lucide icon name. Defaults to "Bot" when the server omits it. */
  icon: string;
  /** Avatar silhouette. Defaults to "squircle" when the server omits it. */
  shape: AgentShape;
  /**
   * Custom avatar image as a PNG, JPEG, or WebP data URL.
   * Null shows the colored shape and icon instead.
   */
  picture: string | null;
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
   * Default model profile. The web client pre-selects it when starting a chat, and the user
   * can override it. Creating or sending a chat still requires an explicit profileId.
   * Null when the agent has no default.
   */
  defaultProfileId: string | null;
  /** Agent that created this one, or null when the operator did. */
  createdByAgentId: string | null;
  roleIds: string[];
  roles: AgentRoleRef[];
  effectivePermissions: EffectivePermissions;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  title?: string;
  icon?: string;
  shape?: AgentShape;
  /** Data URL, or null to store no picture. */
  picture?: string | null;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  /** Alias of systemPrompt. If both are set they must match. */
  prompt?: string;
  toolIds?: string[];
  /** Alias of toolIds. If both are set they must match. */
  tools?: string[];
  defaultProfileId?: string | null;
  roleIds?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  title?: string;
  icon?: string;
  shape?: AgentShape;
  /** Data URL to set, or null to clear. */
  picture?: string | null;
  color?: AgentColor;
  description?: string;
  systemPrompt?: string;
  prompt?: string;
  toolIds?: string[];
  tools?: string[];
  defaultProfileId?: string | null;
  roleIds?: string[];
}

/**
 * A chat is owned by exactly one agent.
 * `profileId` is the last explicit profile bound to the chat. Null means the
 * server did not store one — the UI must collect a profile before sending.
 */
export interface Chat {
  id: string;
  /** The owning agent. */
  agentId: string;
  /**
   * Other agents in a group chat, in speaking order. Empty for the agent's own chat: each agent
   * has one (`isAgentChat`), and a chat never switches between the two kinds.
   */
  memberIds: string[];
  profileId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Without `memberIds` this opens the agent's own chat: the server returns the existing one,
 * or creates it on `profileId` the first time. With members it starts a new group chat.
 */
export interface CreateChatInput {
  /** Exactly one owning agent. */
  agentId: string;
  /** Other agents that answer in the same chat (a group chat). Omit or leave empty for one agent. */
  memberIds?: string[];
  /** Required. There is no server or client default profile. */
  profileId: string;
  title?: string;
}

export interface UpdateChatInput {
  title?: string;
  profileId?: string;
  /** Replaces the group members. An empty list makes it a one-agent chat again. */
  memberIds?: string[];
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
  /** Agent that wrote an assistant or tool row. Unset on user rows and older rows (the chat's owner). */
  agentId?: string | null;
  usage?: TokenUsage | null;
}

export interface SendMessageInput {
  content: string;
  /** Required on every turn. The client refuses to post without it. */
  profileId: string;
}

export interface QueueMessageInput extends SendMessageInput {
  /** Echoed back as the queue id, so a retry does not double-send and the UI can match its bubble. */
  clientId?: string;
}

/** A message the server accepted and has not written to the transcript yet. */
export interface QueuedMessage {
  id: string;
  content: string;
  profileId: string;
  createdAt: string;
}

/** `GET /api/chats/:id/events`. Replies arrive as whole messages, never as deltas. */
export type ChatEvent =
  /** `agentId` is the agent answering right now; it changes as group members take turns. */
  | { type: "status"; running: boolean; queued: QueuedMessage[]; agentId?: string }
  | { type: "message"; message: ChatMessage; queuedId?: string }
  | { type: "error"; error: string; code: string }
  | { type: "message-updated"; message: ChatMessage }
  | { type: "messages-deleted"; ids: string[] };

/** Async agent-to-agent mail. Status moves pending → delivered → read, or failed. */
export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

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
  | { type: "tool-result"; id: string; content: string; isError?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: string }
  | { type: "done"; messageId?: string };

export type RoutineRunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
export type RoutineRunTrigger = "schedule" | "manual";
export type ListenerDeliveryStatus = "accepted" | "rejected" | "succeeded" | "failed";
export type NotificationKind = "run_succeeded" | "run_failed" | "attention";

export interface RoutineRun {
  id: string;
  routineId: string;
  trigger: RoutineRunTrigger;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RoutineRunStatus;
  error: string | null;
  chatId: string | null;
  createdAt: string;
}

export interface Routine {
  id: string;
  /** Owner. The single operator until accounts exist. */
  userId: string;
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRun?: RoutineRun | null;
}

export interface RoutineInput {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled?: boolean;
}

export interface RoutinePatch {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  profileId?: string;
  enabled?: boolean;
}

export interface SchedulePreview {
  valid: boolean;
  error?: string;
  next: string[];
}

export interface Listener {
  id: string;
  /** Owner. The single operator until accounts exist. */
  userId: string;
  agentId: string;
  name: string;
  kind: string;
  profileId: string;
  promptTemplate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface ListenerInput {
  agentId: string;
  name: string;
  profileId: string;
  promptTemplate?: string;
  enabled?: boolean;
}

export interface ListenerPatch {
  name?: string;
  profileId?: string;
  promptTemplate?: string;
  enabled?: boolean;
}

export interface ListenerCreated {
  listener: Listener;
  secret: string;
  url: string;
}

export interface ListenerDelivery {
  id: string;
  listenerId: string;
  receivedAt: string;
  status: ListenerDeliveryStatus;
  httpStatus: number;
  error: string | null;
  payloadBytes: number;
  payloadPreview: string;
  chatId: string | null;
}

export interface AppNotification {
  id: string;
  /** Owner. The single operator until accounts exist. */
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  agentId: string | null;
  chatId: string | null;
  routineRunId: string | null;
  listenerDeliveryId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unreadCount: number;
}

/** Instance-admin tuning for routines, listeners, and background turns. */
export interface AlwaysOnSettings {
  schedulerEnabled: boolean;
  schedulerIntervalMs: number;
  backgroundConcurrency: number;
  listenerMaxBytes: number;
}

export const CLIENT_CONTRACT_VERSION = "1";
