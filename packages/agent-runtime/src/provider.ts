import type { ToolCall } from "./message";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mimeType?: string };

/**
 * Shared provider contract. Orchestration imports this — never a vendor SDK.
 * Mirrors docs/ARCHITECTURE.md so packages/providers can implement it directly.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error }
  | { type: "done" };

export interface ModelCapabilities {
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  maxContext: number;
  streaming: boolean;
}

export interface LLMProvider {
  readonly id: string;
  complete(req: ChatRequest): AsyncIterable<ChatEvent>;
  capabilities(model: string): ModelCapabilities;
}
