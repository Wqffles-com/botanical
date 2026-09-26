import type { AgentMessageBus } from "./bus";
import { AgentNotFoundError, ValidationError } from "./errors";
import type { ToolResult, ToolSource } from "./tools";

const OBJECT_SCHEMA = { type: "object", additionalProperties: false } as const;

/**
 * Platform tools, not user built-ins. They ignore the tool allowlist and
 * follow `agent.a2aEnabled`. Sender id always comes from the running chat,
 * never from model arguments.
 */
export function createRuntimeToolSource(bus: AgentMessageBus): ToolSource {
  return {
    id: "runtime",
    async listTools() {
      return [
        {
          name: "agent_send",
          description:
            "Send an asynchronous message to another agent. The recipient does not reply in this turn; the message waits in their inbox.",
          parameters: {
            ...OBJECT_SCHEMA,
            properties: {
              toAgentId: { type: "string", description: "Recipient agent id" },
              toAgentName: {
                type: "string",
                description: "Recipient agent name, used when the id is unknown",
              },
              body: { type: "string", description: "Message body" },
            },
            required: ["body"],
          },
          origin: "runtime" as const,
        },
        {
          name: "agent_inbox",
          description: "List unread messages delivered to you by other agents.",
          parameters: {
            ...OBJECT_SCHEMA,
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 50 },
            },
          },
          origin: "runtime" as const,
        },
      ];
    },
    async call(name, args, ctx): Promise<ToolResult> {
      const record = asRecord(args);
      if (name === "agent_send") {
        const body = typeof record.body === "string" ? record.body : "";
        const toAgentId = typeof record.toAgentId === "string" ? record.toAgentId : undefined;
        const toAgentName = typeof record.toAgentName === "string" ? record.toAgentName : undefined;
        try {
          const sent = await bus.send({
            fromAgentId: ctx.agentId,
            body,
            ...(toAgentId ? { toAgentId } : {}),
            ...(toAgentName ? { toAgentName } : {}),
            fromChatId: ctx.chatId,
          });
          return {
            output: {
              messageId: sent.id,
              status: sent.status,
              toAgentId: sent.toAgentId,
            },
          };
        } catch (error) {
          if (error instanceof AgentNotFoundError || error instanceof ValidationError) {
            return { output: { error: error.message }, isError: true };
          }
          throw error;
        }
      }
      if (name === "agent_inbox") {
        const limit = typeof record.limit === "number" ? Math.max(1, Math.min(50, record.limit)) : 20;
        const inbox = await bus.listInbox(ctx.agentId, {
          status: ["delivered"],
          limit,
        });
        return {
          output: inbox.map((message) => ({
            id: message.id,
            fromAgentId: message.fromAgentId,
            body: message.body,
            createdAt: message.createdAt,
          })),
        };
      }
      return { output: { error: `Unknown runtime tool "${name}"` }, isError: true };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
