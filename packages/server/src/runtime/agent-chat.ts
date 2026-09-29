import type { Agent, Chat, Store } from "../types.ts";

/**
 * Each agent has one chat of its own: the chat it owns with no group members. Every
 * conversation with the agent happens there, including routine runs, webhook deliveries,
 * and agent mail. Group chats (members set) are extra threads beside it.
 */
export function isAgentChat(chat: Pick<Chat, "memberIds">): boolean {
  return chat.memberIds.length === 0;
}

/** The agent's own chat, or null before its first conversation. */
export async function findAgentChat(store: Store, agentId: string): Promise<Chat | null> {
  const chats = await store.chats.list();
  return chats.find((chat) => chat.agentId === agentId && isAgentChat(chat)) ?? null;
}

/**
 * The agent's own chat, created on the given profile when it has none yet. A create that
 * loses a race (`chats_agent_direct_uidx`, or the memory store's check) returns the winner.
 */
export async function ensureAgentChat(
  store: Store,
  agent: Pick<Agent, "id" | "name">,
  profileId: string,
): Promise<{ chat: Chat; created: boolean }> {
  const existing = await findAgentChat(store, agent.id);
  if (existing) return { chat: existing, created: false };
  try {
    const chat = await store.chats.create({ agentId: agent.id, profileId, title: agent.name });
    return { chat, created: true };
  } catch (error) {
    const raced = await findAgentChat(store, agent.id);
    if (raced) return { chat: raced, created: false };
    throw error;
  }
}
