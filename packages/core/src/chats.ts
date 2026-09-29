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
