import type { Agent, Chat, ChatMessage, DeploymentMode, ModelProfile, TokenUsage, ToolCall } from "@botanical/core";

export type AppStatus = "booting" | "anonymous" | "ready";
export type Busy = null | "login" | "create" | "send" | "agent" | "refresh";

export interface NewChatDraft {
  agentId: string | null;
  profileId: string | null;
  title: string;
}

export interface StreamingState {
  chatId: string;
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage | null;
  error: string | null;
}

export interface AppState {
  status: AppStatus;
  mode: DeploymentMode | null;
  agents: Agent[];
  profiles: ModelProfile[];
  chats: Chat[];
  activeChatId: string | null;
  messages: ChatMessage[];
  draft: NewChatDraft | null;
  /** Explicit profile picks. Never filled from another chat or from profiles[0]. */
  profileByChat: Record<string, string>;
  streaming: StreamingState | null;
  error: string | null;
  busy: Busy;
}

export const initialAppState: AppState = {
  status: "booting",
  mode: null,
  agents: [],
  profiles: [],
  chats: [],
  activeChatId: null,
  messages: [],
  draft: null,
  profileByChat: {},
  streaming: null,
  error: null,
  busy: null,
};

export type Action =
  | { type: "boot-anonymous"; mode: DeploymentMode | null; error: string | null }
  | { type: "boot-ready"; mode: DeploymentMode | null; agents: Agent[]; profiles: ModelProfile[]; chats: Chat[] }
  | { type: "busy"; busy: Busy }
  | { type: "error"; error: string | null }
  | { type: "logout" }
  | { type: "replace-lists"; agents: Agent[]; profiles: ModelProfile[]; chats: Chat[] }
  | { type: "open-draft" }
  | { type: "cancel-draft" }
  | { type: "draft-agent"; agentId: string }
  | { type: "draft-profile"; profileId: string | null }
  | { type: "draft-title"; title: string }
  | { type: "agent-created"; agent: Agent }
  | { type: "chat-created"; chat: Chat; profileId: string }
  | { type: "chat-opened"; chatId: string; messages: ChatMessage[] }
  | { type: "select-profile"; chatId: string; profileId: string | null }
  | { type: "local-message"; message: ChatMessage }
  | { type: "drop-message"; id: string }
  | { type: "stream-start"; chatId: string }
  | { type: "stream-delta"; text: string }
  | { type: "stream-tool"; toolCall: ToolCall }
  | { type: "stream-usage"; usage: TokenUsage }
  | { type: "stream-fail"; error: string; partial: ChatMessage | null }
  | { type: "stream-clear" }
  | { type: "stream-commit"; message: ChatMessage }
  | { type: "replace-messages"; chatId: string; messages: ChatMessage[] };

const emptyDraft = (): NewChatDraft => ({ agentId: null, profileId: null, title: "" });

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "boot-anonymous":
      return { ...initialAppState, status: "anonymous", mode: action.mode, error: action.error };
    case "boot-ready":
      return {
        ...state,
        status: "ready",
        mode: action.mode ?? state.mode,
        agents: sortAgents(action.agents),
        profiles: action.profiles,
        chats: sortChats(action.chats),
        profileByChat: seedProfiles(state.profileByChat, action.chats),
        error: null,
        busy: null,
      };
    case "busy":
      return { ...state, busy: action.busy };
    case "error":
      return { ...state, error: action.error, busy: state.streaming ? state.busy : null };
    case "logout":
      return { ...initialAppState, status: "anonymous" };
    case "replace-lists": {
      const activeStillThere = action.chats.some((chat) => chat.id === state.activeChatId);
      return {
        ...state,
        agents: sortAgents(action.agents),
        profiles: action.profiles,
        chats: sortChats(action.chats),
        profileByChat: seedProfiles(state.profileByChat, action.chats),
        activeChatId: activeStillThere ? state.activeChatId : null,
        messages: activeStillThere ? state.messages : [],
        busy: null,
      };
    }
    case "open-draft":
      return { ...state, draft: emptyDraft(), error: null };
    case "cancel-draft":
      return { ...state, draft: null, error: null };
    case "draft-agent":
      if (!state.draft) return state;
      return { ...state, error: null, draft: { ...state.draft, agentId: action.agentId } };
    case "draft-profile":
      if (!state.draft) return state;
      return { ...state, error: null, draft: { ...state.draft, profileId: action.profileId } };
    case "draft-title":
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, title: action.title } };
    case "agent-created":
      return {
        ...state,
        agents: sortAgents([action.agent, ...state.agents.filter((agent) => agent.id !== action.agent.id)]),
        draft: state.draft ? { ...state.draft, agentId: action.agent.id } : state.draft,
        busy: null,
        error: null,
      };
    case "chat-created": {
      const chat: Chat = { ...action.chat, profileId: action.chat.profileId ?? action.profileId };
      return {
        ...state,
        chats: sortChats([chat, ...state.chats.filter((item) => item.id !== chat.id)]),
        activeChatId: chat.id,
        messages: [],
        draft: null,
        busy: null,
        error: null,
        streaming: null,
        profileByChat: { ...state.profileByChat, [chat.id]: action.profileId },
      };
    }
    case "chat-opened": {
      const chat = state.chats.find((item) => item.id === action.chatId);
      const profileByChat = { ...state.profileByChat };
      if (chat?.profileId && !profileByChat[action.chatId]) profileByChat[action.chatId] = chat.profileId;
      return {
        ...state,
        activeChatId: action.chatId,
        messages: action.messages,
        draft: null,
        streaming: null,
        busy: null,
        error: null,
        profileByChat,
      };
    }
    case "select-profile": {
      if (!action.profileId) {
        const profileByChat = { ...state.profileByChat };
        delete profileByChat[action.chatId];
        return {
          ...state,
          profileByChat,
          chats: state.chats.map((chat) => (chat.id === action.chatId ? { ...chat, profileId: null } : chat)),
          error: null,
        };
      }
      return {
        ...state,
        profileByChat: { ...state.profileByChat, [action.chatId]: action.profileId },
        chats: state.chats.map((chat) =>
          chat.id === action.chatId ? { ...chat, profileId: action.profileId } : chat,
        ),
        error: null,
      };
    }
    case "local-message":
      if (state.activeChatId !== action.message.chatId) return state;
      return { ...state, messages: [...state.messages, action.message] };
    case "drop-message":
      return { ...state, messages: state.messages.filter((message) => message.id !== action.id) };
    case "stream-start":
      return {
        ...state,
        busy: "send",
        error: null,
        streaming: { chatId: action.chatId, text: "", toolCalls: [], usage: null, error: null },
      };
    case "stream-delta":
      if (!state.streaming) return state;
      return { ...state, streaming: { ...state.streaming, text: state.streaming.text + action.text } };
    case "stream-tool": {
      if (!state.streaming) return state;
      const existing = state.streaming.toolCalls.findIndex((call) => call.id === action.toolCall.id);
      const toolCalls =
        existing === -1
          ? [...state.streaming.toolCalls, action.toolCall]
          : state.streaming.toolCalls.map((call, index) => (index === existing ? action.toolCall : call));
      return { ...state, streaming: { ...state.streaming, toolCalls } };
    }
    case "stream-usage":
      if (!state.streaming) return state;
      return { ...state, streaming: { ...state.streaming, usage: action.usage } };
    case "stream-fail":
      return {
        ...state,
        streaming: null,
        busy: null,
        error: action.error,
        messages:
          action.partial && state.activeChatId === action.partial.chatId
            ? [...state.messages, action.partial]
            : state.messages,
      };
    case "stream-clear":
      return { ...state, streaming: null, busy: null };
    case "stream-commit":
      if (state.activeChatId !== action.message.chatId) {
        return { ...state, streaming: null, busy: null };
      }
      return { ...state, streaming: null, busy: null, messages: [...state.messages, action.message] };
    case "replace-messages":
      if (state.activeChatId !== action.chatId) return state;
      return { ...state, messages: action.messages };
    default:
      return state;
  }
}

export function canStartChat(draft: NewChatDraft | null): boolean {
  return Boolean(draft?.agentId?.trim() && draft.profileId?.trim());
}

export function profileForChat(state: AppState, chatId: string | null = state.activeChatId): string | null {
  if (!chatId) return null;
  return state.profileByChat[chatId] ?? null;
}

export function canSend(state: AppState, chatId: string | null = state.activeChatId): boolean {
  return Boolean(profileForChat(state, chatId)) && state.streaming === null && state.busy !== "send";
}

export function seedProfiles(current: Record<string, string>, chats: Chat[]): Record<string, string> {
  const next = { ...current };
  for (const chat of chats) {
    if (chat.profileId && !next[chat.id]) next[chat.id] = chat.profileId;
  }
  return next;
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => stamp(b) - stamp(a) || a.title.localeCompare(b.title));
}

export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function stamp(value: { updatedAt?: string; createdAt?: string }): number {
  const raw = value.updatedAt || value.createdAt || "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}
