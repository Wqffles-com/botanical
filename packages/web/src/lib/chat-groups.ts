import { isAgentChat, type Agent, type Chat } from "@botanical/core";

export interface ChatGroup {
  agent: Agent | null;
  chats: Chat[];
}

export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => stamp(b) - stamp(a) || a.title.localeCompare(b.title));
}

export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function chatsByAgent(chats: Chat[], agents: Agent[]): ChatGroup[] {
  const grouped = new Map<string, Chat[]>();
  for (const chat of sortChats(chats)) {
    const list = grouped.get(chat.agentId) ?? [];
    list.push(chat);
    grouped.set(chat.agentId, list);
  }
  const result: ChatGroup[] = [];
  const seen = new Set<string>();
  for (const agent of sortAgents(agents)) {
    const list = grouped.get(agent.id);
    if (!list?.length) continue;
    result.push({ agent, chats: list });
    seen.add(agent.id);
  }
  for (const [agentId, list] of grouped) {
    if (seen.has(agentId)) continue;
    result.push({ agent: null, chats: list });
  }
  return result;
}

export function canStartChat(agentId: string | null | undefined, profileId: string | null | undefined): boolean {
  return Boolean(agentId?.trim() && profileId?.trim());
}

function stamp(value: { updatedAt?: string; createdAt?: string }): number {
  const raw = value.updatedAt || value.createdAt || "";
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * The agent's default model profile, when it is listed and can run. The new-chat form
 * shows it pre-selected so the pick stays visible and the user can override it.
 */
export function agentDefaultProfileId(
  agent: Pick<Agent, "defaultProfileId"> | null | undefined,
  profiles: { id: string; available?: boolean | null }[],
): string | null {
  const id = agent?.defaultProfileId?.trim();
  if (!id) return null;
  const profile = profiles.find((item) => item.id === id);
  return profile && profile.available !== false ? profile.id : null;
}

/** The agent's own chat, when the workspace has it. One chat per agent; group chats are extra. */
export function ownChat(agentId: string, chats: readonly Chat[]): Chat | null {
  return chats.find((chat) => chat.agentId === agentId && isAgentChat(chat)) ?? null;
}

/** Where talking to an agent happens: its chat, or the page that opens it the first time. */
export function agentChatHref(agentId: string, chats: readonly Chat[]): string {
  const chat = ownChat(agentId, chats);
  return chat ? `/chats/${encodeURIComponent(chat.id)}` : `/agents/${encodeURIComponent(agentId)}/chat`;
}

/** Group chats, most recent first. */
export function groupChats(chats: readonly Chat[]): Chat[] {
  return sortChats(chats.filter((chat) => !isAgentChat(chat)));
}
