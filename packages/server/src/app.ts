import {
  createAgentMessageBus,
  type ProfileResolver,
  type RuntimeDeps,
  type ToolRegistry,
} from "@botanical/agent-runtime";
import type { Env } from "@botanical/providers";
import { LoginRateLimiter } from "./auth/rate-limit.ts";
import type { ServerConfig } from "./config.ts";
import { createRouter } from "./router.ts";
import { createServerProfileResolver } from "./runtime/profiles.ts";
import { adaptServerStore } from "./runtime/store.ts";
import { ensureWorkspaceRoot } from "./runtime/workspace.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerProfiles } from "./routes/profiles.ts";
import { registerTools } from "./routes/tools.ts";
import { createDefaultToolRegistry } from "./tools/catalog.ts";
import type { Store } from "./types.ts";

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  now?: () => Date;
  rateLimiter?: LoginRateLimiter;
  /** Provider key lookup. Tests pass a closed env so host keys are not used. */
  env?: Env;
  toolRegistry?: ToolRegistry;
  profiles?: ProfileResolver;
}

export interface App {
  fetch(request: Request, extras?: { clientKey?: string }): Promise<Response>;
}

export function createApp(deps: AppDeps): App {
  const runtime = createRuntime(deps);
  const router = createRouter();
  registerHealth(router);
  registerAuth(router);
  registerAgents(router);
  registerChats(router);
  registerMessages(router, runtime.deps);
  registerProfiles(router);
  registerTools(router, runtime.registry);
  const rateLimiter = deps.rateLimiter ?? new LoginRateLimiter(20, 15 * 60 * 1000);

  return {
    fetch(request, extras) {
      return router.handle(request, {
        config: deps.config,
        store: deps.store,
        clientKey: extras?.clientKey ?? "local",
        rateLimiter,
        now: deps.now,
      });
    },
  };
}

function createRuntime(deps: AppDeps): { deps: RuntimeDeps; registry: ToolRegistry } {
  const env = deps.env ?? (process.env as Env);
  const registry = deps.toolRegistry ?? createDefaultToolRegistry();
  const profiles = deps.profiles ?? createServerProfileResolver(deps.config, env);
  const store = adaptServerStore(deps.store);
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  return {
    registry,
    deps: {
      store,
      bus,
      profiles,
      toolSources: registry.toToolSources((ctx) => ({
        ...ctx,
        workspaceRoot: ctx.workspaceRoot ?? ensureWorkspaceRoot(),
      })),
    },
  };
}
