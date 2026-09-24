import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { silentLogger } from "@botanical/mcp";
import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import { startServerMcp, type McpServersResponse } from "../src/mcp-host.ts";
import { startHttpFixture } from "../../mcp/test/fixtures/http-server.ts";
import { baseEnv, bearer, login, readJson } from "./helpers.ts";

const stdioFixture = new URL("../../mcp/test/fixtures/stdio-server.ts", import.meta.url).pathname;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "botanical-mcp-host-"));
}

async function boot(env: Record<string, string | undefined>, cwd = tempDir()) {
  const mcp = await startServerMcp({ env, cwd, logger: silentLogger });
  const app = createApp({ config: loadConfig(baseEnv()), store: createMemoryStore(), mcp });
  return { app, mcp };
}

describe("GET /api/mcp/servers", () => {
  test("requires a session and reports an empty catalog when unset", async () => {
    const { app } = await boot({});
    const anonymous = await app.fetch(new Request("http://localhost/api/mcp/servers"));
    expect(anonymous.status).toBe(401);

    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/mcp/servers", { headers: bearer(token) }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<McpServersResponse>(response);
    expect(body.source).toBe("empty");
    expect(body.servers).toEqual([]);
    expect(app.tools.list()).toEqual([]);
    await app.close();
  });

  test("a missing config file does not stop the API", async () => {
    const { app, mcp } = await boot({ BOTANICAL_MCP_CONFIG: "/no/such/botanical-mcp.json" });
    try {
      const snap = mcp.snapshot();
      expect(snap.source).toBe("error");
      expect(snap.configError).toMatch(/Cannot read MCP config/);
      expect(snap.servers).toEqual([]);
      expect(app.tools.list()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("connects Claude Desktop servers, registers tools, and keeps going when one fails", async () => {
    const fixture = startHttpFixture();
    const cwd = tempDir();
    const configPath = join(cwd, "mcp.json");
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        echo: {
          command: process.execPath,
          args: [stdioFixture],
        },
        remote: {
          type: "http",
          url: fixture.url,
        },
        broken: {
          command: "definitely-not-a-botanical-binary",
          args: ["--nope"],
        },
        down: {
          url: "http://127.0.0.1:1/mcp",
        },
      },
    }));

    const { app } = await boot(
      {
        BOTANICAL_MCP_CONFIG: configPath,
        BOTANICAL_MCP_CONNECT_TIMEOUT_MS: "2000",
      },
      cwd,
    );

    try {
      const { token } = await login(app);
      const response = await app.fetch(
        new Request("http://localhost/api/mcp/servers", { headers: bearer(token) }),
      );
      expect(response.status).toBe(200);
      const body = await readJson<McpServersResponse>(response);
      expect(body.source).toBe("file");
      expect(body.configError).toBeUndefined();

      const echo = body.servers.find((server) => server.id === "echo");
      const remote = body.servers.find((server) => server.id === "remote");
      const broken = body.servers.find((server) => server.id === "broken");
      const down = body.servers.find((server) => server.id === "down");

      expect(echo?.state).toBe("ready");
      expect(echo?.transport).toBe("stdio");
      expect(echo?.tools.map((tool) => tool.id).sort()).toEqual([
        "mcp:echo:add",
        "mcp:echo:echo",
        "mcp:echo:fail",
        "mcp:echo:probe_env",
      ]);
      expect(echo?.tools.every((tool) => tool.source === "mcp")).toBe(true);

      expect(remote?.state).toBe("ready");
      expect(remote?.transport).toBe("http");
      expect(remote?.tools.map((tool) => tool.id)).toContain("mcp:remote:echo");

      expect(broken?.state).toBe("error");
      expect(broken?.error).toBeTruthy();
      expect(broken?.tools).toEqual([]);
      expect(down?.state).toBe("error");
      expect(down?.transport).toBe("http");
      expect(down?.error).toBeTruthy();

      const ids = app.tools.list().map((tool) => tool.name);
      expect(ids).toContain("mcp:echo:echo");
      expect(ids).toContain("mcp:remote:add");
      expect(ids.some((id) => id.startsWith("mcp:broken:"))).toBe(false);
      expect(ids.some((id) => id.startsWith("mcp:down:"))).toBe(false);

      const echoed = await app.tools.execute("mcp:echo:echo", { message: "fern" });
      expect(echoed.ok).toBe(true);
      expect(echoed.content).toBe("echo:fern");

      const summed = await app.tools.execute("mcp:remote:add", { a: 2, b: 3 });
      expect(summed.ok).toBe(true);
      expect(summed.content).toBe("5");

      const viaProviderName = await app.tools.execute("mcp__echo__echo", { message: "alias" });
      expect(viaProviderName.content).toBe("echo:alias");
      expect(app.tools.get("mcp.echo.add")?.name).toBe("mcp:echo:add");
      const openAINames = app.tools.toOpenAITools().map((tool) => tool.function.name);
      expect(openAINames).toContain("mcp__echo__echo");
      expect(openAINames.some((name) => name.includes(":"))).toBe(false);

      const failed = await app.tools.execute("mcp:echo:fail", {});
      expect(failed.ok).toBe(false);
      expect(failed.error?.code).toBe("tool_failed");

      const missing = await app.tools.execute("mcp:echo:nope", {});
      expect(missing.ok).toBe(false);
      expect(missing.error?.code).toBe("unknown_tool");
    } finally {
      await app.close();
      fixture.stop();
    }
  }, 20_000);
});
