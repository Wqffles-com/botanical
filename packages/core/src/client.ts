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
  Chat,
  ChatMessage,
  ChatStreamEvent,
  CreateAgentInput,
  CreateChatInput,
  Health,
  LoginResult,
  Me,
  ModelProfile,
  SendMessageInput,
  UpdateAgentInput,
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
    const name = input.name.trim();
    const systemPrompt = input.systemPrompt?.trim() ?? "";
    if (!name) throw new BotanicalApiError("Name the agent before saving it.", { status: 400 });
    if (!systemPrompt) throw new BotanicalApiError("Write a prompt for the agent.", { status: 400 });
    const body = await this.requestJson(API.agents, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: input.description?.trim() ?? "",
        systemPrompt,
        toolIds: input.toolIds ?? [],
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.defaultProfileId !== undefined ? { defaultProfileId: input.defaultProfileId } : {}),
      }),
    });
    return normalizeAgent(body);
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const body = await this.requestJson(API.agent(id), {
      method: "PATCH",
      body: JSON.stringify(input),
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
    yield* readChatStream(response.body, contentType);
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
