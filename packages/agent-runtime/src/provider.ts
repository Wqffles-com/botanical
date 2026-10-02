import type { ToolCall } from "./message";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mimeType?: string; data?: string };

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

/** A user message sent while a turn is running. `id` is the caller's (the chat queue id). */
export interface SteeringMessage {
  id: string;
  content: string;
}

/**
 * Messages the user sends while a turn runs. The loop takes them before each
 * model step, so the model reads them mid-turn instead of after it.
 */
export interface TurnSteering {
  /** Remove and return the messages that are waiting. */
  take(): SteeringMessage[];
  /** Called whenever a message starts waiting. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Live input for a provider that can accept user messages while it runs
 * (Claude Code reads them on stdin). `take` returns the text; the loop stores
 * what was taken. Providers without live input ignore it.
 */
export interface LiveInput {
  take(): string[];
  subscribe(listener: () => void): () => void;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Working directory for CLI profiles. API providers ignore it. */
  cwd?: string;
  /** Bound by the turn loop so a CLI profile can open a per-run tool endpoint. */
  agentId?: string;
  chatId?: string;
  /** Set when the turn can be steered. */
  input?: LiveInput;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      arguments: unknown;
      /**
       * Set when the call already went through `dispatchToolCall` (CLI MCP).
       * The loop records it and does not execute it again.
       */
      settled?: { output: unknown; isError?: boolean };
    }
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
