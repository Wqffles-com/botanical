import {
  AGENT_COLORS,
  AGENT_NAME_MAX,
  AGENT_SHAPES,
  AGENT_TITLE_MAX,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  isAgentColor,
  isAgentIcon,
  isAgentPicture,
  isAgentShape,
  type AgentColor,
  type AgentShape,
} from "./agents";
import { ACCENT_COLORS, isAccentColor, type AccentColor } from "./appearance";
import {
  BotanicalApiError,
  errorMessage,
  requireAgentId,
  requireProfileId,
  safeJson,
} from "./errors";
import {
  normalizeDelivery,
  normalizeListener,
  normalizeAlwaysOnSettings,
  normalizeNotification,
  normalizeNotificationPage,
  normalizeRoutine,
  normalizeRoutineRun,
  normalizeSchedulePreview,
} from "./always";
import {
  eventsFromFinalMessage,
  normalizeAgent,
  normalizeAppearance,
  normalizeAgentMessage,
  normalizeChat,
  normalizeMemory,
  normalizeRoleRecord,
  normalizeHealth,
  normalizeLogin,
  normalizeMe,
  normalizeChatEvent,
  normalizeMessage,
  normalizeProfile,
  normalizeQueuedMessage,
  unwrapEntity,
  unwrapList,
} from "./normalize";
import { API } from "./paths";
import { readChatStream, readSseMessages } from "./sse";
import type {
  Agent,
  Appearance,
  AgentMessage,
  AgentRoleRef,
  Chat,
  ChatEvent,
  ChatMessage,
  ChatStreamEvent,
  CreateAgentInput,
  CreateChatInput,
  Health,
  LoginResult,
  Me,
  Listener,
  ListenerCreated,
  ListenerDelivery,
  ListenerInput,
  ListenerPatch,
  MemoryRecord,
  ModelProfile,
  NotificationPage,
  AlwaysOnSettings,
  AppNotification,
  RolePermissions,
  RoleRecord,
  Routine,
  RoutineInput,
  RoutinePatch,
  RoutineRun,
  SchedulePreview,
  QueueMessageInput,
  QueuedMessage,
  SendAgentMessageInput,
  SendMessageInput,
  UpdateAgentInput,
  UpdateAgentMessageInput,
  UpdateChatInput,
} from "./types";

export interface BotanicalClientOptions {
  /** Prefix or absolute origin. The web app defaults this to `/api`. */
  baseUrl?: string;
  getToken?: () => string | null | undefined;
  fetchImpl?: typeof fetch;
}

export class BotanicalClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BotanicalClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.getToken = options.getToken ?? (() => null);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  health(): Promise<Health> {
    return this.requestJson(API.health).then(normalizeHealth);
  }

  async login(input: { email: string; password: string } | string): Promise<LoginResult> {
    const email = typeof input === "string" ? "" : input.email.trim();
    const password = typeof input === "string" ? input.trim() : input.password;
    if (!email) throw new BotanicalApiError("Enter your email.", { status: 400 });
    if (!password) throw new BotanicalApiError("Enter your password.", { status: 400 });
    const body = await this.requestJson(API.login, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return normalizeLogin(body);
  }

  async signup(input: { email: string; password: string; displayName: string; inviteToken?: string }): Promise<LoginResult> {
    const email = input.email.trim();
    const password = input.password;
    const displayName = input.displayName.trim();
    if (!email) throw new BotanicalApiError("Enter your email.", { status: 400 });
    if (!displayName) throw new BotanicalApiError("Enter a display name.", { status: 400 });
    if (password.length < 8) throw new BotanicalApiError("Password must be at least 8 characters.", { status: 400 });
    const body = await this.requestJson("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        displayName,
        ...(input.inviteToken ? { inviteToken: input.inviteToken } : {}),
      }),
    });
    return normalizeLogin(body);
  }

  async logout(): Promise<void> {
    await this.requestJson(API.logout, { method: "POST", body: "{}" });
  }

  me(): Promise<Me> {
    return this.requestJson(API.me).then(normalizeMe);
  }

  getAppearance(): Promise<Appearance> {
    return this.requestJson(API.appearance).then(normalizeAppearance);
  }

  async updateAppearance(accent: AccentColor): Promise<Appearance> {
    if (!isAccentColor(accent)) {
      throw new BotanicalApiError(`Accent must be one of: ${ACCENT_COLORS.join(", ")}.`, { status: 400 });
    }
    const body = await this.requestJson(API.appearance, {
      method: "PATCH",
      body: JSON.stringify({ accent }),
    });
    return normalizeAppearance(body);
  }

  async listProfiles(): Promise<ModelProfile[]> {
    const body = await this.requestJson(API.profiles);
    return unwrapList(body, ["profiles"]).map(normalizeProfile);
  }

  async listAgents(): Promise<Agent[]> {
    const body = await this.requestJson(API.agents);
    return unwrapList(body, ["agents"]).map(normalizeAgent);
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const name = readAgentName(input.name);
    const systemPrompt = readAgentPrompt(input);
    if (!systemPrompt) throw new BotanicalApiError("Write a prompt for the agent.", { status: 400 });
    const toolIds = readAgentTools(input);
    const body = await this.requestJson(API.agents, {
      method: "POST",
      body: JSON.stringify({
        name,
        ...(input.title !== undefined ? { title: readAgentTitle(input.title) } : {}),
        icon: readAgentIcon(input.icon),
        ...(input.shape !== undefined ? { shape: readAgentShape(input.shape) } : {}),
        ...(input.picture !== undefined ? { picture: readAgentPicture(input.picture) } : {}),
        color: readAgentColor(input.color),
        description: input.description?.trim() ?? "",
        prompt: systemPrompt,
        systemPrompt,
        tools: toolIds,
        toolIds,
        defaultProfileId: readDefaultProfileId(input.defaultProfileId),
        ...(input.roleIds ? { roleIds: input.roleIds } : {}),
      }),
    });
    return normalizeAgent(body);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = readAgentName(input.name);
    if (input.title !== undefined) patch.title = readAgentTitle(input.title);
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.icon !== undefined) patch.icon = readAgentIcon(input.icon);
    if (input.shape !== undefined) patch.shape = readAgentShape(input.shape);
    if (input.picture !== undefined) patch.picture = readAgentPicture(input.picture);
    if (input.color !== undefined) patch.color = readAgentColor(input.color);
    if (input.systemPrompt !== undefined || input.prompt !== undefined) {
      const systemPrompt = readAgentPrompt(input);
      patch.prompt = systemPrompt;
      patch.systemPrompt = systemPrompt;
    }
    if (input.toolIds !== undefined || input.tools !== undefined) {
      const toolIds = readAgentTools(input);
      patch.tools = toolIds;
      patch.toolIds = toolIds;
    }
    if (input.defaultProfileId !== undefined) patch.defaultProfileId = readDefaultProfileId(input.defaultProfileId);
    if (input.roleIds !== undefined) patch.roleIds = input.roleIds;
    const body = await this.requestJson(API.agent(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return normalizeAgent(body);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.requestJson(API.agent(id), { method: "DELETE" });
  }

  async listMemories(query: {
    scope?: "shared" | "agent";
    agentId?: string;
    q?: string;
    tag?: string;
    limit?: number;
  } = {}): Promise<MemoryRecord[]> {
    const params = new URLSearchParams();
    if (query.scope) params.set("scope", query.scope);
    if (query.agentId) params.set("agentId", query.agentId);
    if (query.q) params.set("q", query.q);
    if (query.tag) params.set("tag", query.tag);
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const body = await this.requestJson(`${API.memories}${suffix}`);
    return unwrapList(body, ["memories"]).map(normalizeMemory);
  }

  async createMemory(input: {
    scope: "shared" | "agent";
    content: string;
    agentId?: string | null;
    tags?: string[];
  }): Promise<MemoryRecord> {
    const body = await this.requestJson(API.memories, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return normalizeMemory(body);
  }

  async updateMemory(
    id: string,
    patch: { content?: string; tags?: string[] },
  ): Promise<MemoryRecord> {
    const body = await this.requestJson(API.memory(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return normalizeMemory(body);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.requestJson(API.memory(id), { method: "DELETE" });
  }

  async listRoles(): Promise<RoleRecord[]> {
    const body = await this.requestJson(API.roles);
    return unwrapList(body, ["roles"]).map(normalizeRoleRecord);
  }

  async createRole(input: {
    name: string;
    description?: string;
    permissions: RolePermissions;
  }): Promise<RoleRecord> {
    const body = await this.requestJson(API.roles, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return normalizeRoleRecord(body);
  }

  async updateRole(
    id: string,
    patch: { name?: string; description?: string; permissions?: RolePermissions },
  ): Promise<RoleRecord> {
    const body = await this.requestJson(API.role(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return normalizeRoleRecord(body);
  }

  async deleteRole(id: string): Promise<void> {
    await this.requestJson(API.role(id), { method: "DELETE" });
  }

  async getAgentRoles(agentId: string): Promise<{ roleIds: string[]; roles: AgentRoleRef[] }> {
    const body = await this.requestJson(API.agentRoles(agentId));
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const agent = normalizeAgent({
      agent: {
        id: agentId,
        name: "Agent",
        prompt: "",
        roles: record.roles,
        roleIds: record.roleIds,
      },
    });
    return { roleIds: agent.roleIds, roles: agent.roles };
  }

  async setAgentRoles(agentId: string, roleIds: string[]): Promise<{ roleIds: string[] }> {
    const body = await this.requestJson(API.agentRoles(agentId), {
      method: "PUT",
      body: JSON.stringify({ roleIds }),
    });
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return {
      roleIds: Array.isArray(record.roleIds) ? record.roleIds.filter((id): id is string => typeof id === "string") : [],
    };
  }

  async listChats(): Promise<Chat[]> {
    const body = await this.requestJson(API.chats);
    return unwrapList(body, ["chats"]).map(normalizeChat);
  }

  async getChat(id: string): Promise<Chat> {
    const chatId = id.trim();
    if (!chatId) throw new BotanicalApiError("Chat is missing an id.", { status: 400 });
    return normalizeChat(await this.requestJson(API.chat(chatId)));
  }

  async deleteChat(id: string): Promise<void> {
    const chatId = id.trim();
    if (!chatId) throw new BotanicalApiError("Chat is missing an id.", { status: 400 });
    await this.requestJson(API.chat(chatId), { method: "DELETE" });
  }

  async createChat(input: CreateChatInput): Promise<Chat> {
    const agentId = requireAgentId(input.agentId);
    const profileId = requireProfileId(input.profileId);
    const title = input.title?.trim();
    const body = await this.requestJson(API.chats, {
      method: "POST",
      body: JSON.stringify({
        agentId,
        profileId,
        ...(title ? { title } : {}),
      }),
    });
    const chat = normalizeChat(body);
    return {
      ...chat,
      agentId: chat.agentId || agentId,
      profileId: chat.profileId ?? profileId,
      title: chat.title === "Untitled chat" && title ? title : chat.title,
    };
  }

  /**
   * Optional. Servers that only implement the v0 route list may answer 404/405.
   * Callers should keep the explicit profile locally when this returns null.
   */
  async updateChat(id: string, patch: UpdateChatInput): Promise<Chat | null> {
    if (patch.profileId !== undefined) requireProfileId(patch.profileId);
    try {
      const body = await this.requestJson(API.chat(id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (body == null) return null;
      const chat = normalizeChat(body);
      return {
        ...chat,
        profileId: chat.profileId ?? patch.profileId ?? null,
      };
    } catch (error) {
      if (error instanceof BotanicalApiError && (error.status === 404 || error.status === 405 || error.status === 501)) {
        return null;
      }
      throw error;
    }
  }

  async listAgentMessages(agentId: string): Promise<AgentMessage[]> {
    const id = agentId.trim();
    if (!id) throw new BotanicalApiError("Choose an agent.", { status: 400 });
    const body = await this.requestJson(`${API.agentMessages}?agentId=${encodeURIComponent(id)}`);
    return unwrapList(body, ["messages", "agentMessages"]).map(normalizeAgentMessage);
  }

  async sendAgentMessage(input: SendAgentMessageInput): Promise<AgentMessage> {
    const fromAgentId = input.fromAgentId.trim();
    const toAgentId = input.toAgentId.trim();
    const body = input.body.trim();
    if (!fromAgentId || !toAgentId) {
      throw new BotanicalApiError("Choose both agents.", { status: 400 });
    }
    if (!body) throw new BotanicalApiError("Write a message before sending.", { status: 400 });
    const payload = await this.requestJson(API.agentMessages, {
      method: "POST",
      body: JSON.stringify({ fromAgentId, toAgentId, body }),
    });
    return normalizeAgentMessage(payload);
  }

  async updateAgentMessage(id: string, input: UpdateAgentMessageInput): Promise<AgentMessage> {
    const messageId = id.trim();
    if (!messageId) throw new BotanicalApiError("Agent message is missing an id.", { status: 400 });
    const payload = await this.requestJson(API.agentMessage(messageId), {
      method: "PATCH",
      body: JSON.stringify({ status: input.status }),
    });
    return normalizeAgentMessage(payload);
  }

  async listMessages(chatId: string): Promise<ChatMessage[]> {
    const body = await this.requestJson(API.messages(chatId));
    return unwrapList(body, ["messages"]).map(normalizeMessage);
  }

  async *streamMessage(
    chatId: string,
    input: SendMessageInput,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const profileId = requireProfileId(input.profileId);
    const content = input.content.trim();
    if (!content) {
      throw new BotanicalApiError("Write a message before sending.", { status: 400 });
    }
    const response = await this.request(API.messages(chatId), {
      method: "POST",
      body: JSON.stringify({ content, profileId, stream: true }),
      headers: { accept: "text/event-stream, application/x-ndjson, application/json" },
      signal: options.signal,
    });
    const raw = response.ok ? null : await response.text();
    if (!response.ok) {
      const body = raw ? safeJson(raw) : null;
      throw new BotanicalApiError(errorMessage(body, raw ?? "", response.status), {
        status: response.status,
        body,
      });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (isJsonDocument(contentType)) {
      const payload = (await response.json()) as unknown;
      yield* eventsFromFinalMessage(payload);
      return;
    }
    if (!response.body) {
      yield { type: "done" };
      return;
    }
    // Server tsc pulls this file in with Bun's stream types, which disagree with DOM ReadableStream.
    yield* readChatStream(response.body as ReadableStream<Uint8Array>, contentType);
  }

  /**
   * Send without waiting for the reply. The server queues the message and answers
   * everything queued so far in one turn. Replies arrive on `chatEvents`.
   */
  async queueMessage(chatId: string, input: QueueMessageInput): Promise<QueuedMessage> {
    const profileId = requireProfileId(input.profileId);
    const content = input.content.trim();
    if (!content) {
      throw new BotanicalApiError("Write a message before sending.", { status: 400 });
    }
    const body = await this.requestJson(API.messages(chatId), {
      method: "POST",
      body: JSON.stringify({
        content,
        profileId,
        async: true,
        ...(input.clientId ? { clientId: input.clientId } : {}),
      }),
    });
    return normalizeQueuedMessage(body);
  }

  /** Stop the chat's running turn. False when nothing was running. */
  async stopChat(chatId: string): Promise<boolean> {
    const body = await this.requestJson(API.chatStop(chatId), { method: "POST", body: "{}" });
    const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return row.stopped === true;
  }

  /** Live queue status and finished messages for one chat, until `signal` aborts or the server closes. */
  async *chatEvents(chatId: string, options: { signal?: AbortSignal } = {}): AsyncGenerator<ChatEvent> {
    const response = await this.request(API.chatEvents(chatId), {
      headers: { accept: "text/event-stream" },
      signal: options.signal,
    });
    if (!response.ok) {
      const raw = await response.text();
      const body = raw ? safeJson(raw) : null;
      throw new BotanicalApiError(errorMessage(body, raw, response.status), { status: response.status, body });
    }
    if (!response.body) return;
    // Server tsc pulls this file in with Bun's stream types, which disagree with DOM ReadableStream.
    for await (const frame of readSseMessages(response.body as ReadableStream<Uint8Array>)) {
      const event = normalizeChatEvent(frame.event, safeJson(frame.data));
      if (event) yield event;
    }
  }

  async listRoutines(agentId?: string): Promise<Routine[]> {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const body = await this.requestJson(`${API.routines}${query}`);
    return unwrapList(body, ["routines"]).map(normalizeRoutine);
  }

  async createRoutine(input: RoutineInput): Promise<Routine> {
    const body = await this.requestJson(API.routines, { method: "POST", body: JSON.stringify(input) });
    return normalizeRoutine(unwrapEntity(body, ["routine"]));
  }

  async updateRoutine(id: string, input: RoutinePatch): Promise<Routine> {
    const body = await this.requestJson(API.routine(id), { method: "PATCH", body: JSON.stringify(input) });
    return normalizeRoutine(unwrapEntity(body, ["routine"]));
  }

  async deleteRoutine(id: string): Promise<void> {
    await this.requestJson(API.routine(id), { method: "DELETE" });
  }

  async pauseRoutine(id: string): Promise<Routine> {
    const body = await this.requestJson(API.routinePause(id), { method: "POST", body: "{}" });
    return normalizeRoutine(unwrapEntity(body, ["routine"]));
  }

  async resumeRoutine(id: string): Promise<Routine> {
    const body = await this.requestJson(API.routineResume(id), { method: "POST", body: "{}" });
    return normalizeRoutine(unwrapEntity(body, ["routine"]));
  }

  async runRoutine(id: string): Promise<RoutineRun> {
    const body = await this.requestJson(API.routineRun(id), { method: "POST", body: "{}" });
    return normalizeRoutineRun(unwrapEntity(body, ["run"]));
  }

  async listRoutineRuns(id: string, page?: { limit?: number; offset?: number }): Promise<RoutineRun[]> {
    const params = new URLSearchParams();
    if (page?.limit !== undefined) params.set("limit", String(page.limit));
    if (page?.offset !== undefined) params.set("offset", String(page.offset));
    const query = params.toString() ? `?${params.toString()}` : "";
    const body = await this.requestJson(`${API.routineRuns(id)}${query}`);
    return unwrapList(body, ["runs"]).map(normalizeRoutineRun);
  }

  async previewRoutine(cron: string, timezone: string): Promise<SchedulePreview> {
    const body = await this.requestJson(API.routinePreview, {
      method: "POST",
      body: JSON.stringify({ cron, timezone }),
    });
    return normalizeSchedulePreview(body);
  }

  async listListeners(agentId?: string): Promise<Listener[]> {
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    const body = await this.requestJson(`${API.listeners}${query}`);
    return unwrapList(body, ["listeners"]).map(normalizeListener);
  }

  async createListener(input: ListenerInput): Promise<ListenerCreated> {
    const body = await this.requestJson(API.listeners, { method: "POST", body: JSON.stringify(input) });
    const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const secret = typeof row.secret === "string" ? row.secret : "";
    const url = typeof row.url === "string" ? row.url : "";
    return { listener: normalizeListener(unwrapEntity(body, ["listener"])), secret, url };
  }

  async updateListener(id: string, input: ListenerPatch): Promise<Listener> {
    const body = await this.requestJson(API.listener(id), { method: "PATCH", body: JSON.stringify(input) });
    return normalizeListener(unwrapEntity(body, ["listener"]));
  }

  async deleteListener(id: string): Promise<void> {
    await this.requestJson(API.listener(id), { method: "DELETE" });
  }

  async rotateListenerSecret(id: string): Promise<{ secret: string; url: string }> {
    const body = await this.requestJson(API.listenerSecret(id), { method: "POST", body: "{}" });
    const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return {
      secret: typeof row.secret === "string" ? row.secret : "",
      url: typeof row.url === "string" ? row.url : "",
    };
  }

  async listListenerDeliveries(id: string): Promise<ListenerDelivery[]> {
    const body = await this.requestJson(API.listenerDeliveries(id));
    return unwrapList(body, ["deliveries"]).map(normalizeDelivery);
  }

  async getAlwaysOnSettings(): Promise<AlwaysOnSettings> {
    const body = await this.requestJson(API.alwaysOnSettings);
    return normalizeAlwaysOnSettings(unwrapEntity(body, ["settings"]));
  }

  async updateAlwaysOnSettings(patch: Partial<AlwaysOnSettings>): Promise<AlwaysOnSettings> {
    const body = await this.requestJson(API.alwaysOnSettings, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return normalizeAlwaysOnSettings(unwrapEntity(body, ["settings"]));
  }

  async listNotifications(page?: { limit?: number; offset?: number }): Promise<NotificationPage> {
    const params = new URLSearchParams();
    if (page?.limit !== undefined) params.set("limit", String(page.limit));
    if (page?.offset !== undefined) params.set("offset", String(page.offset));
    const query = params.toString() ? `?${params.toString()}` : "";
    const body = await this.requestJson(`${API.notifications}${query}`);
    return normalizeNotificationPage(body);
  }

  async markNotificationRead(id: string): Promise<AppNotification> {
    const body = await this.requestJson(API.notificationRead(id), { method: "POST", body: "{}" });
    return normalizeNotification(unwrapEntity(body, ["notification"]));
  }

  async markAllNotificationsRead(): Promise<number> {
    const body = await this.requestJson(API.notificationsReadAll, { method: "POST", body: "{}" });
    const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return typeof row.updated === "number" ? row.updated : 0;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const token = this.getToken()?.trim();
    if (token) headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", headers.get("accept") ?? "application/json");
    return this.fetchImpl(this.url(path), {
      ...init,
      headers,
      credentials: init.credentials ?? "include",
    });
  }

  private async requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.request(path, init);
    if (response.status === 204) return null;
    const raw = await response.text();
    const body = raw ? safeJson(raw) : null;
    if (!response.ok) {
      throw new BotanicalApiError(errorMessage(body, raw, response.status), {
        status: response.status,
        body,
      });
    }
    return body;
  }
}

function isJsonDocument(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (!ct.includes("application/json")) return false;
  if (ct.includes("ndjson") || ct.includes("jsonl") || ct.includes("stream")) return false;
  return true;
}

function readAgentName(value: string): string {
  const name = value.trim();
  if (!name) throw new BotanicalApiError("Name the agent before saving it.", { status: 400 });
  if (name.length > AGENT_NAME_MAX) {
    throw new BotanicalApiError(`Name the agent in ${AGENT_NAME_MAX} characters or fewer.`, { status: 400 });
  }
  return name;
}

function readAgentPrompt(input: { systemPrompt?: string; prompt?: string }): string {
  const hasSystem = input.systemPrompt !== undefined;
  const hasPrompt = input.prompt !== undefined;
  const systemText = input.systemPrompt?.trim() ?? "";
  const promptText = input.prompt?.trim() ?? "";
  if (hasSystem && hasPrompt && systemText !== promptText) {
    throw new BotanicalApiError("prompt and systemPrompt must match.", { status: 400 });
  }
  return hasSystem ? systemText : promptText;
}

function readAgentTools(input: { toolIds?: string[]; tools?: string[] }): string[] {
  if (input.toolIds !== undefined && input.tools !== undefined) {
    const same =
      input.toolIds.length === input.tools.length && input.toolIds.every((id, index) => id === input.tools?.[index]);
    if (!same) throw new BotanicalApiError("tools and toolIds must match.", { status: 400 });
  }
  return [...(input.toolIds ?? input.tools ?? [])];
}

function readAgentIcon(value: string | undefined): string {
  const icon = value === undefined ? DEFAULT_AGENT_ICON : value.trim();
  if (!isAgentIcon(icon)) {
    throw new BotanicalApiError("Icon must be a Lucide name such as Bot or Sprout.", { status: 400 });
  }
  return icon;
}

function readAgentColor(value: AgentColor | undefined): AgentColor {
  if (value === undefined) return DEFAULT_AGENT_COLOR;
  if (!isAgentColor(value)) {
    throw new BotanicalApiError(`Color must be one of: ${AGENT_COLORS.join(", ")}.`, { status: 400 });
  }
  return value;
}

function readAgentTitle(value: string): string {
  const title = value.trim();
  if (title.length > AGENT_TITLE_MAX) {
    throw new BotanicalApiError(`Title must be ${AGENT_TITLE_MAX} characters or fewer.`, { status: 400 });
  }
  return title;
}

function readAgentShape(value: AgentShape): AgentShape {
  if (!isAgentShape(value)) {
    throw new BotanicalApiError(`Shape must be one of: ${AGENT_SHAPES.join(", ")}.`, { status: 400 });
  }
  return value;
}

function readAgentPicture(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  if (!isAgentPicture(value)) {
    throw new BotanicalApiError("Picture must be a PNG, JPEG, or WebP data URL.", { status: 400 });
  }
  return value;
}

function readDefaultProfileId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (!text) throw new BotanicalApiError("defaultProfileId must be a profile id or null.", { status: 400 });
  return text;
}
