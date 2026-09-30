import { replyIds, SENT_MESSAGE_NAME, type ChatMessage } from "@botanical/core";

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

/** One step of an agent's working notes: its text output and the tools it called. */
export interface ActivityStep {
  key: string;
  message: ChatMessage;
  tools: UiToolCall[];
}

/**
 * A row of the thread. `message` is a reply, a user message, or a system row, with its tool calls.
 * `activity` is an agent's working notes between replies, folded into one collapsed block;
 * `message` is then its first step, for the author.
 */
export interface ThreadEntry {
  key: string;
  message: ChatMessage;
  tools: UiToolCall[];
  kind: "message" | "activity";
  steps?: ActivityStep[];
}

/**
 * Pair each assistant tool call with its `role: "tool"` result and drop the standalone row. Replies
 * (`replyIds`) stay messages. The rest of what an agent wrote folds into activity blocks, one per
 * run of notes from the same agent. `send_message` calls are left out: their message is its own row.
 */
export function presentThread(messages: ChatMessage[], ownerId = ""): ThreadEntry[] {
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
  const replies = replyIds(messages, ownerId);
  const entries: ThreadEntry[] = [];
  const note = (step: ActivityStep) => {
    const author = step.message.agentId ?? ownerId;
    const last = entries.at(-1);
    if (last?.kind === "activity" && (last.message.agentId ?? ownerId) === author) {
      last.steps?.push(step);
      last.tools.push(...step.tools);
      return;
    }
    entries.push({ key: `activity-${step.key}`, message: step.message, tools: [...step.tools], kind: "activity", steps: [step] });
  };
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId && linked.has(message.toolCallId)) continue;
    if (message.role === "tool") {
      if (message.name === SENT_MESSAGE_NAME) continue;
      note({
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
    const tools: UiToolCall[] = (message.toolCalls ?? [])
      .filter((call) => call.name !== SENT_MESSAGE_NAME)
      .map((call) => {
        const result = results.get(call.id);
        return {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          ...(result ? { result: result.content } : {}),
          status: result ? toolResultStatus(result.content) : "done",
        };
      });
    if (message.role === "assistant" && !replies.has(message.id)) {
      if (message.content.trim() || tools.length > 0) note({ key: message.id, message, tools });
      continue;
    }
    entries.push({ key: message.id, message, tools, kind: "message" });
  }
  return entries;
}
