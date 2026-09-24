import { mkdirSync } from "node:fs";

import { createMockProvider, type ChatMessage, type ToolDefinition as ProviderTool } from "@botanical/providers";
import { createFileTools, type ToolDefinition } from "@botanical/tools";

import { SEND_AGENT_MESSAGE_TOOL } from "../a2a/constants.ts";

export interface MockToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface MockTurnResult {
  text: string;
  toolCall?: MockToolCall;
  toolResult?: string;
}

export interface MockTurnOptions {
  extraTools?: readonly ToolDefinition[];
  agentId?: string;
  chatId?: string;
}

/** Directory jailed for the built-in file tools. Created if it is missing. */
export function ensureWorkspaceRoot(): string {
  const configured = process.env.BOTANICAL_WORKSPACE?.trim() || process.env.BOTANICAL_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/tmp/botanical-workspace";
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * One mock-provider turn. Ordinary text calls `file_list`.
 * A message shaped as `send_agent_message { ... }` calls that tool when it is registered.
 * No network and no default profile.
 */
export async function runMockTurn(
  userText: string,
  workspaceRoot: string,
  options: MockTurnOptions = {},
): Promise<MockTurnResult> {
  const tools = [...createFileTools(), ...(options.extraTools ?? [])];
  const fileList = tools.find((tool) => tool.name === "file_list");
  const sendTool = tools.find((tool) => tool.name === SEND_AGENT_MESSAGE_TOOL);
  const sendDirective = sendTool ? parseSendDirective(userText) : null;
  const provider = createMockProvider("mock", {
    capabilities: { tools: true, streaming: true },
    events(request) {
      const usedTool = request.messages.some((message) => message.role === "tool");
      if (!usedTool && sendDirective) {
        return [
          {
            type: "tool-call",
            id: "call_send_agent_message",
            name: SEND_AGENT_MESSAGE_TOOL,
            arguments: sendDirective,
          },
          { type: "done" },
        ];
      }
      if (!usedTool && fileList) {
        return [
          {
            type: "tool-call",
            id: "call_file_list",
            name: "file_list",
            arguments: { path: "." },
          },
          { type: "done" },
        ];
      }
      const reply = mockReply(request.messages);
      return [...chunk(reply), { type: "done" }];
    },
  });

  const toolDefs: ProviderTool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
  }));

  const messages: ChatMessage[] = [{ role: "user", content: userText }];
  let text = "";
  let toolCall: MockToolCall | undefined;
  let toolResult: string | undefined;

  for await (const event of provider.complete({ model: "echo", messages, tools: toolDefs })) {
    if (event.type === "text-delta") text += event.text;
    if (event.type === "tool-call" && !toolCall) {
      toolCall = { id: event.id, name: event.name, arguments: event.arguments };
      const tool = tools.find((candidate) => candidate.name === event.name);
      if (!tool) {
        toolResult = `Unknown tool ${event.name}`;
      } else {
        try {
          const result = await tool.execute(event.arguments, {
            workspaceRoot,
            ...(options.agentId ? { agentId: options.agentId } : {}),
            ...(options.chatId ? { chatId: options.chatId } : {}),
          });
          toolResult = result.content;
        } catch (error) {
          toolResult = error instanceof Error ? error.message : "Tool failed";
        }
      }
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [toolCall],
      });
      messages.push({
        role: "tool",
        content: toolResult ?? "",
        toolCallId: event.id,
        name: event.name,
      });
    }
  }

  if (toolCall) {
    text = "";
    for await (const event of provider.complete({ model: "echo", messages, tools: toolDefs })) {
      if (event.type === "text-delta") text += event.text;
    }
  }

  if (!text) {
    const name = toolCall?.name ?? "tool";
    text = toolResult ? `mock:${userText}\n\nUsed ${name}:\n${toolResult}` : `mock:${userText}`;
  }

  return {
    text,
    ...(toolCall ? { toolCall } : {}),
    ...(toolResult !== undefined ? { toolResult } : {}),
  };
}

function mockReply(messages: readonly ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
  const toolMessages = messages.filter((message) => message.role === "tool");
  const toolText = toolMessages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
  if (!toolText) return `mock:${userText}`;
  const toolName = toolMessages[0]?.name || "tool";
  return `mock:${userText}\n\nUsed ${toolName}:\n${toolText}`;
}

/**
 * Mock-provider seam so a turn can call `send_agent_message` without a live model.
 * The whole user text must be `send_agent_message` plus a JSON object.
 */
function parseSendDirective(text: string): { toAgentId?: string; toAgentName?: string; body: string } | null {
  const match = /^send_agent_message\s+(\{[\s\S]*\})$/.exec(text.trim());
  const json = match?.[1];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.body !== "string" || record.body.trim() === "") return null;
    const directive: { toAgentId?: string; toAgentName?: string; body: string } = { body: record.body };
    if (typeof record.toAgentId === "string" && record.toAgentId.trim()) {
      directive.toAgentId = record.toAgentId.trim();
    }
    if (typeof record.toAgentName === "string" && record.toAgentName.trim()) {
      directive.toAgentName = record.toAgentName.trim();
    }
    if (!directive.toAgentId && !directive.toAgentName) return null;
    return directive;
  } catch {
    return null;
  }
}

function chunk(text: string, size = 24): { type: "text-delta"; text: string }[] {
  if (text.length === 0) return [];
  const parts: { type: "text-delta"; text: string }[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push({ type: "text-delta", text: text.slice(index, index + size) });
  }
  return parts;
}
