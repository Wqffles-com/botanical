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
  runCli,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type Env,
  type ProviderType,
} from "@botanical/providers";

import { userCliAvailability } from "../cli-install/service.ts";
import type { CliToolHost } from "../cli-mcp.ts";
import type { ServerConfig } from "../config.ts";
import type { ProviderFetch } from "../provider-host.ts";
import { providerKeyEnv } from "../provider-keys.ts";
import type { ModelProfile, Store } from "../types.ts";

const MOCK_TOOL = "file_list";
const MOCK_CALL_ID = "call_file_list";
const SEND_TOOL = "send_agent_message";
const SEND_CALL_ID = "call_send_agent_message";

/**
 * Mock profiles call `send_agent_message` when the user text is that tool plus
 * a JSON object and the agent's allowlist includes it. Otherwise they call
 * `file_list` when that tool is offered, then echo the user text plus the tool
 * output. No network.
 */
export function mockProfileEvents(request: ChatRequest): ChatEvent[] {
  const names = new Set((request.tools ?? []).map((tool) => tool.name));
  const turn = messagesSinceLastUser(request.messages);
  const usedTool = turn.some((message) => message.role === "tool");
  if (!usedTool) {
    const directive = names.has(SEND_TOOL) ? parseSendDirective(lastUserText(turn)) : null;
    if (directive) {
      return [
        { type: "tool-call", id: SEND_CALL_ID, name: SEND_TOOL, arguments: directive },
        { type: "done" },
      ];
    }
    if (names.has(MOCK_TOOL)) {
      return [
        { type: "tool-call", id: MOCK_CALL_ID, name: MOCK_TOOL, arguments: { path: "." } },
        { type: "done" },
      ];
    }
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

export function createServerProfileResolver(
  config: ServerConfig,
  env: Env,
  cliTools: CliToolHost | undefined,
  store: Store,
): ProfileResolver {
  const bridged = config.providers?.runtime;

  return {
    async list() {
      const profiles = await store.profiles.list();
      if (profiles.length === 0 && bridged) return bridged.list();
      return profiles.map((profile) => ({
        id: profile.id,
        providerId: profile.provider,
        model: profile.model,
      }));
    },
    async resolve(profileId) {
      const profiles = await store.profiles.list();
      const profile = profiles.find((item) => item.id === profileId);
      if (profile && (profile.kind === "cli" || profile.provider === "cli")) {
        return {
          profileId: profile.id,
          providerId: "cli",
          provider: cliProvider(profile, cliTools, env),
          model: profile.model,
        };
      }
      if (profile?.provider === "mock") {
        return {
          profileId: profile.id,
          providerId: profile.provider,
          provider: mockProvider(profile),
          model: profile.model,
        };
      }
      if (!profile && bridged) return bridged.resolve(profileId);
      if (!profile) throw new ProfileNotFoundError(profileId);
      const keys = await providerKeyEnv(store, profile.provider);
      return {
        profileId: profile.id,
        providerId: profile.provider,
        provider: createProfileProvider(profile, keys, config.providers.fetchImpl),
        model: profile.model,
      };
    },
  };
}

/**
 * Subscription CLIs run in the agent workspace. When `botanicalTools` is on,
 * the same turn exposes Botanical's tool catalog over a per-run MCP server.
 * Tool calls from that server are already dispatched; they arrive as settled
 * tool-call events so the loop records them and does not run them twice.
 * Claude Code also takes messages sent mid-turn on stdin (`request.input`).
 */
function cliProvider(profile: ModelProfile, cliTools: CliToolHost | undefined, env: Env): RuntimeProvider {
  const exposeTools = profile.botanicalTools !== false && cliTools != null;
  return {
    id: profile.id,
    capabilities() {
      return {
        tools: exposeTools,
        parallelTools: false,
        vision: false,
        maxContext: 200_000,
        streaming: true,
      };
    },
    async *complete(request) {
      if (!profile.cli) {
        yield { type: "error", error: new Error(`Profile ${profile.id} is missing a CLI name`) };
        return;
      }
      const { status, env: cliEnv } = await userCliAvailability(
        { cli: profile.cli, ...(profile.bin ? { bin: profile.bin } : {}) },
        env,
      );
      if (!status.available || !status.bin) {
        yield {
          type: "error",
          error: new Error(status.unavailableReason ?? `CLI profile ${profile.id} is unavailable`),
        };
        return;
      }
      const cwd = request.cwd?.trim() || process.cwd();
      const session =
        exposeTools && cliTools && request.agentId && request.chatId
          ? cliTools.open({
              agentId: request.agentId,
              chatId: request.chatId,
              ...(request.signal ? { signal: request.signal } : {}),
            })
          : undefined;
      try {
        for await (const event of runCli({
          cli: profile.cli,
          bin: status.bin,
          cwd,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.name ? { name: message.name } : {}),
          })),
          timeoutMs: profile.timeoutMs ?? 600_000,
          ...(profile.passModel && profile.model ? { model: profile.model } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(session ? { mcp: { url: session.url, token: session.token }, toolEvents: session.events } : {}),
          ...(request.input ? { input: request.input } : {}),
          env: cliEnv,
        })) {
          if (event.type === "tool-call") {
            yield {
              type: "tool-call",
              id: event.id,
              name: event.name,
              arguments: event.arguments,
              settled: { output: event.output, isError: event.isError === true },
            };
            continue;
          }
          if (event.type === "done") continue;
          yield event;
        }
      } finally {
        session?.close();
      }
    },
  };
}

function createProfileProvider(profile: ModelProfile, env: Env, fetchImpl?: ProviderFetch): RuntimeProvider {
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
        profiles: [
          {
            id: profile.id,
            provider: profile.provider,
            model: profile.model,
            ...(profile.maxTokens !== undefined ? { maxTokens: profile.maxTokens } : {}),
            ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
          },
        ],
      },
      { env, ...(fetchImpl ? { fetch: fetchImpl as typeof fetch } : {}) },
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
  const userText = lastUserText(messages);
  const toolMessages = messages.filter((message) => message.role === "tool");
  const toolText = toolMessages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
  if (!toolText) return `mock:${userText}`;
  const toolName = toolMessages[0]?.name || "tool";
  return `mock:${userText}\n\nUsed ${toolName}:\n${toolText}`;
}

function lastUserText(messages: readonly ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  return typeof lastUser?.content === "string" ? lastUser.content : "";
}

/**
 * Mock-provider seam so a turn can call `send_agent_message` without a live model.
 * The whole user text must be `send_agent_message` plus a JSON object.
 */
function parseSendDirective(text: string): { toAgentId?: string; toAgentName?: string; body: string } | null {
  const match = /^send_agent_message\s+(\{[\s\S]*\})$/.exec(text.trim());
  const json = match?.[1];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.body !== "string" || record.body.trim() === "") return null;
    const directive: { toAgentId?: string; toAgentName?: string; body: string } = { body: record.body };
    if (typeof record.toAgentId === "string" && record.toAgentId.trim()) {
      directive.toAgentId = record.toAgentId.trim();
    }
    if (typeof record.toAgentName === "string" && record.toAgentName.trim()) {
      directive.toAgentName = record.toAgentName.trim();
    }
    if (!directive.toAgentId && !directive.toAgentName) return null;
    return directive;
  } catch {
    return null;
  }
}

function chunk(text: string, size = 24): ChatEvent[] {
  if (text.length === 0) return [];
  const parts: ChatEvent[] = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push({ type: "text-delta", text: text.slice(index, index + size) });
  }
  return parts;
}
