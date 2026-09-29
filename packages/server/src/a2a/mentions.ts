import { mentionedAgents } from "@botanical/core";

import type { Chat, Store } from "../types.ts";
import { A2A_BODY_MAX } from "./constants.ts";
import type { A2AService } from "./service.ts";

export interface MentionDelivery {
  agentId: string;
  agentName: string;
  messageId?: string;
  error?: string;
}

/**
 * `@Name` in a user's chat message sends the mentioned agent a copy as A2A mail
 * from the chat's own agent, with `fromChatId` set. The chat stays with its one
 * agent (DECISIONS 9); the mentioned agent reads it in its inbox (DECISIONS 10).
 * A failed delivery is reported, never thrown, so the chat message still goes through.
 */
export async function deliverMentions(
  store: Store,
  a2a: Pick<A2AService, "send">,
  chat: Chat,
  content: string,
): Promise<MentionDelivery[]> {
  if (!content.includes("@")) return [];
  const agents = (await store.agents.list()).filter((agent) => agent.id !== chat.agentId);
  const mentioned = mentionedAgents(content, agents);
  const deliveries: MentionDelivery[] = [];
  for (const agent of mentioned) {
    const header = `You were mentioned in the chat "${chat.title}" (chat ${chat.id}). The user wrote:\n\n`;
    const body = `${header}${content}`.slice(0, A2A_BODY_MAX);
    try {
      const message = await a2a.send({ fromAgentId: chat.agentId, toAgentId: agent.id, body, fromChatId: chat.id });
      deliveries.push({ agentId: agent.id, agentName: agent.name, messageId: message.id });
    } catch (error) {
      deliveries.push({
        agentId: agent.id,
        agentName: agent.name,
        error: error instanceof Error ? error.message : "Could not deliver the mention",
      });
    }
  }
  return deliveries;
}
