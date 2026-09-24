import type { ToolRegistry } from "@botanical/tools";
import { LoginRateLimiter } from "./auth/rate-limit.ts";
import type { ServerConfig } from "./config.ts";
import { emptyServerMcp, type ServerMcp } from "./mcp-host.ts";
import { createRouter } from "./router.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMcp } from "./routes/mcp.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerProfiles } from "./routes/profiles.ts";
import type { Store } from "./types.ts";

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  now?: () => Date;
  rateLimiter?: LoginRateLimiter;
  /** Connected on boot. Omitted in tests that do not exercise MCP. */
  mcp?: ServerMcp;
}

export interface App {
  fetch(request: Request, extras?: { clientKey?: string }): Promise<Response>;
  /** MCP tools connected at boot. Ids are `mcp:<server>:<tool>`. */
  tools: ToolRegistry;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const router = createRouter();
  registerHealth(router);
  registerAuth(router);
  registerAgents(router);
  registerChats(router);
  registerMessages(router);
  registerProfiles(router);
  registerMcp(router);
  const rateLimiter = deps.rateLimiter ?? new LoginRateLimiter(20, 15 * 60 * 1000);
  const mcp = deps.mcp ?? emptyServerMcp();

  return {
    tools: mcp.registry,
    close: () => mcp.close(),
    fetch(request, extras) {
      return router.handle(request, {
        config: deps.config,
        store: deps.store,
        clientKey: extras?.clientKey ?? "local",
        rateLimiter,
        now: deps.now,
        mcp,
      });
    },
  };
}
