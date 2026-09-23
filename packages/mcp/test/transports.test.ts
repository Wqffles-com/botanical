import { describe, expect, test } from "bun:test";

import { createAgentToolSurface } from "../src/surface.js";
import { startMcp } from "../src/runtime.js";
import { silentLogger } from "../src/logger.js";
import { startHttpFixture } from "./fixtures/http-server.js";
import { startSseFixture } from "./fixtures/sse-server.js";

const stdioFixture = new URL("./fixtures/stdio-server.ts", import.meta.url).pathname;

function stdioServer(id: string, extraEnv?: Record<string, string>) {
  return {
    id,
    transport: "stdio" as const,
    command: process.execPath,
    args: [stdioFixture],
    ...(extraEnv ? { env: extraEnv } : {}),
  };
}

describe("MCP transports", () => {
  test("stdio lists paginated tools and calls them", async () => {
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([stdioServer("calc")]),
        PROVIDER_OPENAI_API_KEY: "sk-parent-secret",
        BOTANICAL_PASSWORD: "parent-pass",
      },
    });
    try {
      const names = mcp.tools().map((tool) => tool.canonicalName).sort();
      expect(names).toEqual([
        "mcp.calc.add",
        "mcp.calc.echo",
        "mcp.calc.fail",
        "mcp.calc.probe_env",
      ]);
      expect(mcp.promptAddendum()).toMatch(/Fixture server/);

      const echoed = await mcp.call("mcp.calc.echo", { message: "fern" });
      expect(echoed.ok).toBe(true);
      expect(echoed.content).toBe("echo:fern");

      const summed = await mcp.call("mcp__calc__add", { a: 2, b: 3 });
      expect(summed.content).toBe("5");

      const failed = await mcp.call("mcp.calc.fail", {});
      expect(failed.ok).toBe(false);
      expect(failed.content).toBe("nope");

      const probed = await mcp.call("mcp.calc.probe_env", {});
      const keys = JSON.parse(probed.content) as { keys: string[] };
      expect(keys.keys).not.toContain("PROVIDER_OPENAI_API_KEY");
      expect(keys.keys).not.toContain("BOTANICAL_PASSWORD");
    } finally {
      await mcp.close();
    }
  });

  test("stdio forwards only the configured env block", async () => {
    const previous = process.env.PROVIDER_OPENAI_API_KEY;
    process.env.PROVIDER_OPENAI_API_KEY = "sk-parent-secret";
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([stdioServer("calc", { EXPLICIT_FLAG: "yes" })]),
      },
    });
    try {
      const probed = await mcp.call("mcp.calc.probe_env", {});
      const keys = JSON.parse(probed.content) as { keys: string[] };
      expect(keys.keys).toContain("EXPLICIT_FLAG");
      expect(keys.keys).not.toContain("PROVIDER_OPENAI_API_KEY");
    } finally {
      await mcp.close();
      if (previous === undefined) delete process.env.PROVIDER_OPENAI_API_KEY;
      else process.env.PROVIDER_OPENAI_API_KEY = previous;
    }
  });

  test("streamable HTTP calls a tool and sends configured headers", async () => {
    const fixture = startHttpFixture();
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([{
          id: "remote",
          transport: "http",
          url: fixture.url,
          headers: { Authorization: "Bearer test-token" },
        }]),
      },
    });
    try {
      expect(mcp.status().servers[0]?.state).toBe("ready");
      const result = await mcp.call("mcp.remote.echo", { message: "http" });
      expect(result.content).toBe("echo:http");
      expect(fixture.headers()?.get("authorization")).toBe("Bearer test-token");
    } finally {
      await mcp.close();
      fixture.stop();
    }
  });

  test("legacy SSE calls a tool", async () => {
    const fixture = startSseFixture();
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([{
          id: "legacy",
          transport: "sse",
          url: fixture.url,
        }]),
      },
    });
    try {
      expect(mcp.status().servers[0]?.state).toBe("ready");
      const result = await mcp.call("mcp__legacy__echo", { message: "sse" });
      expect(result.content).toBe("echo:sse");
    } finally {
      await mcp.close();
      fixture.stop();
    }
  });

  test("SSE fallback recovers when streamable HTTP is not offered", async () => {
    const fixture = startSseFixture();
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([{
          id: "legacy",
          transport: "http",
          url: fixture.url,
          sseFallback: true,
        }]),
      },
    });
    try {
      expect(mcp.status().servers[0]?.state).toBe("ready");
      const result = await mcp.call("mcp.legacy.add", { a: 1, b: 1 });
      expect(result.content).toBe("2");
    } finally {
      await mcp.close();
      fixture.stop();
    }
  });

  test("one dead server does not hide a live one", async () => {
    const fixture = startHttpFixture();
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([
          { id: "missing", transport: "stdio", command: "definitely-not-a-botanical-binary" },
          { id: "remote", transport: "http", url: fixture.url },
        ]),
      },
    });
    try {
      const status = mcp.status().servers;
      expect(status.find((server) => server.id === "missing")?.state).toBe("error");
      expect(status.find((server) => server.id === "remote")?.state).toBe("ready");
      const surface = createAgentToolSurface({
        builtins: [{
          name: "web_search",
          async execute() { return "web"; },
        }],
        mcp,
        modelSupportsTools: true,
      });
      const names = surface.definitions().map((tool) => tool.name);
      expect(names).toContain("web_search");
      expect(names).toContain("mcp__remote__echo");
      const result = await surface.execute("mcp__remote__echo", { message: "both" });
      expect(result.content).toBe("echo:both");
      expect(surface.warnings().some((warning) => warning.includes("missing"))).toBe(true);
    } finally {
      await mcp.close();
      fixture.stop();
    }
  });

  test("a disabled server is not spawned", async () => {
    const mcp = await startMcp({
      logger: silentLogger,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([{
          id: "off",
          transport: "stdio",
          command: "definitely-not-a-botanical-binary",
          enabled: false,
        }]),
      },
    });
    try {
      expect(mcp.status().servers[0]?.state).toBe("disabled");
      expect(mcp.tools()).toEqual([]);
      expect(mcp.warnings()).toEqual([]);
    } finally {
      await mcp.close();
    }
  });
});
