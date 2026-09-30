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
import { SlidingWindowLimiter } from "./listeners/limit.ts";
import { presetCliProfiles, type ServerConfig } from "./config.ts";
import { createCliToolHost, registerCliMcp, type CliToolHost } from "./cli-mcp.ts";
import { createCliService, type CliService } from "./cli-install/service.ts";
import { seedInstance } from "./db/store.ts";
import { emptyServerMcp, type ServerMcp } from "./mcp-host.ts";
import { createRouter } from "./router.ts";
import { createServerProfileResolver } from "./runtime/profiles.ts";
import { adaptServerStore } from "./runtime/store.ts";
import { agentWorkspace, userWorkspaceRoot } from "./runtime/workspace.ts";
import { registerAgentMessages } from "./routes/agent-messages.ts";
import { registerAlwaysOnSettings } from "./routes/always-on-settings.ts";
import { registerAppearance } from "./routes/appearance.ts";
import { registerAccountSettings } from "./routes/account-settings.ts";
import { registerAgents } from "./routes/agents.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerChats } from "./routes/chats.ts";
import { registerCli } from "./routes/cli.ts";
import { registerHealth } from "./routes/health.ts";
import { registerMcp } from "./routes/mcp.ts";
import { registerListeners, registerHooks } from "./routes/listeners.ts";
import { registerMemories } from "./routes/memories.ts";
import { registerMessages } from "./routes/messages.ts";
import { registerNotifications } from "./routes/notifications.ts";
import { registerProfiles } from "./routes/profiles.ts";
import { registerRoles } from "./routes/roles.ts";
import { registerRoutines } from "./routes/routines.ts";
import { registerTools } from "./routes/tools.ts";
import { registerTranscription } from "./routes/transcription.ts";
import { registerWorkspace } from "./routes/workspace.ts";
import { createChatQueue, type ChatQueue } from "./runtime/chat-queue.ts";
import { createBackgroundJobs } from "./runtime/jobs.ts";
import { createTurnCoordinator, type TurnCoordinator } from "./runtime/turns.ts";
import { createScheduler, type Scheduler } from "./routines/scheduler.ts";
import { createAgentAdminContributor } from "./tools/agent-admin.ts";
import { createMemoryContributor } from "./tools/memory.ts";
import { createNotifyContributor } from "./tools/notify.ts";
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
  /**
   * When false, `serve` does not start the scheduler interval.
   * Tests pass `{ scheduler: false }` instead of an environment variable.
   * A started scheduler still checks `always_on.scheduler_enabled` on each tick.
   * Default true.
   */
  scheduler?: boolean;
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
  /** Routine scheduler. `serve` calls `start` only when `scheduleOnBoot` is true. */
  scheduler: Scheduler;
  /** False when `createApp({ scheduler: false })`. */
  scheduleOnBoot: boolean;
  /** Per-chat turn lock and the background concurrency cap. */
  turns: TurnCoordinator;
  /** Async chat messages: queued turns that run detached from the request. Tests wait on `whenIdle`. */
  chatQueue: ChatQueue;
}

export function createApp(deps: AppDeps): App {
  let seeded: Promise<void> | null = null;
  function ensureSeed(): Promise<void> {
    seeded ??= seedInstance(deps.store, deps.config, deps.env ?? process.env).catch((error: unknown) => {
      seeded = null;
      throw error;
    });
    return seeded;
  }
  const turns = createTurnCoordinator({
    concurrency: () => deps.store.alwaysOnSettings.peek().backgroundConcurrency,
  });
  let runtimeDeps: RuntimeDeps | undefined;
  const a2a = createA2AService({
    store: deps.store,
    autorun: deps.config.a2aAutorun,
    profiles: deps.config.profiles,
    runtime: () => {
      if (!runtimeDeps) throw new Error("Runtime is not ready");
      return runtimeDeps;
    },
    exclusive: (chatId, fn) => turns.exclusive(chatId, fn),
    // Inbox turns land in the agent's own chat; an open thread sees them live.
    onMessage: (message) => chatQueue.broadcast(message.chatId, { event: "message", data: { message } }),
  });
  const mcp = deps.mcp ?? emptyServerMcp();
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
  const chatQueue = createChatQueue({ store: deps.store, runtime: runtime.deps, turns });
  const jobs = createBackgroundJobs({
    store: deps.store,
    config: deps.config,
    turns,
    chatQueue,
  });
  const scheduler = createScheduler({
    store: deps.store,
    turns,
    executeRun: (runId) => jobs.executeRoutineRun(runId),
    now: deps.now,
  });
  const hookLimiter = new SlidingWindowLimiter(60, 60_000);
  const cli =
    deps.cli ??
    createCliService({
      env: deps.env ?? (process.env as Env),
      profiles: async () => [...deps.config.profiles, ...(await deps.store.globalProfiles.list())],
      enable: async (name) => {
        for (const profile of presetCliProfiles(name)) await deps.store.globalProfiles.upsert(profile);
      },
    });
  const router = createRouter();
  registerHealth(router);
  registerAuth(router);
  registerAccountSettings(router);
  registerAgents(router);
  registerWorkspace(router);
  registerRoles(router);
  registerMemories(router);
  registerChats(router);
  registerMessages(router, runtime.deps, turns, chatQueue, a2a);
  registerRoutines(router, jobs);
  registerListeners(router);
  registerHooks(router, { jobs, limiter: hookLimiter });
  registerNotifications(router);
  registerAlwaysOnSettings(router);
  registerAppearance(router);
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
      scheduler.stop();
      cli.close();
      await mcp.close();
    },
    a2a,
    cliTools,
    cli,
    scheduler,
    scheduleOnBoot: deps.scheduler !== false,
    turns,
    chatQueue,
    fetch(request, extras) {
      return ensureSeed().then(() =>
        router.handle(request, {
        config: deps.config,
        store: deps.store,
        clientKey: extras?.clientKey ?? "local",
        rateLimiter,
        now: deps.now,
        mcp,
      }),
      );
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
    registry.register(createNotifyContributor(deps.store));
  }
  const profiles = deps.profiles ?? createServerProfileResolver(deps.config, env, cliTools, deps.store);
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
        workspaceRoot: ctx.workspaceRoot ?? userWorkspaceRoot(),
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
