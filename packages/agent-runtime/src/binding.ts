import { AgentBindingError } from "./errors";

/**
 * One agent per chat. Passing the bound id is fine (clients echo it).
 * Passing a different id is a conflict. Omitting the id leaves the binding alone.
 */
export function assertChatAgentBinding(
  chat: { agentId: string },
  requestedAgentId?: string | null,
): void {
  if (requestedAgentId == null || requestedAgentId === "") return;
  if (requestedAgentId !== chat.agentId) {
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
