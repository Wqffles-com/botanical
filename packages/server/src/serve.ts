#!/usr/bin/env bun
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type ServerConfig } from "./config.ts";
import { createStore } from "./db/store.ts";
import { startServerMcp } from "./mcp-host.ts";

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
  const mcp = await startServerMcp({ env: process.env });
  const app = createApp({ config, store, mcp });
  const mcpStatus = mcp.snapshot();
  if (mcpStatus.configError) {
    console.error(`MCP config error: ${mcpStatus.configError}`);
  } else {
    const ready = mcpStatus.servers.filter((server) => server.state === "ready").length;
    const failed = mcpStatus.servers.filter((server) => server.state === "error").length;
    console.log(
      `MCP ${mcpStatus.source}: ${ready} connected, ${failed} failed, ${app.tools.list().length} tools`,
    );
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
    void app.close().finally(() => {
      void server.stop(false).finally(() => process.exit(0));
    });
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
