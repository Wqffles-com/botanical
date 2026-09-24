import {
  AGENT_COLORS,
  AGENT_NAME_MAX,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  isAgentColor,
  isAgentIcon,
  type AgentColor,
} from "./agents";
import {
  BotanicalApiError,
  errorMessage,
  requireAgentId,
  requireProfileId,
  safeJson,
} from "./errors";
import {
  eventsFromFinalMessage,
  normalizeAgent,
  normalizeAgentMessage,
  normalizeChat,
  normalizeHealth,
  normalizeLogin,
  normalizeMe,
  normalizeMessage,
  normalizeProfile,
  unwrapList,
} from "./normalize";
import { API } from "./paths";
import { readChatStream } from "./sse";
import type {
  Agent,
  AgentMessage,
  Chat,
  ChatMessage,
  ChatStreamEvent,
  CreateAgentInput,
  CreateChatInput,
  Health,
  LoginResult,
  Me,
  ModelProfile,
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

  async login(password: string): Promise<LoginResult> {
    const passcode = password.trim();
    if (!passcode) {
      throw new BotanicalApiError("Enter the server passcode.", { status: 400 });
    }
    const body = await this.requestJson(API.login, {
      method: "POST",
      body: JSON.stringify({ password: passcode }),
    });
    return normalizeLogin(body);
  }

  async logout(): Promise<void> {
    await this.requestJson(API.logout, { method: "POST", body: "{}" });
  }

  me(): Promise<Me> {
    return this.requestJson(API.me).then(normalizeMe);
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
        icon: readAgentIcon(input.icon),
        color: readAgentColor(input.color),
        description: input.description?.trim() ?? "",
        prompt: systemPrompt,
        systemPrompt,
        tools: toolIds,
        toolIds,
        defaultProfileId: readDefaultProfileId(input.defaultProfileId),
      }),
    });
    return normalizeAgent(body);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = readAgentName(input.name);
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.icon !== undefined) patch.icon = readAgentIcon(input.icon);
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
    const body = await this.requestJson(API.agent(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return normalizeAgent(body);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.requestJson(API.agent(id), { method: "DELETE" });
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

function readDefaultProfileId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (!text) throw new BotanicalApiError("defaultProfileId must be a profile id or null.", { status: 400 });
  return text;
}
