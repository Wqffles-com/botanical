import type { ToolCallContext, ToolContributor, ToolInvocationResult } from "./types.ts";

/**
 * A2A send port. m10 (branch feat/mvp-a2a) owns the service.
 * `send` matches `A2AService.send`: `toAgentId` or `toAgentName`, plus `body`.
 * The built-in tool does not persist messages itself.
 */
export interface SendAgentMessageRequest {
  fromAgentId: string;
  toAgentId?: string;
  toAgentName?: string;
  body: string;
  fromChatId?: string;
}

export interface SendAgentMessageResponse {
  id: string;
  toAgentId: string;
  status: string;
}

export interface AgentToAgentService {
  send(input: SendAgentMessageRequest): Promise<SendAgentMessageResponse>;
}

export interface AgentMessageBusLike {
  send(input: SendAgentMessageRequest): Promise<{ id: string; toAgentId: string; status: string }>;
}

export function agentServiceFromBus(bus: AgentMessageBusLike): AgentToAgentService {
  return {
    async send(input) {
      const record = await bus.send(input);
      return { id: record.id, toAgentId: record.toAgentId, status: record.status };
    },
  };
}

export function unavailableAgentService(): AgentToAgentService {
  return {
    async send() {
      throw new Error("Agent messaging is not configured on this server.");
    },
  };
}

export const SEND_AGENT_MESSAGE_DESCRIPTION = `Send an asynchronous message to another agent.

The recipient does not reply in this turn. The message waits in their inbox. You are always the sender — a from-agent id in the arguments is ignored. Pass toAgentId or toAgentName, and a self-contained body; they cannot see this chat.`;

const SEND_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["body"],
  properties: {
    toAgentId: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      description: "Recipient agent id. Use this when you know the id.",
    },
    toAgentName: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "Recipient agent display name, used when the id is unknown.",
    },
    body: {
      type: "string",
      minLength: 1,
      maxLength: 32_000,
      description: "Message text. The recipient reads this later in their inbox.",
    },
  },
} as const;

export function createSendAgentMessageContributor(
  service: AgentToAgentService | undefined,
  options: { timeoutMs?: number; maxOutputChars?: number } = {},
): ToolContributor {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxOutputChars = options.maxOutputChars ?? 32_000;
  return {
    id: "builtin.a2a",
    source: "builtin",
    listTools() {
      return [
        {
          id: "send_agent_message",
          name: "send_agent_message",
          description: `${SEND_AGENT_MESSAGE_DESCRIPTION}\n\nLimits: aborted after ${timeoutMs} ms; text output truncated to ${maxOutputChars} characters.`,
          parameters: SEND_PARAMETERS as unknown as Record<string, unknown>,
          source: "builtin" as const,
          risk: "write",
          requiresApproval: false,
        },
      ];
    },
    callTool(_toolId, args, ctx) {
      return executeSend(service, args, ctx);
    },
  };
}

async function executeSend(
  service: AgentToAgentService | undefined,
  args: unknown,
  ctx: ToolCallContext,
): Promise<ToolInvocationResult> {
  const parsed = parseSendArgs(args);
  if (!parsed.ok) return parsed.result;
  const fromAgentId = ctx.agentId.trim();
  if (!fromAgentId) {
    return fail("send_agent_message can only run inside an agent turn, so the sender id is known.");
  }
  if (!service) return fail("Agent messaging is not configured on this server.");
  if (ctx.signal?.aborted) return fail("Tool call was aborted.");

  try {
    const sent = await service.send({
      fromAgentId,
      body: parsed.body,
      ...(parsed.toAgentId ? { toAgentId: parsed.toAgentId } : {}),
      ...(parsed.toAgentName ? { toAgentName: parsed.toAgentName } : {}),
      ...(ctx.chatId.trim() ? { fromChatId: ctx.chatId.trim() } : {}),
    });
    if (!isSendResponse(sent)) return fail("Agent messaging returned an unexpected response.");
    return {
      content: `Message ${sent.id} queued for agent ${sent.toAgentId} (status: ${sent.status}). They will see it in their inbox, not as a reply in this chat.`,
      data: { messageId: sent.id, id: sent.id, toAgentId: sent.toAgentId, status: sent.status },
    };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Agent messaging failed.";
    return fail(message);
  }
}

type ParsedSend =
  | { ok: true; toAgentId?: string; toAgentName?: string; body: string }
  | { ok: false; result: ToolInvocationResult };

function parseSendArgs(args: unknown): ParsedSend {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, result: fail("Arguments must be an object with body and toAgentId or toAgentName.") };
  }
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "toAgentId" && key !== "toAgentName" && key !== "body" && key !== "fromAgentId") {
      return { ok: false, result: fail(`Unexpected argument "${key}". Pass toAgentId or toAgentName, and body.`) };
    }
  }
  const toAgentId = typeof record.toAgentId === "string" ? record.toAgentId.trim() : "";
  const toAgentName = typeof record.toAgentName === "string" ? record.toAgentName.trim() : "";
  if (!toAgentId && !toAgentName) {
    return { ok: false, result: fail("toAgentId or toAgentName is required.") };
  }
  if (toAgentId.length > 80) return { ok: false, result: fail("toAgentId must be at most 80 characters.") };
  if (toAgentName.length > 120) return { ok: false, result: fail("toAgentName must be at most 120 characters.") };
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (!body) return { ok: false, result: fail("body must be a non-empty string.") };
  if (body.length > 32_000) return { ok: false, result: fail("body must be at most 32000 characters.") };
  return {
    ok: true,
    body,
    ...(toAgentId ? { toAgentId } : {}),
    ...(toAgentName ? { toAgentName } : {}),
  };
}

function isSendResponse(value: unknown): value is SendAgentMessageResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SendAgentMessageResponse>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.toAgentId === "string" &&
    record.toAgentId.length > 0 &&
    typeof record.status === "string" &&
    record.status.length > 0
  );
}

function fail(message: string): ToolInvocationResult {
  return { content: message, isError: true };
}
