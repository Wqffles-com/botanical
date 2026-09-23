import {
  BotanicalClient,
  isAbortError,
  isUnauthorized,
  type ChatMessage,
  type CreateAgentInput,
  type TokenUsage,
  type ToolCall,
} from "@botanical/core";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { apiBase } from "../apiBase";
import { errorText } from "../errorText";
import { clearSession, loadSession, saveSession } from "../session";
import { mergeServerMessages } from "./merge";
import { initialAppState, reducer, type AppState } from "./model";

export function useChatApp() {
  const [state, dispatch] = useReducer(reducer, initialAppState);
  const tokenRef = useRef<string | null>(loadSession()?.token ?? null);
  const clientRef = useRef<BotanicalClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const client = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new BotanicalClient({
        baseUrl: apiBase(),
        getToken: () => tokenRef.current,
      });
    }
    return clientRef.current;
  }, []);

  const failAuth = useCallback((error: unknown): boolean => {
    if (!isUnauthorized(error)) return false;
    tokenRef.current = null;
    clearSession();
    dispatch({ type: "logout" });
    return true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      const api = client();
      let mode = stateRef.current.mode;
      let healthError: string | null = null;
      try {
        const health = await api.health();
        mode = health.mode ?? mode;
        if (!health.ok) healthError = "Botanical server reported a problem.";
      } catch (error) {
        if (isAbortError(error)) return;
        healthError = errorText(error);
      }
      if (cancelled || controller.signal.aborted) return;
      try {
        const me = await api.me();
        const [agents, profiles, chats] = await Promise.all([api.listAgents(), api.listProfiles(), api.listChats()]);
        if (cancelled || controller.signal.aborted) return;
        dispatch({ type: "boot-ready", mode: me.mode ?? mode, agents, profiles, chats });
      } catch (error) {
        if (cancelled || controller.signal.aborted || isAbortError(error)) return;
        if (isUnauthorized(error)) {
          tokenRef.current = null;
          clearSession();
          dispatch({ type: "boot-anonymous", mode, error: null });
          return;
        }
        dispatch({ type: "boot-anonymous", mode, error: healthError ?? errorText(error) });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, [state.activeChatId]);

  async function login(password: string) {
    dispatch({ type: "busy", busy: "login" });
    try {
      const session = await client().login(password);
      if (session.token) {
        tokenRef.current = session.token;
        saveSession({ token: session.token, expiresAt: session.expiresAt });
      } else {
        tokenRef.current = null;
        clearSession();
      }
      const me = await client().me();
      const [agents, profiles, chats] = await Promise.all([
        client().listAgents(),
        client().listProfiles(),
        client().listChats(),
      ]);
      dispatch({
        type: "boot-ready",
        mode: me.mode ?? session.mode ?? stateRef.current.mode,
        agents,
        profiles,
        chats,
      });
    } catch (error) {
      dispatch({ type: "error", error: errorText(error) });
    }
  }

  async function logout() {
    abortRef.current?.abort();
    tokenRef.current = null;
    clearSession();
    dispatch({ type: "logout" });
    try {
      await client().logout();
    } catch {
      // The local session is already gone. A failed logout still leaves the passcode screen.
    }
  }

  async function refresh() {
    dispatch({ type: "busy", busy: "refresh" });
    try {
      const [agents, profiles, chats] = await Promise.all([
        client().listAgents(),
        client().listProfiles(),
        client().listChats(),
      ]);
      dispatch({ type: "replace-lists", agents, profiles, chats });
    } catch (error) {
      if (failAuth(error)) return;
      dispatch({ type: "error", error: errorText(error) });
    }
  }

  function openDraft() {
    if (!stateRef.current.draft) dispatch({ type: "open-draft" });
  }

  function cancelDraft() {
    dispatch({ type: "cancel-draft" });
  }

  function setDraftAgent(agentId: string) {
    dispatch({ type: "draft-agent", agentId });
  }

  function setDraftProfile(profileId: string | null) {
    dispatch({ type: "draft-profile", profileId });
  }

  function setDraftTitle(title: string) {
    dispatch({ type: "draft-title", title });
  }

  async function createAgent(input: CreateAgentInput): Promise<boolean> {
    dispatch({ type: "busy", busy: "agent" });
    try {
      const agent = await client().createAgent(input);
      dispatch({ type: "agent-created", agent });
      return true;
    } catch (error) {
      if (!failAuth(error)) dispatch({ type: "error", error: errorText(error) });
      return false;
    }
  }

  async function createChat() {
    const draft = stateRef.current.draft;
    if (!draft?.agentId || !draft.profileId) {
      dispatch({
        type: "error",
        error: draft?.agentId ? "Choose a model profile for this chat." : "Choose one agent for this chat.",
      });
      return;
    }
    if (stateRef.current.busy === "create") return;
    abortRef.current?.abort();
    dispatch({ type: "busy", busy: "create" });
    try {
      const chat = await client().createChat({
        agentId: draft.agentId,
        profileId: draft.profileId,
        title: draft.title,
      });
      dispatch({ type: "chat-created", chat, profileId: draft.profileId });
    } catch (error) {
      if (!failAuth(error)) dispatch({ type: "error", error: errorText(error) });
    }
  }

  async function openChat(chatId: string) {
    abortRef.current?.abort();
    dispatch({ type: "busy", busy: "refresh" });
    dispatch({ type: "cancel-draft" });
    try {
      const messages = await client().listMessages(chatId);
      dispatch({ type: "chat-opened", chatId, messages });
    } catch (error) {
      if (!failAuth(error)) dispatch({ type: "error", error: errorText(error) });
    }
  }

  async function setProfile(chatId: string, profileId: string | null) {
    dispatch({ type: "select-profile", chatId, profileId });
    if (!profileId) return;
    try {
      await client().updateChat(chatId, { profileId });
    } catch (error) {
      if (failAuth(error)) return;
      // The next message still carries this explicit profileId.
    }
  }

  async function send(content: string): Promise<boolean> {
    const snapshot = stateRef.current;
    const chatId = snapshot.activeChatId;
    const profileId = chatId ? (snapshot.profileByChat[chatId] ?? null) : null;
    if (!chatId) return false;
    if (!profileId) {
      dispatch({ type: "error", error: "Choose a model profile for this chat." });
      return false;
    }
    const trimmed = content.trim();
    if (!trimmed || snapshot.streaming || snapshot.busy === "send") return false;

    const prior = snapshot.messages;
    const userMessage: ChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      chatId,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "local-message", message: userMessage });
    dispatch({ type: "stream-start", chatId });

    const ac = new AbortController();
    abortRef.current = ac;
    let text = "";
    let toolCalls: ToolCall[] = [];
    let usage: TokenUsage | null = null;
    let messageId = "";
    let sawEvent = false;
    try {
      for await (const event of client().streamMessage(chatId, { content: trimmed, profileId }, { signal: ac.signal })) {
        sawEvent = true;
        if (event.type === "message-start" && event.role !== "user" && event.messageId) messageId = event.messageId;
        if (event.type === "text-delta") {
          text += event.text;
          dispatch({ type: "stream-delta", text: event.text });
        }
        if (event.type === "tool-call") {
          const call = { id: event.id, name: event.name, arguments: event.arguments };
          toolCalls = upsertTool(toolCalls, call);
          dispatch({ type: "stream-tool", toolCall: call });
        }
        if (event.type === "usage") {
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          dispatch({ type: "stream-usage", usage });
        }
        if (event.type === "error") {
          dispatch({
            type: "stream-fail",
            error: event.error,
            partial: assistantMessage(messageId, chatId, text, toolCalls, usage),
          });
          return true;
        }
        if (event.type === "done" && event.messageId) messageId = event.messageId;
      }
      const assistant = assistantMessage(messageId, chatId, text, toolCalls, usage);
      dispatch({ type: "stream-commit", message: assistant });
      try {
        const [serverMessages, chats] = await Promise.all([client().listMessages(chatId), client().listChats()]);
        dispatch({
          type: "replace-messages",
          chatId,
          messages: mergeServerMessages([...prior, userMessage, assistant], serverMessages, trimmed, assistant),
        });
        dispatch({
          type: "replace-lists",
          agents: stateRef.current.agents,
          profiles: stateRef.current.profiles,
          chats,
        });
      } catch (error) {
        if (failAuth(error)) return true;
      }
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        const partial = text || toolCalls.length ? assistantMessage(messageId, chatId, text, toolCalls, usage) : null;
        if (partial) dispatch({ type: "stream-commit", message: partial });
        else dispatch({ type: "stream-clear" });
        return sawEvent;
      }
      if (!sawEvent) dispatch({ type: "drop-message", id: userMessage.id });
      if (!failAuth(error)) {
        dispatch({
          type: "stream-fail",
          error: errorText(error),
          partial: sawEvent ? assistantMessage(messageId, chatId, text, toolCalls, usage) : null,
        });
      }
      return sawEvent;
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return {
    state,
    login,
    logout,
    refresh,
    openDraft,
    cancelDraft,
    setDraftAgent,
    setDraftProfile,
    setDraftTitle,
    createAgent,
    createChat,
    openChat,
    setProfile,
    send,
    stop,
  };
}

function assistantMessage(
  messageId: string,
  chatId: string,
  text: string,
  toolCalls: ToolCall[],
  usage: TokenUsage | null,
): ChatMessage {
  return {
    id: messageId || `local-assistant-${crypto.randomUUID()}`,
    chatId,
    role: "assistant",
    content: text,
    createdAt: new Date().toISOString(),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
  };
}

function upsertTool(calls: ToolCall[], next: ToolCall): ToolCall[] {
  const index = calls.findIndex((call) => call.id === next.id && next.id !== "");
  if (index === -1) return [...calls, next];
  return calls.map((call, i) => (i === index ? next : call));
}

export type ChatApp = ReturnType<typeof useChatApp>;
export type { AppState };
