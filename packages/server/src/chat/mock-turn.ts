import { mkdirSync } from "node:fs";

import { createMockProvider, type ChatMessage, type ToolDefinition } from "@botanical/providers";
import { createFileTools } from "@botanical/tools";

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

/** Directory jailed for the built-in file tools. Created if it is missing. */
export function ensureWorkspaceRoot(): string {
  const configured = process.env.BOTANICAL_WORKSPACE?.trim() || process.env.BOTANICAL_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/tmp/botanical-workspace";
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * One mock-provider turn that always calls the built-in `file_list` tool,
 * then echoes the user text plus the tool output. No network and no default profile.
 */
export async function runMockTurn(userText: string, workspaceRoot: string): Promise<MockTurnResult> {
  const tools = createFileTools();
  const fileList = tools.find((tool) => tool.name === "file_list");
  const provider = createMockProvider("mock", {
    capabilities: { tools: true, streaming: true },
    events(request) {
      const usedTool = request.messages.some((message) => message.role === "tool");
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

  const toolDefs: ToolDefinition[] = fileList
    ? [
        {
          name: fileList.name,
          description: fileList.description,
          parameters: fileList.parameters as unknown as Record<string, unknown>,
        },
      ]
    : [];

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
          const result = await tool.execute(event.arguments, { workspaceRoot });
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
    text = toolResult ? `mock:${userText}\n\nUsed file_list:\n${toolResult}` : `mock:${userText}`;
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
  const toolText = messages
    .filter((message) => message.role === "tool")
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
  if (!toolText) return `mock:${userText}`;
  return `mock:${userText}\n\nUsed file_list:\n${toolText}`;
}

function chunk(text: string, size = 24): { type: "text-delta"; text: string }[] {
  if (text.length === 0) return [];
  const parts: { type: "text-delta"; text: string }[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push({ type: "text-delta", text: text.slice(index, index + size) });
  }
  return parts;
}
