import type { ChatMessage } from "@botanical/core";

export interface ChatDetails {
  messages: number;
  user: number;
  assistant: number;
  /** Tool calls the agents made (not tool result rows). */
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * Tokens the model saw on the latest reply that reports usage: its prompt
   * plus its own output. Null when no reply carries usage (CLI profiles).
   */
  contextTokens: number | null;
  /** Characters of visible text in the transcript. */
  characters: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function chatDetails(messages: readonly ChatMessage[]): ChatDetails {
  const details: ChatDetails = {
    messages: 0,
    user: 0,
    assistant: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    contextTokens: null,
    characters: 0,
    firstAt: null,
    lastAt: null,
  };
  for (const message of messages) {
    if (message.role === "user") details.user += 1;
    if (message.role === "assistant") details.assistant += 1;
    if (message.role !== "tool") {
      details.messages += 1;
      details.characters += message.content.length;
    }
    details.toolCalls += message.toolCalls?.length ?? 0;
    if (message.usage) {
      details.inputTokens += message.usage.inputTokens;
      details.outputTokens += message.usage.outputTokens;
      details.contextTokens = message.usage.inputTokens + message.usage.outputTokens;
    }
    if (message.createdAt) {
      if (!details.firstAt) details.firstAt = message.createdAt;
      details.lastAt = message.createdAt;
    }
  }
  return details;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Parent of a workspace path. `.` is the root and has no parent. */
export function parentPath(path: string): string | null {
  if (path === "." || path === "") return null;
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "." : path.slice(0, cut);
}
