import type { ChatMessage, ChatStreamEvent, TokenUsage, ToolCall } from "@botanical/core";

export type ToolCallStatus = "running" | "done" | "error";

export interface UiToolCall {
  id: string;
  name: string;
  arguments: unknown;
  result?: string;
  status: ToolCallStatus;
}

export interface StreamDraft {
  id: string;
  chatId: string;
  role: "assistant";
  content: string;
  toolCalls: UiToolCall[];
  usage: TokenUsage | null;
  createdAt: string;
}

export function emptyDraft(chatId: string): StreamDraft {
  return {
    id: "",
    chatId,
    role: "assistant",
    content: "",
    toolCalls: [],
    usage: null,
    createdAt: new Date().toISOString(),
  };
}

export function applyStreamEvent(draft: StreamDraft, event: ChatStreamEvent): StreamDraft {
  switch (event.type) {
    case "message-start":
      if (event.role === "user") return draft;
      return event.messageId ? { ...draft, id: event.messageId } : draft;
    case "text-delta":
      return { ...draft, content: draft.content + event.text };
    case "tool-call":
      return {
        ...draft,
        toolCalls: upsertToolCall(draft.toolCalls, {
          id: event.id,
          name: event.name,
          arguments: event.arguments,
          status: "running",
        }),
      };
    case "tool-result":
      return { ...draft, toolCalls: applyToolResult(draft.toolCalls, event.id, event.content) };
    case "usage":
      return { ...draft, usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens } };
    case "done":
      return event.messageId ? { ...draft, id: event.messageId } : draft;
    default:
      return draft;
  }
}

export function draftToMessage(draft: StreamDraft): ChatMessage {
  const toolCalls: ToolCall[] = draft.toolCalls.map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
  }));
  return {
    id: draft.id || `local-assistant-${crypto.randomUUID()}`,
    chatId: draft.chatId,
    role: "assistant",
    content: draft.content,
    createdAt: draft.createdAt,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(draft.usage ? { usage: draft.usage } : {}),
  };
}

export function toolCallsFromMessage(message: ChatMessage): UiToolCall[] {
  return (message.toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    status: "done" as const,
  }));
}

function upsertToolCall(calls: UiToolCall[], next: UiToolCall): UiToolCall[] {
  const index = calls.findIndex((call) => call.id === next.id && next.id !== "");
  if (index === -1) return [...calls, next];
  return calls.map((call, i) => (i === index ? { ...call, ...next } : call));
}

function applyToolResult(calls: UiToolCall[], id: string, content: string): UiToolCall[] {
  const index = calls.findIndex((call) => call.id === id && id !== "");
  if (index === -1) {
    return [...calls, { id, name: "tool", arguments: {}, result: content, status: "done" }];
  }
  return calls.map((call, i) => (i === index ? { ...call, result: content, status: "done" } : call));
}
