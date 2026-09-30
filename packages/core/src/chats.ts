import type { Chat, ChatMessage } from "./types";

/**
 * One chat per agent: the chat an agent owns with no group members is its own chat, where
 * every conversation with it happens (routine runs, webhook deliveries, and agent mail too).
 * Group chats (members set) are extra threads beside it.
 */
export function isAgentChat(chat: Pick<Chat, "memberIds">): boolean {
  return chat.memberIds.length === 0;
}

/** `name` of the stored summary that stands in for older messages after a compaction. */
export const COMPACTION_MESSAGE_NAME = "compaction";

export function isCompactionMessage(message: Pick<ChatMessage, "role" | "name">): boolean {
  return message.role === "system" && message.name === COMPACTION_MESSAGE_NAME;
}

/** `name` of the assistant row an agent's `send_message` call stores: a message the user reads. */
export const SENT_MESSAGE_NAME = "send_message";

export function isSentMessage(message: Pick<ChatMessage, "role" | "name">): boolean {
  return message.role === "assistant" && message.name === SENT_MESSAGE_NAME;
}

/**
 * The rows the user reads as replies. Each agent's replies to a user message are the messages it
 * sent with `send_message`. An agent that sent none in that round (older chats, or a model that
 * ignored the tool) is read by its text output instead. Everything else an agent wrote is its
 * working notes. Same rule as `replyIds` in `packages/agent-runtime/src/replies.ts`. Change both together.
 */
export function replyIds(
  messages: readonly Pick<ChatMessage, "id" | "role" | "name" | "content" | "agentId">[],
  ownerId: string,
): Set<string> {
  const ids = new Set<string>();
  let round: Array<(typeof messages)[number]> = [];
  const close = () => {
    const sent = new Set<string>();
    for (const message of round) if (isSentMessage(message)) sent.add(message.agentId ?? ownerId);
    for (const message of round) {
      if (message.role !== "assistant" || !message.content.trim()) continue;
      const author = message.agentId ?? ownerId;
      if (isSentMessage(message) || (!message.name && !sent.has(author))) ids.add(message.id);
    }
    round = [];
  };
  for (const message of messages) {
    if (message.role === "user") close();
    else round.push(message);
  }
  close();
  return ids;
}
