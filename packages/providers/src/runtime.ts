import { ProfileRequiredError, UnknownProfileError } from "./errors.ts";
import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  ImagePart,
  ProviderRegistry,
  ToolDefinition,
} from "./types.ts";

/**
 * Structural match for `packages/agent-runtime` `LLMProvider` and `ProfileResolver`
 * (`src/provider.ts`, `src/profiles.ts` on feat/v0-mvp). m06's branch
 * `feat/mvp-server-runtime` had not published a newer contract when this adapter
 * was added. This module does not import the runtime.
 *
 * Differences the adapter normalizes:
 * - `reasoning-delta` is omitted. The runtime loop switches on `text-delta` and `tool-call`.
 * - `capabilities()` omits `reasoning`.
 * - Image parts accept runtime `mimeType` and provider `mediaType`.
 */

export type RuntimeContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mimeType?: string; mediaType?: string; data?: string };

export interface RuntimeChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | RuntimeContentPart[];
  toolCallId?: string;
  toolCalls?: RuntimeToolCall[];
  name?: string;
}

export interface RuntimeToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface RuntimeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RuntimeChatRequest {
  model: string;
  messages: RuntimeChatMessage[];
  tools?: RuntimeToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type RuntimeChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error }
  | { type: "done" };

export interface RuntimeModelCapabilities {
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  maxContext: number;
  streaming: boolean;
}

export interface RuntimeLLMProvider {
  readonly id: string;
  complete(req: RuntimeChatRequest): AsyncIterable<RuntimeChatEvent>;
  capabilities(model: string): RuntimeModelCapabilities;
}

export interface RuntimeProfileSummary {
  id: string;
  providerId: string;
  model: string;
}

export interface RuntimeResolvedProfile {
  profileId: string;
  providerId: string;
  provider: RuntimeLLMProvider;
  model: string;
}

export interface RuntimeProfileResolver {
  resolve(profileId: string): Promise<RuntimeResolvedProfile>;
  list(): Promise<RuntimeProfileSummary[]>;
}

/** Blank profileId. `code` matches agent-runtime `ProfileRequiredError`. */
export class RuntimeProfileRequiredError extends Error {
  readonly code = "PROFILE_REQUIRED";
  readonly status = 400;

  constructor() {
    super("profileId is required — Botanical has no default model profile");
    this.name = "ProfileRequiredError";
  }
}

/** Unknown profileId. `code` matches agent-runtime `ProfileNotFoundError`. */
export class RuntimeProfileNotFoundError extends Error {
  readonly code = "PROFILE_NOT_FOUND";
  readonly status = 404;

  constructor(id: string) {
    super(`Unknown model profile "${id}"`);
    this.name = "ProfileNotFoundError";
  }
}

/**
 * One resolver for every listed profile. `resolve` checks the profile id and
 * the server env key. It does not call the vendor and it does not pick a
 * profile when `profileId` is blank.
 */
export function createRuntimeBridge(registry: ProviderRegistry): RuntimeProfileResolver {
  return {
    async list() {
      return registry.listProfiles().map((profile) => ({
        id: profile.id,
        providerId: profile.provider,
        model: profile.model,
      }));
    },
    async resolve(profileId: string) {
      const id = typeof profileId === "string" ? profileId.trim() : "";
      if (!id) throw new RuntimeProfileRequiredError();
      const profile = registry.getProfile(id);
      if (!profile) throw new RuntimeProfileNotFoundError(profileId);
      try {
        registry.resolve({
          profileId: id,
          messages: [{ role: "user", content: "." }],
        });
      } catch (error) {
        if (error instanceof UnknownProfileError) throw new RuntimeProfileNotFoundError(id);
        if (error instanceof ProfileRequiredError) throw new RuntimeProfileRequiredError();
        throw error;
      }
      return {
        profileId: profile.id,
        providerId: profile.provider,
        model: profile.model,
        provider: bindProvider(registry, profile.id, profile.provider),
      };
    },
  };
}

function bindProvider(registry: ProviderRegistry, profileId: string, providerId: string): RuntimeLLMProvider {
  return {
    id: providerId,
    capabilities(model: string) {
      const caps = registry.capabilities(profileId, model);
      return {
        tools: caps.tools,
        parallelTools: caps.parallelTools,
        vision: caps.vision,
        maxContext: caps.maxContext,
        streaming: caps.streaming,
      };
    },
    complete(request: RuntimeChatRequest) {
      const chatRequest: ChatRequest = {
        model: request.model,
        messages: request.messages.map(fromRuntimeMessage),
        signal: request.signal,
      };
      if (request.tools !== undefined) chatRequest.tools = request.tools.map(fromRuntimeTool);
      if (request.temperature !== undefined) chatRequest.temperature = request.temperature;
      if (request.maxTokens !== undefined) chatRequest.maxTokens = request.maxTokens;
      return normalizeEvents(
        registry.complete({
          profileId,
          model: chatRequest.model,
          messages: chatRequest.messages,
          tools: chatRequest.tools,
          temperature: chatRequest.temperature,
          maxTokens: chatRequest.maxTokens,
          signal: chatRequest.signal,
        }),
      );
    },
  };
}

async function* normalizeEvents(stream: AsyncIterable<ChatEvent>): AsyncGenerator<RuntimeChatEvent> {
  for await (const event of stream) {
    switch (event.type) {
      case "reasoning-delta":
        continue;
      case "text-delta":
        yield { type: "text-delta", text: event.text };
        break;
      case "tool-call":
        yield { type: "tool-call", id: event.id, name: event.name, arguments: event.arguments };
        break;
      case "usage":
        yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        break;
      case "error":
        yield { type: "error", error: event.error };
        break;
      case "done":
        yield { type: "done" };
        break;
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }
}

function fromRuntimeMessage(message: RuntimeChatMessage): ChatMessage {
  const next: ChatMessage = {
    role: message.role,
    content: typeof message.content === "string" ? message.content : message.content.map(fromRuntimePart),
  };
  if (message.toolCallId !== undefined) next.toolCallId = message.toolCallId;
  if (message.name !== undefined) next.name = message.name;
  if (message.toolCalls !== undefined) {
    next.toolCalls = message.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
  }
  return next;
}

function fromRuntimePart(part: RuntimeContentPart): ContentPart {
  if (part.type === "text") return { type: "text", text: part.text };
  const image: ImagePart = { type: "image", url: part.url };
  if (part.data !== undefined) image.data = part.data;
  const media = part.mediaType ?? part.mimeType;
  if (media !== undefined) image.mediaType = media;
  return image;
}

function fromRuntimeTool(tool: RuntimeToolDefinition): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}
