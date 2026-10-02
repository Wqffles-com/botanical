import type {
  AccountRepository,
  AlwaysOnSettingsRepository,
  AuthUser,
  PrefsRepository,
  SecretRepository,
} from "@botanical/db";
import type { AgentColor, AgentShape } from "@botanical/core";

/**
 * HTTP-layer domain types. This Store is the persistence contract.
 *
 * Agent identity (name, icon, color, prompt, tools, defaultProfileId) matches
 * @botanical/core. This store still uses systemPrompt and toolIds; routes
 * accept prompt/tools as aliases and return both names.
 * A2A message shapes also live in `@botanical/core` and are re-exported here.
 *
 * packages/db exports `createStore({ connectionString })` returning a Store
 * with kind "postgres". Field names here (`systemPrompt`, `toolIds`) are the
 * HTTP shape. The database columns are `prompt` and `tools`.
 * `agentMessages` persists to `agent_messages`. The runtime bus uses `insert`,
 * `listForAgent`, `deliverPending`, and `markRead`. The HTTP store also exposes
 * `list`, `create`, and `update` for the same rows.
 */

export { AGENT_COLORS, DEFAULT_AGENT_COLOR, DEFAULT_AGENT_ICON } from "@botanical/core";
export type { AgentColor, AgentShape };

export const DEPLOYMENT_MODES = ["SELF_HOST", "SAAS"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "xai",
  "deepseek",
  "openrouter",
  "openai-compat",
] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export type ProfileKind = "api" | "cli";
export type CliName = "grok" | "claude" | "codex";

/** Operator-configured model profile. API keys are never part of this object. */
export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider | "cli";
  model: string;
  description?: string | null;
  baseUrl?: string;
  /** Output cap forwarded to the provider. Anthropic requires one. */
  maxTokens?: number;
  temperature?: number;
  /** `api` is a vendor profile. `cli` runs a subscription coding agent on the server. */
  kind?: ProfileKind;
  cli?: CliName;
  /** Absolute path to the CLI binary. Omitted: resolve `cli` on PATH. */
  bin?: string;
  timeoutMs?: number;
  /** When false, do not pass a model flag. Unset model is not a silent default. */
  passModel?: boolean;
  /**
   * CLI profiles only. `false` skips the per-run Botanical MCP server.
   * Omitted means the tools are exposed.
   */
  botanicalTools?: boolean;
}

export interface RolePermissions {
  capabilities: string[];
  mcp: Array<{ server: string; tools?: string[] }>;
}

export interface AgentRoleSummary {
  id: string;
  name: string;
  builtin: boolean;
  permissions: RolePermissions;
}

export interface Agent {
  id: string;
  /** Display name, 1–40 characters. */
  name: string;
  /** Short role label. Empty when unset. */
  title: string;
  /** Lucide icon name, for example "Bot" or "Sprout". */
  icon: string;
  /** Avatar silhouette. */
  shape: AgentShape;
  /** PNG, JPEG, or WebP data URL, or null. */
  picture: string | null;
  color: AgentColor;
  description: string;
  systemPrompt: string;
  toolIds: string[];
  /** Suggestion only. Chats still require an explicit profile. */
  defaultProfileId: string | null;
  /** Set when another agent created this one. Null for operator-created agents. */
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

export interface NewMemory {
  scope: MemoryScope;
  agentId?: string | null;
  content: string;
  tags?: string[];
}

export interface MemoryPatch {
  content?: string;
  tags?: string[];
}

export interface MemoryQuery {
  scope?: MemoryScope;
  agentId?: string;
  q?: string;
  tag?: string;
  limit?: number;
}

export interface MemoryRepository {
  list(query?: MemoryQuery): Promise<MemoryRecord[]>;
  listVisible(agentId: string, opts?: { limit?: number }): Promise<MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | null>;
  create(input: NewMemory): Promise<MemoryRecord>;
  update(id: string, patch: MemoryPatch): Promise<MemoryRecord | null>;
  delete(id: string): Promise<boolean>;
  deleteVisible(id: string, agentId: string): Promise<"deleted" | "missing" | "forbidden">;
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

export interface NewRole {
  name: string;
  description?: string;
  permissions: RolePermissions;
}

export interface RolePatch {
  name?: string;
  description?: string;
  permissions?: RolePermissions;
}

export interface RoleRepository {
  list(): Promise<RoleRecord[]>;
  get(id: string): Promise<RoleRecord | null>;
  getByName(name: string): Promise<RoleRecord | null>;
  create(input: NewRole): Promise<RoleRecord>;
  update(id: string, patch: RolePatch): Promise<RoleRecord | null>;
  delete(id: string): Promise<boolean>;
  listForAgent(agentId: string): Promise<RoleRecord[]>;
  setForAgent(agentId: string, roleIds: readonly string[]): Promise<RoleRecord[]>;
}

/**
 * One chat is owned by exactly one agent. agentId is immutable after create.
 * A group chat also has members: other agents that answer in the same thread, in this order.
 */
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
  /** Profile used for this row. Null when the row has no profile. */
  profileId?: string | null;
  /** Agent that wrote an assistant or tool row. Unset on user rows and rows written before group chats. */
  agentId?: string | null;
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

export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

/**
 * One async agent-to-agent note. `insert` stores `pending`.
 * `deliverPending` moves pending → delivered. `markRead` moves delivered → read.
 * It does not belong to a user chat.
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

export interface AgentMessagePatch {
  status?: AgentMessageStatus;
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
  /**
   * `agentId` matches either endpoint. `status` filters that column.
   * Order is oldest first.
   */
  list(query?: { agentId?: string; status?: AgentMessageStatus }): Promise<AgentMessage[]>;
  create(input: NewAgentMessage): Promise<AgentMessage>;
  update(id: string, patch: AgentMessagePatch): Promise<AgentMessage | null>;
}

export interface Session {
  id: string;
  userId: string;
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
  /** Chats the agent owns or is a member of. */
  countByAgent(agentId: string): Promise<number>;
}

/** Message search over the caller's own chats. */
export interface MessageSearchQuery {
  q: string;
  /** Chats to search. The caller passes only chats it owns. */
  chatIds: readonly string[];
  /** `user` is the person's own messages, `assistant` is replies. Both when unset. */
  role?: "user" | "assistant";
  /** Inclusive ISO bounds on `createdAt`. */
  from?: string;
  to?: string;
  limit: number;
}

export interface MessageRepository {
  listByChat(chatId: string): Promise<Message[]>;
  /** User and assistant text rows matching `q`, newest first. Tool and system rows are never returned. */
  search(query: MessageSearchQuery): Promise<Message[]>;
  create(input: NewMessage): Promise<Message>;
  /** Replace a message's text. Null when the message is not in this chat. */
  updateContent(chatId: string, id: string, content: string): Promise<Message | null>;
  /** Delete the given messages of one chat. Returns how many were removed. */
  deleteMany(chatId: string, ids: readonly string[]): Promise<number>;
  deleteByChat(chatId: string): Promise<number>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  getByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(id: string): Promise<boolean>;
  /** Newest first. */
  listByUser(userId: string): Promise<Session[]>;
  /** Delete a user's sessions, keeping `exceptId` when given. Returns how many were removed. */
  deleteByUser(userId: string, exceptId?: string): Promise<number>;
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

export type RoutineRunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
export type RoutineRunTrigger = "schedule" | "manual";
export type ListenerDeliveryStatus = "accepted" | "rejected" | "ignored" | "succeeded" | "failed";
export type NotificationKind = "run_succeeded" | "run_failed" | "attention";

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
}

export interface NewRoutine {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  profileId: string;
  enabled: boolean;
  nextRunAt: string;
}

export interface RoutinePatch {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  profileId?: string;
  enabled?: boolean;
  nextRunAt?: string;
  lastRunAt?: string | null;
}

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
  /** Set while a process is executing the run. */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
}

export interface NewRoutineRun {
  routineId: string;
  trigger: RoutineRunTrigger;
  scheduledFor: string;
  status?: RoutineRunStatus;
  chatId?: string | null;
}

export interface RoutineRunPatch {
  status?: RoutineRunStatus;
  error?: string | null;
  chatId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
}

export interface ClaimedRoutine {
  routine: Routine;
  run: RoutineRun;
}

/** Computes the next future slot strictly after `after`. */
export type NextSlot = (routine: { cron: string; timezone: string }, after: Date) => Date;

export interface RoutineRepository {
  list(query?: { agentId?: string }): Promise<Routine[]>;
  get(id: string): Promise<Routine | null>;
  create(input: NewRoutine): Promise<Routine>;
  update(id: string, patch: RoutinePatch): Promise<Routine | null>;
  delete(id: string): Promise<boolean>;
  /**
   * Claim up to `limit` due routines. Safe for overlapping callers:
   * the same schedule slot is inserted at most once, and `nextRunAt`
   * moves to the next future slot (one catch-up, then skip the gap).
   */
  claimDue(limit: number, now: Date, nextSlot: NextSlot): Promise<ClaimedRoutine[]>;
}

export interface RoutineRunRepository {
  list(routineId: string, opts?: { limit?: number; offset?: number }): Promise<RoutineRun[]>;
  get(id: string): Promise<RoutineRun | null>;
  create(input: NewRoutineRun): Promise<RoutineRun>;
  update(id: string, patch: RoutineRunPatch): Promise<RoutineRun | null>;
  latest(routineId: string): Promise<RoutineRun | null>;
  /**
   * Take the run for this process. Fails when another process holds an unexpired lease.
   * Sets status to running.
   */
  claimLease(id: string, owner: string, expiresAt: string): Promise<boolean>;
  /** Extend the lease. No-op unless `owner` still holds it and the run is open. */
  renewLease(id: string, owner: string, expiresAt: string): Promise<boolean>;
  /** Finish the run only if `owner` still holds the lease. */
  finishOwned(id: string, owner: string, patch: RoutineRunPatch): Promise<RoutineRun | null>;
  /**
   * Fail open runs whose lease has expired, and queued runs that were never
   * picked up and are older than the lease window. Writes a failure notification.
   */
  reapExpired(now: Date): Promise<number>;
}

/**
 * Inbound webhook (and, later, typed) listener.
 * `secret` is stored in full so HMAC can be recomputed. Database access is secret access.
 * HTTP list/get must omit it.
 */
export interface Listener {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  kind: string;
  /** GitHub listeners: `<X-GitHub-Event>.<action>` ids that start a turn. Empty for webhooks. */
  events: string[];
  profileId: string;
  promptTemplate: string;
  secret: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NewListener {
  agentId: string;
  name: string;
  kind: string;
  events: string[];
  profileId: string;
  promptTemplate: string;
  secret: string;
  enabled: boolean;
}

export interface ListenerPatch {
  name?: string;
  events?: string[];
  profileId?: string;
  promptTemplate?: string;
  enabled?: boolean;
}

export interface ListenerRepository {
  list(query?: { agentId?: string }): Promise<Listener[]>;
  get(id: string): Promise<Listener | null>;
  create(input: NewListener): Promise<Listener>;
  update(id: string, patch: ListenerPatch): Promise<Listener | null>;
  setSecret(id: string, secret: string): Promise<Listener | null>;
  delete(id: string): Promise<boolean>;
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
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
}

export interface NewListenerDelivery {
  listenerId: string;
  status: ListenerDeliveryStatus;
  httpStatus: number;
  error?: string | null;
  payloadBytes: number;
  payloadPreview: string;
  chatId?: string | null;
}

export interface ListenerDeliveryPatch {
  status?: ListenerDeliveryStatus;
  error?: string | null;
  chatId?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
}

export interface ListenerDeliveryRepository {
  list(listenerId: string, opts?: { limit?: number; offset?: number }): Promise<ListenerDelivery[]>;
  get(id: string): Promise<ListenerDelivery | null>;
  create(input: NewListenerDelivery): Promise<ListenerDelivery>;
  update(id: string, patch: ListenerDeliveryPatch): Promise<ListenerDelivery | null>;
  /** Hold an accepted delivery. Fails when another process holds an unexpired lease. */
  claimLease(id: string, owner: string, expiresAt: string): Promise<boolean>;
  renewLease(id: string, owner: string, expiresAt: string): Promise<boolean>;
  finishOwned(id: string, owner: string, patch: ListenerDeliveryPatch): Promise<ListenerDelivery | null>;
  /**
   * Fail accepted deliveries whose lease expired, and accepted rows that were
   * never picked up and are older than the lease window. Writes a failure notification.
   */
  reapExpired(now: Date): Promise<number>;
}

export interface Notification {
  id: string;
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

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  agentId?: string | null;
  chatId?: string | null;
  routineRunId?: string | null;
  listenerDeliveryId?: string | null;
}

export interface NotificationRepository {
  list(opts?: { limit?: number; offset?: number }): Promise<Notification[]>;
  unreadCount(): Promise<number>;
  get(id: string): Promise<Notification | null>;
  create(input: NewNotification): Promise<Notification>;
  markRead(id: string, now: Date): Promise<Notification | null>;
  markAllRead(now: Date): Promise<number>;
}

export interface Store {
  /** "memory" is process-local. "postgres" is packages/db. */
  readonly kind: "memory" | "postgres";
  /** Acting user inside a request or job. Null on the shared store. */
  readonly scopeUserId: string | null;
  forUser(userId: string): Store;
  readonly accounts: AccountRepository;
  readonly secrets: SecretRepository;
  readonly prefs: PrefsRepository;
  readonly globalProfiles: ProfileRepository;
  readonly agents: AgentRepository;
  readonly chats: ChatRepository;
  readonly messages: MessageRepository;
  readonly sessions: SessionRepository;
  readonly profiles: ProfileRepository;
  readonly agentMessages: AgentMessageRepository;
  readonly memories: MemoryRepository;
  readonly roles: RoleRepository;
  readonly routines: RoutineRepository;
  readonly routineRuns: RoutineRunRepository;
  readonly listeners: ListenerRepository;
  readonly listenerDeliveries: ListenerDeliveryRepository;
  readonly notifications: NotificationRepository;
  /**
   * Instance-admin settings for background work.
   * One value per deployment today. Becomes admin-only when accounts land.
   */
  readonly alwaysOnSettings: AlwaysOnSettingsRepository;
  /** Release the backing pool. Memory stores resolve immediately. */
  close(): Promise<void>;
}

/** @deprecated Accounts replaced the single operator. Prefer {@link AuthUser}. */
export interface Operator {
  id: string;
}

export type { AuthUser };
