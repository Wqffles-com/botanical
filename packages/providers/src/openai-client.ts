import { ProviderError, asError, isAbortError } from "./errors.ts";
import { combineSignals, httpError, joinUrl, readBodyLimited, rethrowTransport, USER_AGENT } from "./http.ts";
import { readSse } from "./sse.ts";
import type { ChatEvent, ChatMessage, ChatRequest, ContentPart, ToolDefinition } from "./types.ts";

export interface OpenAICompatibleOptions {
  id: string;
  apiKey?: string;
  baseURL: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  includeUsage?: boolean;
  /** OpenAI chat completions uses `max_completion_tokens`. Compatible hosts still use `max_tokens`. */
  tokenField?: "max_tokens" | "max_completion_tokens";
}

interface ToolAcc {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/**
 * Streaming Chat Completions client. Shared by GPT, Grok, DeepSeek, OpenRouter,
 * and any other OpenAI-compatible host.
 */
export async function* streamChatCompletions(
  request: ChatRequest,
  options: OpenAICompatibleOptions,
): AsyncGenerator<ChatEvent> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = joinUrl(options.baseURL, "chat/completions");
  const secret = options.apiKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "user-agent": USER_AGENT,
    ...options.defaultHeaders,
  };
  if (secret) headers.authorization = `Bearer ${secret}`;

  const body: Record<string, unknown> = {
    ...options.extraBody,
    model: request.model,
    messages: toOpenAIMessages(request.messages),
    stream: true,
  };
  if (options.includeUsage !== false) body.stream_options = { include_usage: true };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) {
    body[options.tokenField ?? "max_tokens"] = request.maxTokens;
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map(toOpenAITool);
  }

  const signal = combineSignals(
    request.signal ? [request.signal] : [],
    request.timeoutMs,
  );

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
  const tools = new Map<number, ToolAcc>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  try {
    for await (const message of readSse(response.body, signal)) {
      const data = message.data.trim();
      if (data === "[DONE]") break;
      const json = parseJsonObject(data);
      if (!json) {
        throw new ProviderError(`Provider "${options.id}" sent a non-JSON stream event.`, {
          providerId: options.id,
          code: "stream",
        });
      }
      const streamError = errorText(json);
      if (streamError) {
        const error = new ProviderError(streamError, { providerId: options.id, code: "stream" });
        if (emitted) {
          yield { type: "error", error };
          return;
        }
        throw error;
      }

      const choice = firstChoice(json);
      const delta = asRecord(choice?.delta) ?? {};
      const content = delta.content;
      if (typeof content === "string" && content.length > 0) {
        emitted = true;
        yield { type: "text-delta", text: content };
      }
      const reasoning = reasoningText(delta);
      if (reasoning) {
        emitted = true;
        yield { type: "reasoning-delta", text: reasoning };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) accumulateTool(tools, call);
      }
      const parsedUsage = usageFrom(json.usage);
      if (parsedUsage) usage = parsedUsage;
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

  for (const event of flushTools(tools)) {
    emitted = true;
    yield event;
  }
  if (usage) yield { type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  yield { type: "done" };
}

export function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      if (!message.toolCallId) {
        throw new ProviderError("Tool messages require toolCallId.", { code: "config" });
      }
      const tool: Record<string, unknown> = {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: contentToText(message.content),
      };
      if (message.name) tool.name = message.name;
      return tool;
    }

    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      const assistant: Record<string, unknown> = {
        role: "assistant",
        content: message.content === "" ? null : toOpenAIContent(message.content),
        tool_calls: message.toolCalls.map((call) => {
          if (!call.id || !call.name) {
            throw new ProviderError("Tool calls require id and name.", { code: "config" });
          }
          return {
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments:
                typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
            },
          };
        }),
      };
      return assistant;
    }

    const mapped: Record<string, unknown> = {
      role: message.role,
      content: toOpenAIContent(message.content),
    };
    if (message.name && message.role !== "system") mapped.name = message.name;
    return mapped;
  });
}

export function toOpenAIContent(content: string | ContentPart[]): string | Record<string, unknown>[] {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const url = imageUrl(part);
    return { type: "image_url", image_url: { url } };
  });
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  };
}

function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is ContentPart & { type: "text" } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function imageUrl(part: ContentPart & { type: "image" }): string {
  if (part.url) return part.url;
  if (part.data) return `data:${part.mediaType ?? "image/png"};base64,${part.data}`;
  throw new ProviderError("Image content requires url or data.", { code: "config" });
}

function accumulateTool(tools: Map<number, ToolAcc>, value: unknown): void {
  const record = asRecord(value);
  if (!record) return;
  const index = typeof record.index === "number" ? record.index : tools.size;
  let acc = tools.get(index);
  if (!acc) {
    acc = { index, id: "", name: "", arguments: "" };
    tools.set(index, acc);
  }
  if (typeof record.id === "string") acc.id += record.id;
  const fn = asRecord(record.function);
  if (!fn) return;
  if (typeof fn.name === "string") acc.name += fn.name;
  if (typeof fn.arguments === "string") acc.arguments += fn.arguments;
}

function flushTools(tools: Map<number, ToolAcc>): ChatEvent[] {
  return [...tools.values()]
    .sort((a, b) => a.index - b.index)
    .filter((tool) => tool.id.length > 0 || tool.name.length > 0 || tool.arguments.length > 0)
    .map((tool) => ({
      type: "tool-call" as const,
      id: tool.id,
      name: tool.name,
      arguments: parseToolArguments(tool.arguments),
    }));
}

export function parseToolArguments(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function reasoningText(delta: Record<string, unknown>): string | undefined {
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    return delta.reasoning_content;
  }
  if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) return delta.reasoning;
  if (!Array.isArray(delta.reasoning_details)) return undefined;
  const parts: string[] = [];
  for (const detail of delta.reasoning_details) {
    const record = asRecord(detail);
    if (!record) continue;
    if (typeof record.text === "string" && record.text.length > 0) parts.push(record.text);
    else if (typeof record.summary === "string" && record.summary.length > 0) parts.push(record.summary);
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function usageFrom(value: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  return {
    inputTokens: numberOrZero(usage.prompt_tokens),
    outputTokens: numberOrZero(usage.completion_tokens),
  };
}

function firstChoice(json: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(json.choices) || json.choices.length === 0) return undefined;
  return asRecord(json.choices[0]);
}

function errorText(json: Record<string, unknown>): string | undefined {
  const error = asRecord(json.error);
  if (!error) return undefined;
  if (typeof error.message === "string" && error.message.length > 0) return error.message;
  return "Provider stream error";
}

function parseJsonObject(data: string): Record<string, unknown> | undefined {
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
