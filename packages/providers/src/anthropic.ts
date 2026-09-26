import { ProviderError, asError, isAbortError } from "./errors.ts";
import { combineSignals, httpError, joinUrl, readBodyLimited, rethrowTransport, USER_AGENT } from "./http.ts";
import { parseToolArguments } from "./openai-client.ts";
import { readSse } from "./sse.ts";
import type { ChatEvent, ChatMessage, ChatRequest, ContentPart, ToolDefinition } from "./types.ts";

export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicClientOptions {
  id: string;
  apiKey: string;
  baseURL: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  anthropicVersion?: string;
}

interface AnthropicBlock {
  kind: "text" | "tool" | "thinking";
  id: string;
  name: string;
  json: string;
}

/**
 * Map Botanical messages onto the Anthropic Messages API.
 * System turns become the top-level `system` field. Tool results become
 * `tool_result` blocks on a user turn. Consecutive same-role turns are merged
 * because the API requires alternating user and assistant messages.
 */
export function toAnthropicBody(request: ChatRequest): Record<string, unknown> {
  if (request.maxTokens === undefined) {
    throw new ProviderError(
      "Anthropic requires maxTokens. Set it on the profile or on the completion request.",
      { code: "config" },
    );
  }
  if (!Number.isFinite(request.maxTokens) || request.maxTokens < 1) {
    throw new ProviderError("maxTokens must be a positive number.", { code: "config" });
  }

  const systemParts: string[] = [];
  const converted: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];

  for (const message of request.messages) {
    if (message.role === "system") {
      systemParts.push(contentToText(message.content));
      continue;
    }
    if (message.role === "tool") {
      if (!message.toolCallId) {
        throw new ProviderError("Tool messages require toolCallId.", { code: "config" });
      }
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: contentToText(message.content),
          },
        ],
      });
      continue;
    }
    if (message.role === "assistant") {
      converted.push({ role: "assistant", content: assistantBlocks(message) });
      continue;
    }
    converted.push({ role: "user", content: userBlocks(message.content) });
  }

  const messages = mergeRoles(converted);
  if (messages.length === 0) {
    throw new ProviderError("Anthropic requires at least one user or assistant message.", {
      code: "config",
    });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    messages,
    stream: true,
  };
  if (systemParts.length > 0) body.system = systemParts.join("\n\n");
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools && request.tools.length > 0) body.tools = request.tools.map(toAnthropicTool);
  return body;
}

export async function* streamAnthropicMessages(
  request: ChatRequest,
  options: AnthropicClientOptions,
): AsyncGenerator<ChatEvent> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = joinUrl(options.baseURL, "v1/messages");
  const body = toAnthropicBody(request);
  const secret = options.apiKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "user-agent": USER_AGENT,
    "anthropic-version": options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
    ...options.defaultHeaders,
    "x-api-key": secret,
  };
  const signal = combineSignals(request.signal ? [request.signal] : [], request.timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  } catch (err) {
    rethrowTransport(err, options.id, secret);
  }

  if (!response.ok) {
    const text = await readBodyLimited(response);
    throw httpError(options.id, response.status, text, secret);
  }
  if (!response.body) {
    throw new ProviderError(`Provider "${options.id}" returned an empty body.`, {
      providerId: options.id,
      code: "stream",
    });
  }

  let emitted = false;
  const blocks = new Map<number, AnthropicBlock>();
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  try {
    for await (const message of readSse(response.body as unknown as ReadableStream<Uint8Array>, signal)) {
      const json = parseJsonObject(message.data.trim());
      if (!json) continue;
      const type = typeof json.type === "string" ? json.type : message.event;
      if (type === "ping") continue;
      if (type === "error") {
        const error = new ProviderError(anthropicErrorText(json), {
          providerId: options.id,
          code: "stream",
        });
        if (emitted) {
          yield { type: "error", error };
          return;
        }
        throw error;
      }
      if (type === "message_start") {
        const usage = asRecord(asRecord(json.message)?.usage);
        if (usage) {
          inputTokens = numberOrZero(usage.input_tokens);
          outputTokens = numberOrZero(usage.output_tokens);
          sawUsage = true;
        }
        continue;
      }
      if (type === "content_block_start") {
        const index = typeof json.index === "number" ? json.index : blocks.size;
        const block = asRecord(json.content_block);
        const kind = block?.type;
        if (kind === "tool_use") {
          blocks.set(index, {
            kind: "tool",
            id: typeof block?.id === "string" ? block.id : "",
            name: typeof block?.name === "string" ? block.name : "",
            json: "",
          });
        } else if (kind === "thinking") {
          blocks.set(index, { kind: "thinking", id: "", name: "", json: "" });
        } else {
          blocks.set(index, { kind: "text", id: "", name: "", json: "" });
        }
        continue;
      }
      if (type === "content_block_delta") {
        const index = typeof json.index === "number" ? json.index : 0;
        const delta = asRecord(json.delta) ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          emitted = true;
          yield { type: "text-delta", text: delta.text };
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
          emitted = true;
          yield { type: "reasoning-delta", text: delta.thinking };
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const block = blocks.get(index);
          if (block) block.json += delta.partial_json;
        }
        continue;
      }
      if (type === "content_block_stop") {
        const index = typeof json.index === "number" ? json.index : -1;
        const block = blocks.get(index);
        if (block?.kind === "tool") {
          emitted = true;
          yield {
            type: "tool-call",
            id: block.id,
            name: block.name,
            arguments: parseToolArguments(block.json),
          };
        }
        blocks.delete(index);
        continue;
      }
      if (type === "message_delta") {
        const usage = asRecord(json.usage);
        if (usage) {
          outputTokens = numberOrZero(usage.output_tokens);
          sawUsage = true;
        }
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    if (err instanceof ProviderError) {
      if (emitted && err.code === "stream") {
        yield { type: "error", error: err };
        return;
      }
      throw err;
    }
    if (emitted) {
      yield { type: "error", error: asError(err) };
      return;
    }
    throw new ProviderError(`Provider "${options.id}" stream failed.`, {
      providerId: options.id,
      code: "stream",
      cause: err,
    });
  }

  for (const block of blocks.values()) {
    if (block.kind === "tool") {
      yield {
        type: "tool-call",
        id: block.id,
        name: block.name,
        arguments: parseToolArguments(block.json),
      };
    }
  }
  if (sawUsage) yield { type: "usage", inputTokens, outputTokens };
  yield { type: "done" };
}

function assistantBlocks(message: ChatMessage): unknown[] {
  const blocks: unknown[] = [];
  const text = contentToText(message.content);
  if (text.length > 0) blocks.push({ type: "text", text });
  for (const call of message.toolCalls ?? []) {
    if (!call.id || !call.name) {
      throw new ProviderError("Tool calls require id and name.", { code: "config" });
    }
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: typeof call.arguments === "string" ? { raw: call.arguments } : (call.arguments ?? {}),
    });
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "" });
  return blocks;
}

function userBlocks(content: string | ContentPart[]): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.url && !part.data) {
      return { type: "image", source: { type: "url", url: part.url } };
    }
    if (!part.data) throw new ProviderError("Image content requires url or data.", { code: "config" });
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mediaType ?? "image/png",
        data: part.data,
      },
    };
  });
}

function mergeRoles(
  messages: Array<{ role: "user" | "assistant"; content: unknown[] }>,
): Array<{ role: "user" | "assistant"; content: unknown[] }> {
  const merged: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
  for (const message of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === message.role) prev.content.push(...message.content);
    else merged.push({ role: message.role, content: [...message.content] });
  }
  return merged;
}

function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.parameters ?? { type: "object", properties: {} },
  };
}

function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is ContentPart & { type: "text" } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function anthropicErrorText(json: Record<string, unknown>): string {
  const error = asRecord(json.error);
  if (typeof error?.message === "string" && error.message.length > 0) return error.message;
  return "Anthropic stream error";
}

function parseJsonObject(data: string): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    return asRecord(JSON.parse(data) as unknown);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
