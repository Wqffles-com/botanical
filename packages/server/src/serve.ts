#!/usr/bin/env bun
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type ServerConfig } from "./config.ts";
import { createStore } from "./db/store.ts";
import { createDefaultToolRegistry, registerPackageContributors } from "./tools/catalog.ts";

function clientKeyFrom(request: Request, address: string | null, config: ServerConfig): string {
  if (config.trustProxy) {
    const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first) return first;
  }
  return address ?? "unknown";
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const store = await createStore(config);
  const toolRegistry = createDefaultToolRegistry();
  const contributors = await registerPackageContributors(toolRegistry);
  const app = createApp({ config, store, toolRegistry, env: process.env });
  if (contributors.length > 0) {
    console.log(`[botanical] tool contributors: ${contributors.join(", ")}`);
  }
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(request, bunServer) {
      const address = bunServer.requestIP(request)?.address ?? null;
      return app.fetch(request, { clientKey: clientKeyFrom(request, address, config) });
    },
  });

  console.log(
    `Botanical server listening on http://${server.hostname}:${server.port} (${config.deploymentMode}, ${store.kind}, brand=${JSON.stringify(config.brandName)})`,
  );
  if (store.kind === "memory") {
    console.warn(
      "Persistence is in-memory. TODO: set DATABASE_URL and provide packages/db for Postgres. Data will not survive a restart.",
    );
  }

  const shutdown = () => {
    void server.stop(false).finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else if (err instanceof Error) {
      console.error(err.message);
      if (err.stack) console.error(err.stack);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
