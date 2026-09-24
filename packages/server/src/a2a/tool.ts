import { ToolError, ToolErrorCode, defineTool, type ToolDefinition } from "@botanical/tools";

import { HttpError } from "../http.ts";
import { A2A_BODY_MAX, SEND_AGENT_MESSAGE_TOOL } from "./constants.ts";
import type { A2AService } from "./service.ts";

/**
 * Platform tool. The sender is `ctx.agentId` from the running chat.
 * Model arguments cannot choose a different sender.
 */
export function createSendAgentMessageTool(service: Pick<A2AService, "send">): ToolDefinition {
  return defineTool({
    name: SEND_AGENT_MESSAGE_TOOL,
    description:
      "Send an asynchronous message to another agent. The recipient does not reply in this turn; the message waits in their inbox.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        toAgentId: { type: "string", description: "Recipient agent id" },
        toAgentName: {
          type: "string",
          description: "Recipient agent name, used when the id is unknown",
        },
        body: {
          type: "string",
          minLength: 1,
          maxLength: A2A_BODY_MAX,
          description: "Message body",
        },
      },
      required: ["body"],
    },
    risk: "write",
    requiresApproval: false,
    async run(params, ctx) {
      const fromAgentId = ctx.agentId?.trim() ?? "";
      if (!fromAgentId) {
        throw new ToolError(ToolErrorCode.invalidParams, "agentId is required");
      }
      const toAgentId = typeof params.toAgentId === "string" ? params.toAgentId.trim() : "";
      const toAgentName = typeof params.toAgentName === "string" ? params.toAgentName.trim() : "";
      const body = typeof params.body === "string" ? params.body : "";
      if (!toAgentId && !toAgentName) {
        throw new ToolError(ToolErrorCode.invalidParams, "toAgentId or toAgentName is required");
      }
      try {
        const message = await service.send({
          fromAgentId,
          body,
          ...(toAgentId ? { toAgentId } : {}),
          ...(toAgentName ? { toAgentName } : {}),
          ...(ctx.chatId ? { fromChatId: ctx.chatId } : {}),
        });
        return {
          ok: true,
          content: `Sent message ${message.id} to ${message.toAgentId} (${message.status}).`,
          data: {
            messageId: message.id,
            status: message.status,
            toAgentId: message.toAgentId,
          },
        };
      } catch (error) {
        if (error instanceof HttpError || error instanceof Error) {
          throw new ToolError(ToolErrorCode.toolFailed, error.message);
        }
        throw new ToolError(ToolErrorCode.toolFailed, "Could not send the agent message");
      }
    },
  });
}
