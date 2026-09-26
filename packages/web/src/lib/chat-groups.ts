import type { Agent, Chat } from "@botanical/core";

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
