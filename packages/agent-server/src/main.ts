import {
  DeliveryWorker,
  createAgentMessageBus,
  createBuiltinToolSource,
  createMcpToolSource,
  createMemoryStore,
  createRuntimeToolSource,
  staticProfileResolver,
  type ProfileResolver,
  type Store,
  type ToolSource,
} from "@botanical/agent-runtime";
import { createRuntimeApp } from "./app";
import { createEchoProvider } from "./echo";
import { loadAgentConfigFile } from "./load-agents";
import { McpManager } from "./mcp/manager";
import { createPostgresStore } from "./postgres";

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "0.0.0.0";
const persistence = process.env.DATABASE_URL ? "postgres" : "memory";

let closeDb = async (): Promise<void> => {};
const store: Store = await openStore();

if (process.env.BOTANICAL_AGENTS_FILE) {
  const loaded = await loadAgentConfigFile(process.env.BOTANICAL_AGENTS_FILE, store.agents);
  console.log(`[botanical] loaded ${loaded.length} agent(s)`);
}

const mcp = process.env.BOTANICAL_MCP_CONFIG
  ? await McpManager.fromFile(process.env.BOTANICAL_MCP_CONFIG)
  : null;

const profiles: ProfileResolver =
  process.env.BOTANICAL_DEV_PROVIDER === "echo"
    ? staticProfileResolver({
        [process.env.BOTANICAL_ECHO_PROFILE ?? "echo"]: {
          provider: createEchoProvider(),
          model: "echo",
        },
      })
    : staticProfileResolver({});

const bus = createAgentMessageBus(store.agents, store.agentMessages);
const toolSources: ToolSource[] = [createRuntimeToolSource(bus), createBuiltinToolSource([])];
if (mcp) toolSources.push(createMcpToolSource(mcp));

const worker = new DeliveryWorker(bus, pollInterval());
worker.start();

const app = createRuntimeApp({
  store,
  bus,
  profiles,
  toolSources,
  persistence,
  mcp,
  maxSteps: maxStepsFromEnv(),
});

Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`[botanical] runtime listening on http://${hostname}:${port} (${persistence})`);

async function openStore(): Promise<Store> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[botanical] DATABASE_URL is not set; agent state is in-memory only");
    return createMemoryStore();
  }
  const postgresStore = createPostgresStore(databaseUrl);
  closeDb = () => postgresStore.close();
  if (process.env.BOTANICAL_AUTO_MIGRATE !== "0") await postgresStore.migrate();
  return postgresStore.store;
}

function pollInterval(): number {
  const parsed = Number(process.env.A2A_POLL_MS ?? 1000);
  if (!Number.isFinite(parsed) || parsed < 100) return 1000;
  return parsed;
}

function maxStepsFromEnv(): number | undefined {
  if (!process.env.BOTANICAL_MAX_STEPS) return undefined;
  const parsed = Number(process.env.BOTANICAL_MAX_STEPS);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("BOTANICAL_MAX_STEPS must be a positive integer");
  }
  return parsed;
}

async function shutdown(): Promise<void> {
  worker.stop();
  await mcp?.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
