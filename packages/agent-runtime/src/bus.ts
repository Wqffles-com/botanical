import type { AgentMessageRecord, AgentMessageStatus, SendAgentMessageInput } from "./a2a";
import { AgentNotFoundError, ValidationError } from "./errors";
import type { AgentMessageRepository, AgentRepository } from "./store";

export interface InboxQuery {
  status?: AgentMessageStatus[];
  limit?: number;
  newestFirst?: boolean;
}

export interface AgentMessageBus {
  send(input: SendAgentMessageInput): Promise<AgentMessageRecord>;
  deliverPending(opts?: { limit?: number; toAgentId?: string }): Promise<AgentMessageRecord[]>;
  listInbox(agentId: string, opts?: InboxQuery): Promise<AgentMessageRecord[]>;
  markRead(ids: readonly string[]): Promise<AgentMessageRecord[]>;
  get(id: string): Promise<AgentMessageRecord | null>;
}

/**
 * Async agent-to-agent bus.
 * `send` only persists a pending row. It does not run the recipient's model.
 * A delivery worker (or an explicit poll) flips pending → delivered.
 * The recipient observes mail on a later turn or via the inbox API.
 */
export function createAgentMessageBus(
  agents: AgentRepository,
  messages: AgentMessageRepository,
): AgentMessageBus {
  return {
    async send(input) {
      const from = await agents.get(input.fromAgentId);
      if (!from) throw new AgentNotFoundError(input.fromAgentId);

      let toAgentId = input.toAgentId;
      if (toAgentId) {
        const to = await agents.get(toAgentId);
        if (!to) throw new AgentNotFoundError(toAgentId);
      } else if (input.toAgentName) {
        const to = await agents.getByName(input.toAgentName);
        if (!to) throw new AgentNotFoundError(input.toAgentName);
        toAgentId = to.id;
      }
      if (!toAgentId) {
        throw new ValidationError("toAgentId or toAgentName is required");
      }

      const body = input.body.trim();
      if (!body) throw new ValidationError("body is required");

      return messages.insert({
        fromAgentId: from.id,
        toAgentId,
        body,
        ...(input.fromChatId ? { fromChatId: input.fromChatId } : {}),
      });
    },
    deliverPending(opts) {
      return messages.deliverPending(opts);
    },
    async listInbox(agentId, opts) {
      const agent = await agents.get(agentId);
      if (!agent) throw new AgentNotFoundError(agentId);
      return messages.listForAgent(agentId, opts);
    },
    markRead(ids) {
      return messages.markRead(ids);
    },
    get(id) {
      return messages.get(id);
    },
  };
}
