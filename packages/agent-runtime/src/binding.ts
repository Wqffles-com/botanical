import { AgentBindingError } from "./errors";

/** The owner first, then the group members, without duplicates. */
export function chatParticipants(chat: { agentId: string; memberIds?: readonly string[] }): string[] {
  return [...new Set([chat.agentId, ...(chat.memberIds ?? [])])];
}

/**
 * One owning agent per chat, plus optional group members. Passing the owner's id or a
 * member's id is fine (that agent takes the turn). Any other id is a conflict.
 * Omitting the id leaves the turn with the owner.
 */
export function assertChatAgentBinding(
  chat: { agentId: string; memberIds?: readonly string[] },
  requestedAgentId?: string | null,
): void {
  if (requestedAgentId == null || requestedAgentId === "") return;
  if (!chatParticipants(chat).includes(requestedAgentId)) {
    throw new AgentBindingError(
      `Chat is bound to agent "${chat.agentId}" and cannot switch to "${requestedAgentId}"`,
    );
  }
}

/** Agent id is not a mutable chat field, even when the value is unchanged. */
export function rejectAgentRebind(chat: { agentId: string }): never {
  throw new AgentBindingError(
    `Chat is bound to agent "${chat.agentId}". The owning agent cannot be changed.`,
  );
}
