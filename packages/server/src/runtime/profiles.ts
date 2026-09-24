import {
  ProfileNotFoundError,
  type ChatEvent as RuntimeChatEvent,
  type LLMProvider as RuntimeProvider,
  type ProfileResolver,
} from "@botanical/agent-runtime";
import {
  ProviderError,
  createMockProvider,
  createRegistry,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type Env,
  type ProviderType,
} from "@botanical/providers";
import type { ServerConfig } from "../config.ts";
import type { ModelProfile } from "../types.ts";

const MOCK_TOOL = "file_list";
const MOCK_CALL_ID = "call_file_list";

/**
 * Mock profiles always call `file_list` when the agent's allowlist includes it,
 * then echo the user text plus the tool output. No network.
 */
export function mockProfileEvents(request: ChatRequest): ChatEvent[] {
  const hasFileList = (request.tools ?? []).some((tool) => tool.name === MOCK_TOOL);
  const turn = messagesSinceLastUser(request.messages);
  const usedTool = turn.some((message) => message.role === "tool");
  if (!usedTool && hasFileList) {
    return [
      { type: "tool-call", id: MOCK_CALL_ID, name: MOCK_TOOL, arguments: { path: "." } },
      { type: "done" },
    ];
  }
  return [...chunk(mockReply(turn)), { type: "done" }];
}

/** History includes earlier tool rows. The demo call is once per user turn. */
function messagesSinceLastUser(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  let lastUser = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") lastUser = index;
  }
  if (lastUser < 0) return messages;
  return messages.slice(lastUser);
}

export function createServerProfileResolver(config: ServerConfig, env: Env): ProfileResolver {
  const byId = new Map(config.profiles.map((profile) => [profile.id, profile]));
  const providers = new Map<string, RuntimeProvider>();

  return {
    async list() {
      return config.profiles.map((profile) => ({
        id: profile.id,
        providerId: profile.provider,
        model: profile.model,
      }));
    },
    async resolve(profileId) {
      const profile = byId.get(profileId);
      if (!profile) throw new ProfileNotFoundError(profileId);
      let provider = providers.get(profile.id);
      if (!provider) {
        provider = createProfileProvider(profile, env);
        providers.set(profile.id, provider);
      }
      return {
        profileId: profile.id,
        providerId: profile.provider,
        provider,
        model: profile.model,
      };
    },
  };
}

function createProfileProvider(profile: ModelProfile, env: Env): RuntimeProvider {
  if (profile.provider === "mock") return mockProvider(profile);
  if (profile.provider === "openai-compat" && !profile.baseUrl) {
    return failingProvider(
      profile,
      new ProviderError(`Profile "${profile.id}" provider openai-compat requires baseUrl.`, { code: "config" }),
    );
  }
  try {
    const registry = createRegistry(
      {
        providers: [
          {
            id: profile.provider,
            type: profile.provider as ProviderType,
            ...(profile.baseUrl ? { baseURL: profile.baseUrl } : {}),
          },
        ],
        profiles: [{ id: profile.id, provider: profile.provider, model: profile.model }],
      },
      { env },
    );
    return {
      id: profile.id,
      capabilities(model) {
        return toRuntimeCapabilities(registry.capabilities(profile.id, model));
      },
      complete(request) {
        return filterEvents(
          registry.complete({
            profileId: profile.id,
            messages: request.messages,
            ...(request.tools ? { tools: request.tools } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
            ...(request.signal ? { signal: request.signal } : {}),
          }),
        );
      },
    };
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error("Invalid model profile");
    return failingProvider(profile, wrapped);
  }
}

function mockProvider(profile: ModelProfile): RuntimeProvider {
  const mock = createMockProvider(profile.id, {
    capabilities: { tools: true, streaming: true, parallelTools: true },
    events: mockProfileEvents,
  });
  return {
    id: profile.id,
    capabilities(model) {
      return toRuntimeCapabilities(mock.capabilities(model));
    },
    complete(request) {
      return filterEvents(mock.complete(request));
    },
  };
}

function failingProvider(profile: ModelProfile, error: Error): RuntimeProvider {
  return {
    id: profile.id,
    capabilities() {
      return {
        tools: false,
        parallelTools: false,
        vision: false,
        maxContext: 0,
        streaming: false,
      };
    },
    complete() {
      throw error;
    },
  };
}

function toRuntimeCapabilities(caps: {
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  maxContext: number;
  streaming: boolean;
}): ReturnType<RuntimeProvider["capabilities"]> {
  return {
    tools: caps.tools,
    parallelTools: caps.parallelTools,
    vision: caps.vision,
    maxContext: caps.maxContext,
    streaming: caps.streaming,
  };
}

async function* filterEvents(events: AsyncIterable<ChatEvent>): AsyncGenerator<RuntimeChatEvent> {
  for await (const event of events) {
    if (event.type === "reasoning-delta") continue;
    yield event;
  }
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

function chunk(text: string, size = 24): ChatEvent[] {
  if (text.length === 0) return [];
  const parts: ChatEvent[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push({ type: "text-delta", text: text.slice(index, index + size) });
  }
  return parts;
}
