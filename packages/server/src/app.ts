import { LoginRateLimiter } from "./auth/rate-limit.ts";
import type { ServerConfig } from "./config.ts";
import { createRouter } from "./router.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerProfiles } from "./routes/profiles.ts";
import { registerTools } from "./routes/tools.ts";
import { registerBuiltinTools, type AgentToAgentService, type BuiltinToolsOptions } from "./tools/index.ts";
import { createToolRegistry } from "./tools/registry.ts";
import type { ToolRegistry } from "./tools/types.ts";
import type { Store } from "./types.ts";

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  now?: () => Date;
  rateLimiter?: LoginRateLimiter;
  /**
   * Server tool registry. When omitted, a fresh registry is created.
   * Built-in contributors are registered either way and replace the same ids.
   */
  toolRegistry?: ToolRegistry;
  /** Jail override. Defaults to BOTANICAL_WORKSPACE or ./data/workspace. */
  workspaceRoot?: string;
  /** m10 A2A service. `send_agent_message` says messaging is not configured until this is set. */
  agentMessages?: AgentToAgentService;
  builtinTools?: BuiltinToolsOptions;
}

export interface App {
  readonly tools: ToolRegistry;
  fetch(request: Request, extras?: { clientKey?: string }): Promise<Response>;
}

export function createApp(deps: AppDeps): App {
  const router = createRouter();
  const registry = deps.toolRegistry ?? createToolRegistry();
  registerBuiltinTools(registry, {
    ...deps.builtinTools,
    ...(deps.workspaceRoot ? { workspaceRoot: deps.workspaceRoot } : {}),
    ...(deps.agentMessages ? { agentMessages: deps.agentMessages } : {}),
  });
  registerHealth(router);
  registerAuth(router);
  registerAgents(router);
  registerChats(router);
  registerMessages(router);
  registerProfiles(router);
  registerTools(router, registry);
  const rateLimiter = deps.rateLimiter ?? new LoginRateLimiter(20, 15 * 60 * 1000);

  return {
    tools: registry,
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
