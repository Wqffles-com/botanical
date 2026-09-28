import {
  contributorFromBuiltins,
  createAgentMessageBus,
  type ProfileResolver,
  type RuntimeDeps,
  type ToolRegistry as RuntimeToolRegistry,
} from "@botanical/agent-runtime";
import type { Env } from "@botanical/providers";
import type { ToolRegistry as McpToolRegistry } from "@botanical/tools";
import { createA2AService, type A2AService } from "./a2a/service.ts";
import { createSendAgentMessageTool } from "./a2a/tool.ts";
import { LoginRateLimiter } from "./auth/rate-limit.ts";
import type { ServerConfig } from "./config.ts";
import { createCliToolHost, registerCliMcp, type CliToolHost } from "./cli-mcp.ts";
import { createCliService, type CliService } from "./cli-install/service.ts";
import { emptyServerMcp, type ServerMcp } from "./mcp-host.ts";
import { createRouter } from "./router.ts";
import { createServerProfileResolver } from "./runtime/profiles.ts";
import { adaptServerStore } from "./runtime/store.ts";
import { agentWorkspace, ensureWorkspaceRoot } from "./runtime/workspace.ts";
import { registerAgentMessages } from "./routes/agent-messages.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerCli } from "./routes/cli.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMcp } from "./routes/mcp.ts";
import { registerMemories } from "./routes/memories.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerProfiles } from "./routes/profiles.ts";
import { registerRoles } from "./routes/roles.ts";
import { registerTools } from "./routes/tools.ts";
import { registerTranscription } from "./routes/transcription.ts";
import { createAgentAdminContributor } from "./tools/agent-admin.ts";
import { createMemoryContributor } from "./tools/memory.ts";
import { contributorFromServerMcp, createDefaultToolRegistry } from "./tools/catalog.ts";
import type { Store } from "./types.ts";

export interface AppDeps {
  config: ServerConfig;
  store: Store;
  now?: () => Date;
  rateLimiter?: LoginRateLimiter;
  /** Connected on boot. Omitted in tests that do not exercise MCP. */
  mcp?: ServerMcp;
  /** Provider key lookup. Tests pass a closed env so host keys are not used. */
  env?: Env;
  toolRegistry?: RuntimeToolRegistry;
  profiles?: ProfileResolver;
  /**
   * Register `send_agent_message` and the connected MCP catalog on `toolRegistry`.
   * Defaults to true when the app builds the registry itself.
   * Tests that pass a closed catalog leave this unset.
   */
  installPlatformTools?: boolean;
  /** Coding-CLI install and login. Tests pass a fake so nothing is downloaded. */
  cli?: CliService;
}

export interface App {
  fetch(request: Request, extras?: { clientKey?: string }): Promise<Response>;
  /** MCP tools connected at boot. Ids are `mcp:<server>:<tool>`. */
  tools: McpToolRegistry;
  close(): Promise<void>;
  /** Agent-to-agent bus for this process. Tests wait on `whenIdle`. */
  a2a: A2AService;
  /** Per-run MCP endpoint for CLI profiles. Session cookies do not authenticate it. */
  cliTools: CliToolHost;
  /** Install and device-login for coding CLIs. */
  cli: CliService;
}

export function createApp(deps: AppDeps): App {
  const a2a = createA2AService({
    store: deps.store,
    autorun: deps.config.a2aAutorun,
    profiles: deps.config.profiles,
  });
  const mcp = deps.mcp ?? emptyServerMcp();
  let runtimeDeps: RuntimeDeps | undefined;
  const cliTools = createCliToolHost({
    port: deps.config.port,
    env: deps.env ?? (process.env as Env),
    getDeps: () => {
      if (!runtimeDeps) throw new Error("CLI tool host is not ready");
      return runtimeDeps;
    },
  });
  const runtime = createRuntime(deps, a2a, mcp, cliTools);
  runtimeDeps = runtime.deps;
  const cli =
    deps.cli ??
    createCliService({
      env: deps.env ?? (process.env as Env),
      profiles: () => deps.config.profiles,
    });
  const router = createRouter();
  registerHealth(router);
  registerAuth(router);
  registerAgents(router);
  registerRoles(router);
  registerMemories(router);
  registerChats(router);
  registerMessages(router, runtime.deps);
  registerAgentMessages(router, a2a);
  registerProfiles(router);
  registerTranscription(router);
  registerCli(router, cli);
  registerMcp(router);
  registerCliMcp(router, cliTools);
  registerTools(router, runtime.registry);
  const rateLimiter = deps.rateLimiter ?? new LoginRateLimiter(20, 15 * 60 * 1000);

  return {
    tools: mcp.registry,
    close: async () => {
      cli.close();
      await mcp.close();
    },
    a2a,
    cliTools,
    cli,
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

function createRuntime(
  deps: AppDeps,
  a2a: A2AService,
  mcp: ServerMcp,
  cliTools: CliToolHost,
): { deps: RuntimeDeps; registry: RuntimeToolRegistry } {
  const env = deps.env ?? (process.env as Env);
  const registry = deps.toolRegistry ?? createDefaultToolRegistry();
  const installPlatform = deps.installPlatformTools ?? !deps.toolRegistry;
  if (installPlatform) {
    registry.register(sendAgentMessageContributor(a2a));
    registry.register(contributorFromServerMcp(mcp));
    registry.register(createMemoryContributor(deps.store));
    registry.register(createAgentAdminContributor(deps.store));
  }
  const profiles = deps.profiles ?? createServerProfileResolver(deps.config, env, cliTools);
  const store = adaptServerStore(deps.store);
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  return {
    registry,
    deps: {
      store,
      bus,
      profiles,
      workspaceFor: (agentId) => agentWorkspace(agentId),
      memories: {
        recall: ({ agentId }) => deps.store.memories.listVisible(agentId, { limit: 200 }),
      },
      toolSources: registry.toToolSources((ctx) => ({
        ...ctx,
        // Shared base. File tools and shell/code_exec narrow this to
        // agents/<agentId> from ctx.agentId. The model does not choose the directory.
        workspaceRoot: ctx.workspaceRoot ?? ensureWorkspaceRoot(),
      })),
    },
  };
}

function sendAgentMessageContributor(a2a: A2AService) {
  const tool = createSendAgentMessageTool(a2a);
  return contributorFromBuiltins(
    [
      {
        name: tool.name,
        description: tool.description,
        parameters: { ...tool.parameters },
        execute: (args, ctx) => tool.execute(args, ctx),
      },
    ],
    { id: "builtin.a2a" },
  );
}
