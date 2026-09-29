import { mentionedAgents, type Mentionable } from "@botanical/core";

import type { Chat } from "../types.ts";

/** The owner first, then the members, each once. */
export function participants(chat: Pick<Chat, "agentId" | "memberIds">): string[] {
  return [...new Set([chat.agentId, ...chat.memberIds])];
}

export function isGroupChat(chat: Pick<Chat, "memberIds">): boolean {
  return chat.memberIds.length > 0;
}

/**
 * Who answers a user message in a group chat: the participants it @mentions, in mention order,
 * or every participant in chat order when it mentions none of them.
 */
export function respondersFor(
  chat: Pick<Chat, "agentId" | "memberIds">,
  agents: readonly Mentionable[],
  content: string,
): string[] {
  const ids = participants(chat);
  const mentioned = mentionedAgents(content, agents.filter((agent) => ids.includes(agent.id)));
  return mentioned.length > 0 ? mentioned.map((agent) => agent.id) : ids;
}

/**
 * Participants an agent's reply hands the floor to with an @mention, skipping itself and
 * anyone who already answered or is waiting to. Each agent answers at most once per message,
 * so agents mentioning each other cannot loop.
 */
export function handoffs(
  chat: Pick<Chat, "agentId" | "memberIds">,
  agents: readonly Mentionable[],
  reply: string,
  skip: ReadonlySet<string>,
): string[] {
  const ids = participants(chat);
  return mentionedAgents(reply, agents.filter((agent) => ids.includes(agent.id)))
    .map((agent) => agent.id)
    .filter((id) => !skip.has(id));
}
