import { createA2AService, type A2AService } from "./a2a/service.ts";
import { LoginRateLimiter } from "./auth/rate-limit.ts";
import type { ServerConfig } from "./config.ts";
import { createRouter } from "./router.ts";
import { registerAgentMessages } from "./routes/agent-messages.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerProfiles } from "./routes/profiles.ts";
import type { Store } from "./types.ts";

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  now?: () => Date;
  rateLimiter?: LoginRateLimiter;
}

export interface App {
  fetch(request: Request, extras?: { clientKey?: string }): Promise<Response>;
  /** Agent-to-agent bus for this process. Tests wait on `whenIdle`. */
  a2a: A2AService;
}

export function createApp(deps: AppDeps): App {
  const a2a = createA2AService({
    store: deps.store,
    autorun: deps.config.a2aAutorun,
    profiles: deps.config.profiles,
  });
  const router = createRouter();
  registerHealth(router);
  registerAuth(router);
  registerAgents(router);
  registerChats(router);
  registerMessages(router, a2a);
  registerAgentMessages(router, a2a);
  registerProfiles(router);
  const rateLimiter = deps.rateLimiter ?? new LoginRateLimiter(20, 15 * 60 * 1000);

  return {
    a2a,
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
