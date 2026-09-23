import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { loadMcpConfig } from "../src/config.js";
import { McpConfigError } from "../src/errors.js";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "botanical-mcp-"));
}

describe("loadMcpConfig", () => {
  test("reads a JSON file and expands placeholders", () => {
    const cwd = dir();
    mkdirSync(join(cwd, "config"));
    writeFileSync(join(cwd, "config", "mcp.json"), JSON.stringify({
      servers: [
        {
          id: "docs",
          transport: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer ${DOCS_MCP_TOKEN}" },
        },
        {
          id: "local",
          transport: "stdio",
          command: "bun",
          args: ["${BOTANICAL_WORKSPACE:-/workspace}"],
        },
      ],
    }));

    const loaded = loadMcpConfig({
      cwd,
      env: { DOCS_MCP_TOKEN: "sekret" },
    });

    expect(loaded.source).toBe("file");
    expect(loaded.servers).toHaveLength(2);
    const docs = loaded.servers[0];
    if (docs?.transport !== "http") throw new Error("expected http");
    expect(docs.headers?.Authorization).toBe("Bearer sekret");
    const local = loaded.servers[1];
    if (local?.transport !== "stdio") throw new Error("expected stdio");
    expect(local.args).toEqual(["/workspace"]);
  });

  test("env JSON overrides the file", () => {
    const cwd = dir();
    mkdirSync(join(cwd, "config"));
    writeFileSync(join(cwd, "config", "mcp.json"), JSON.stringify({
      servers: [{ id: "fromFile", transport: "stdio", command: "true" }],
    }));
    const loaded = loadMcpConfig({
      cwd,
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([
          { id: "fromEnv", transport: "sse", url: "http://127.0.0.1:9/sse" },
        ]),
      },
    });
    expect(loaded.source).toBe("env");
    expect(loaded.servers.map((server) => server.id)).toEqual(["fromEnv"]);
  });

  test("an explicit missing file fails boot", () => {
    expect(() => loadMcpConfig({
      cwd: dir(),
      env: { BOTANICAL_MCP_CONFIG: "/no/such/mcp.json" },
    })).toThrow(McpConfigError);
  });

  test("no file and no env is an empty catalog", () => {
    const loaded = loadMcpConfig({ cwd: dir(), env: {} });
    expect(loaded.source).toBe("empty");
    expect(loaded.servers).toEqual([]);
  });

  test("disabled skips servers", () => {
    const loaded = loadMcpConfig({
      cwd: dir(),
      env: {
        BOTANICAL_MCP_DISABLED: "true",
        BOTANICAL_MCP_SERVERS: JSON.stringify([{ id: "x", transport: "stdio", command: "true" }]),
      },
    });
    expect(loaded.disabled).toBe(true);
    expect(loaded.servers).toEqual([]);
  });

  test("unset placeholders fail and name the variable", () => {
    const cwd = dir();
    writeFileSync(join(cwd, "mcp.json"), JSON.stringify({
      servers: [{
        id: "docs",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer ${MISSING_TOKEN}" },
      }],
    }));
    expect(() => loadMcpConfig({ cwd, env: {} })).toThrow(/MISSING_TOKEN/);
  });

  test("rejects duplicate ids and bad transports", () => {
    expect(() => loadMcpConfig({
      cwd: dir(),
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([
          { id: "same", transport: "stdio", command: "true" },
          { id: "same", transport: "stdio", command: "true" },
        ]),
      },
    })).toThrow(/Duplicate/);

    expect(() => loadMcpConfig({
      cwd: dir(),
      env: { BOTANICAL_MCP_SERVERS: JSON.stringify([{ id: "x", transport: "websocket", command: "true" }]) },
    })).toThrow(/transport/);
  });

  test("accepts the streamable-http alias and rejects non-http URLs", () => {
    const loaded = loadMcpConfig({
      cwd: dir(),
      env: {
        BOTANICAL_MCP_SERVERS: JSON.stringify([
          { id: "remote", transport: "streamable-http", url: "https://example.test/mcp" },
        ]),
      },
    });
    expect(loaded.servers[0]?.transport).toBe("http");

    expect(() => loadMcpConfig({
      cwd: dir(),
      env: { BOTANICAL_MCP_SERVERS: JSON.stringify([{ id: "files", transport: "http", url: "file:///tmp/x" }]) },
    })).toThrow(/http or https/);
  });
});
