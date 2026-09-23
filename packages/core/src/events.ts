import type { ToolCall } from "./message";

export type FinishReason = "stop" | "max_steps" | "aborted" | "error";

/** Events streamed to the client for one user turn (SSE `event` = `type`). */
export type RuntimeEvent =
  | { type: "step"; step: number }
  | {
      type: "inbox";
      messages: Array<{ id: string; fromAgentId: string; body: string; createdAt: string }>;
    }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "tool-result"; id: string; name: string; result: unknown; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "a2a-sent"; messageId: string; toAgentId: string }
  | { type: "error"; error: string; code?: string }
  | { type: "done"; finishReason: FinishReason };

export type { ToolCall };
