import {
  isAbortError,
  ProviderError,
  type RuntimeChatMessage,
  type RuntimeLLMProvider,
  type RuntimeToolDefinition,
} from "@botanical/providers";
import { createFileTools } from "@botanical/tools";

import { HttpError } from "../http.ts";
import type { SseEvent } from "../streaming.ts";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderTurnResult {
  text: string;
  toolCalls: ProviderToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

let fileTools: ReturnType<typeof createFileTools> | undefined;

/** File-tool schemas whose names are on the agent allowlist. Execution stays with the runtime loop. */
export function fileToolDefinitions(toolIds: readonly string[]): RuntimeToolDefinition[] {
  fileTools ??= createFileTools();
  const allowed = new Set(toolIds);
  return fileTools
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));
}

export function emptyTurn(): ProviderTurnResult {
  return { text: "", toolCalls: [] };
}

/**
 * One streaming completion through the runtime provider interface.
 * Provider `done` is not forwarded; the HTTP layer emits `done` after it persists the assistant message.
 */
export async function* streamProviderEvents(
  provider: RuntimeLLMProvider,
  model: string,
  messages: RuntimeChatMessage[],
  tools: readonly RuntimeToolDefinition[],
  signal: AbortSignal | undefined,
  acc: ProviderTurnResult,
): AsyncGenerator<SseEvent> {
  const request = {
    model,
    messages,
    signal,
    ...(tools.length > 0 ? { tools: [...tools] } : {}),
  };
  for await (const event of provider.complete(request)) {
    if (event.type === "text-delta") {
      acc.text += event.text;
      yield { event: "text-delta", data: { type: "text-delta", text: event.text } };
    } else if (event.type === "tool-call") {
      const call = { id: event.id, name: event.name, arguments: event.arguments };
      acc.toolCalls.push(call);
      yield { event: "tool-call", data: { type: "tool-call", ...call } };
    } else if (event.type === "usage") {
      acc.usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
      yield {
        event: "usage",
        data: { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens },
      };
    } else if (event.type === "error") {
      yield { event: "error", data: { type: "error", error: event.error.message } };
    }
  }
}

export function providerToHttp(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (isAbortError(error)) return new HttpError(499, "aborted", "The request was aborted.");
  if (error instanceof ProviderError) {
    if (error.code === "profile_required") return new HttpError(422, "profile_required", error.message);
    if (error.code === "unknown_profile" || error.code === "unknown_provider") {
      return new HttpError(422, "unknown_profile", error.message);
    }
    if (error.code === "missing_api_key") return new HttpError(422, "missing_api_key", error.message);
    return new HttpError(502, "provider_error", error.message);
  }
  if (error instanceof Error && error.name === "ProfileRequiredError") {
    return new HttpError(422, "profile_required", error.message);
  }
  if (error instanceof Error && error.name === "ProfileNotFoundError") {
    return new HttpError(422, "unknown_profile", error.message);
  }
  return new HttpError(502, "provider_error", "The model provider failed.");
}
