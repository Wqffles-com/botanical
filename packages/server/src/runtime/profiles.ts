import {
  ProfileNotFoundError,
  type ChatEvent as RuntimeChatEvent,
  type LLMProvider as RuntimeProvider,
  type ProfileResolver,
} from "@botanical/agent-runtime";
import {
  ProviderError,
  createRegistry,
  runCli,
  type ChatEvent,
  type Env,
  type ProviderType,
} from "@botanical/providers";
import { currentUserId } from "@botanical/db";

import { userCliAvailability } from "../cli-install/service.ts";
import { cliToolNames, type CliToolHost } from "../cli-mcp.ts";
import type { ServerConfig } from "../config.ts";
import type { ProviderFetch } from "../provider-host.ts";
import { providerKeyEnv } from "../provider-keys.ts";
import type { ModelProfile, Store } from "../types.ts";

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
 * Subscription CLIs run in the agent workspace. When `botanicalTools` is on
 * and the agent can use at least one tool, the same turn exposes Botanical's
 * tool catalog over a per-run MCP server.
 * The run is bound to the user who started the turn. A turn with tools and no
 * acting user fails rather than reaching an unscoped store (issue #92).
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
      // Read before any await, inside the turn's user scope: the run acts as this user.
      const userId = currentUserId();
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
      // `request.tools` is the agent's visible catalog, the same list the MCP
      // endpoint would serve. With none, the CLI is not told about Botanical
      // tools, so it does not go looking for them (issue #87).
      const tools = request.tools ?? [];
      const { agentId, chatId } = request;
      const wantsTools = exposeTools && cliTools != null && agentId && chatId && tools.length > 0;
      if (wantsTools && !userId) {
        yield { type: "error", error: new Error("CLI turn has no acting user, so Botanical tools cannot be scoped") };
        return;
      }
      const session =
        wantsTools && userId
          ? cliTools.open({ agentId, chatId, userId, ...(request.signal ? { signal: request.signal } : {}) })
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
          ...(session
            ? {
                mcp: { url: session.url, token: session.token, tools: cliToolNames(tools) },
                toolEvents: session.events,
              }
            : {}),
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
