import type { Agent, Chat, ChatMessage } from "@botanical/core";

/** Group members beside the owning agent. Matches `LIMITS.chatMembers` on the server. */
export const MAX_CHAT_MEMBERS = 7;

/** Add or remove one member, keeping the others in their speaking order. */
export function toggleMember(memberIds: readonly string[], id: string): string[] {
  return memberIds.includes(id) ? memberIds.filter((member) => member !== id) : [...memberIds, id];
}

export function isGroupChat(chat: Pick<Chat, "memberIds"> | null | undefined): boolean {
  return Boolean(chat && chat.memberIds.length > 0);
}

/** The agent that wrote a reply. Rows without an author are the owner's. */
export function messageAuthor(
  message: Pick<ChatMessage, "role" | "agentId">,
  chat: Pick<Chat, "agentId">,
  agents: readonly Agent[],
): Agent | null {
  if (message.role === "user") return null;
  const id = message.agentId || chat.agentId;
  return agents.find((agent) => agent.id === id) ?? null;
}
