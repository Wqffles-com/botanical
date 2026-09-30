import { ValidationError } from "./errors";
import type { MessageRecord } from "./message";
import type { MessageRepository } from "./store";
import type { ToolResult, ToolSource } from "./tools";

/** The tool an agent calls to write to the user. Its text output is only a note beside the chat. */
export const SEND_MESSAGE_TOOL = "send_message";

/** `name` of the assistant row a `send_message` call stores. */
export const SENT_MESSAGE_NAME = "send_message";

export const SEND_MESSAGE_MAX = 100_000;

const MESSAGE_SOURCE_ID = "chat";

/** The fields `replyIds` reads. Server rows may carry `agentId: null`. */
export interface ReplyCandidate {
  id: string;
  role: MessageRecord["role"];
  content: string;
  name?: string | null;
  agentId?: string | null;
}

export function isSentMessage(record: Pick<ReplyCandidate, "role" | "name">): boolean {
  return record.role === "assistant" && record.name === SENT_MESSAGE_NAME;
}

/**
 * The rows the user reads as replies. Each agent's replies to a user message are the messages it
 * sent with `send_message`. An agent that sent none in that round (older chats, or a model that
 * ignored the tool) is read by its text output instead, as before. The web thread applies the
 * same rule (`packages/web/src/lib/chat-stream.ts`). Change both together.
 */
export function replyIds(records: readonly ReplyCandidate[], ownerId: string): Set<string> {
  const ids = new Set<string>();
  let round: ReplyCandidate[] = [];
  const close = () => {
    const sent = new Set<string>();
    for (const record of round) if (isSentMessage(record)) sent.add(record.agentId ?? ownerId);
    for (const record of round) {
      if (record.role !== "assistant" || !record.content.trim()) continue;
      const author = record.agentId ?? ownerId;
      if (isSentMessage(record) || (!record.name && !sent.has(author))) ids.add(record.id);
    }
    round = [];
  };
  for (const record of records) {
    if (record.role === "user") close();
    else round.push(record);
  }
  close();
  return ids;
}

/**
 * `send_message`: every agent has it, whatever its allowlist, roles, or A2A setting. The message
 * is stored as its own assistant row the moment the tool runs, so the chat shows it mid-turn.
 */
export function createMessageToolSource(messages: MessageRepository): ToolSource {
  return {
    id: MESSAGE_SOURCE_ID,
    async listTools() {
      return [
        {
          name: SEND_MESSAGE_TOOL,
          description:
            "Send a message to the user in the chat. This is the only way the user reads what you write: your text output is hidden from them. Call it as often as you need in one turn, for example to say what you are starting on and later to share the result.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string", description: "The message, in Markdown." },
            },
            required: ["text"],
          },
          origin: "runtime" as const,
        },
      ];
    },
    async call(name, args, ctx): Promise<ToolResult> {
      if (name !== SEND_MESSAGE_TOOL) {
        return { output: { error: `Unknown chat tool "${name}"` }, isError: true };
      }
      const record = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!text) return { output: { error: "text is required" }, isError: true };
      if (text.length > SEND_MESSAGE_MAX) {
        return { output: { error: `text must be at most ${SEND_MESSAGE_MAX} characters` }, isError: true };
      }
      try {
        const row = await messages.append({
          chatId: ctx.chatId,
          role: "assistant",
          name: SENT_MESSAGE_NAME,
          content: text,
          agentId: ctx.agentId,
        });
        return { output: { messageId: row.id, delivered: true } };
      } catch (error) {
        if (error instanceof ValidationError) return { output: { error: error.message }, isError: true };
        throw error;
      }
    },
  };
}

/** The tool sources a turn runs with: `send_message` first, then the server's. */
export function withMessageTool(sources: readonly ToolSource[], messages: MessageRepository): ToolSource[] {
  if (sources.some((source) => source.id === MESSAGE_SOURCE_ID)) return [...sources];
  return [createMessageToolSource(messages), ...sources];
}
