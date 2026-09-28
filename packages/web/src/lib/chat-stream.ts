import type { ChatMessage } from "@botanical/core";

export type ToolCallStatus = "running" | "done" | "error";

export interface UiToolCall {
  id: string;
  name: string;
  arguments: unknown;
  result?: string;
  status: ToolCallStatus;
}

export function toolCallsFromMessage(message: ChatMessage): UiToolCall[] {
  return (message.toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    status: "done" as const,
  }));
}

export function toolResultStatus(content: string, isError = false): ToolCallStatus {
  if (isError || toolResultFailed(content)) return "error";
  return "done";
}

export function toolResultFailed(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (/^permission denied\b/i.test(text)) return true;
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    if (record.isError === true || record.ok === false) return true;
    return typeof record.error === "string" && record.error.trim().length > 0 && Object.keys(record).length <= 2;
  } catch {
    return false;
  }
}

export interface ThreadEntry {
  key: string;
  message: ChatMessage;
  tools: UiToolCall[];
}

/** Pair each assistant tool call with its `role: "tool"` result and drop the standalone row. */
export function presentThread(messages: ChatMessage[]): ThreadEntry[] {
  const results = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) results.set(message.toolCallId, message);
  }
  const linked = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (results.has(call.id)) linked.add(call.id);
    }
  }
  const entries: ThreadEntry[] = [];
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId && linked.has(message.toolCallId)) continue;
    if (message.role === "tool") {
      entries.push({
        key: message.id,
        message: { ...message, role: "assistant", content: "" },
        tools: [
          {
            id: message.toolCallId || message.id,
            name: message.name || "tool",
            arguments: {},
            result: message.content,
            status: toolResultStatus(message.content),
          },
        ],
      });
      continue;
    }
    const tools: UiToolCall[] = (message.toolCalls ?? []).map((call) => {
      const result = results.get(call.id);
      return {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        ...(result ? { result: result.content } : {}),
        status: result ? toolResultStatus(result.content) : "done",
      };
    });
    entries.push({ key: message.id, message, tools });
  }
  return entries;
}
