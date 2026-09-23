import type { ChatEvent, ToolCall } from "./types.ts";

export interface CollectedChat {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  events: ChatEvent[];
  error?: Error;
  done: boolean;
}

/** Fold a provider stream into one result. Useful for tests and non-streaming callers. */
export async function collectChat(stream: AsyncIterable<ChatEvent>): Promise<CollectedChat> {
  const events: ChatEvent[] = [];
  let text = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];
  let usage: CollectedChat["usage"];
  let error: Error | undefined;
  let done = false;

  for await (const event of stream) {
    events.push(event);
    switch (event.type) {
      case "text-delta":
        text += event.text;
        break;
      case "reasoning-delta":
        reasoning += event.text;
        break;
      case "tool-call":
        toolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
        break;
      case "usage":
        usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      case "error":
        error = event.error;
        break;
      case "done":
        done = true;
        break;
    }
  }

  const result: CollectedChat = { text, reasoning, toolCalls, events, done };
  if (usage) result.usage = usage;
  if (error) result.error = error;
  return result;
}
