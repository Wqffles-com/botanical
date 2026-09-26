import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  createToolRegistry,
  registerBuiltinTools,
  resolveWorkspaceDir,
  type AgentToAgentService,
} from "../src/tools/index.ts";
import { bearer, login, readJson, setup } from "./helpers.ts";

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "botanical-tools-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const quietEnv = {
  BOTANICAL_SEARCH_PROVIDER: "stub",
} as Record<string, string | undefined>;

function registryIn(
  root: string,
  extra: { agentMessages?: AgentToAgentService; maxOutputChars?: number } = {},
) {
  const registry = createToolRegistry();
  registerBuiltinTools(registry, {
    workspaceRoot: root,
    env: quietEnv,
    ...(extra.maxOutputChars ? { maxOutputChars: extra.maxOutputChars } : {}),
    ...(extra.agentMessages ? { agentMessages: extra.agentMessages } : {}),
  });
  return registry;
}

const ctx = { agentId: "agent-alpha", chatId: "chat-1" };

describe("workspace jail", () => {
  test("defaults to ./data/workspace and honors BOTANICAL_WORKSPACE", () => {
    expect(resolveWorkspaceDir(undefined, {}, "/srv")).toBe("/srv/data/workspace");
    expect(resolveWorkspaceDir(undefined, { BOTANICAL_WORKSPACE: "rel/ws" }, "/srv")).toBe("/srv/rel/ws");
    expect(resolveWorkspaceDir(undefined, { BOTANICAL_WORKSPACE: "/data/workspace" }, "/srv")).toBe(
      "/data/workspace",
    );
    expect(resolveWorkspaceDir("/explicit", { BOTANICAL_WORKSPACE: "/other" }, "/srv")).toBe("/explicit");
    expect(resolveWorkspaceDir(undefined, { BOTANICAL_WORKSPACE_ROOT: "/legacy" }, "/srv")).toBe("/legacy");
  });
});

describe("built-in tool registry", () => {
  test("registers file, shell, web, and send_agent_message contributors", async () => {
    const registry = registryIn(scratch());
    const tools = await registry.list();
    expect(tools.map((tool) => tool.id)).toEqual([
      "file_read",
      "file_write",
      "file_list",
      "shell",
      "code_exec",
      "web_search",
      "web_fetch",
      "send_agent_message",
    ]);
    expect(registerBuiltinTools(registry, { workspaceRoot: scratch(), env: quietEnv })).toEqual([
      "builtin.files",
      "builtin.shell",
      "builtin.web",
      "builtin.a2a",
    ]);
    expect((await registry.list()).map((tool) => tool.id)).toHaveLength(8);

    const fileRead = tools.find((tool) => tool.id === "file_read");
    expect(fileRead?.parameters.type).toBe("object");
    expect(fileRead?.source).toBe("builtin");
    expect(fileRead?.requiresApproval).toBe(false);
    expect(fileRead?.risk).toBe("read");
    expect(fileRead?.description).toContain("UTF-8");
    expect(fileRead?.description).toContain("Limits:");
    expect((fileRead?.parameters.required ?? []) as string[]).toContain("path");
    expect(tools.find((tool) => tool.id === "shell")?.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.id === "shell")?.risk).toBe("execute");
    expect((tools.find((tool) => tool.id === "shell")?.parameters.required ?? []) as string[]).toContain("command");
    expect(tools.find((tool) => tool.id === "code_exec")?.requiresApproval).toBe(true);
    expect((tools.find((tool) => tool.id === "web_search")?.parameters.required ?? []) as string[]).toContain("query");
    expect(tools.find((tool) => tool.id === "web_search")?.risk).toBe("network");
    expect((tools.find((tool) => tool.id === "send_agent_message")?.parameters.required ?? []) as string[]).toEqual([
      "body",
    ]);
    expect(tools.find((tool) => tool.id === "file_write")?.requiresApproval).toBe(true);
    expect(tools.some((tool) => tool.id === "file_delete")).toBe(false);
  });

  test("reads, writes, and lists only inside the workspace", async () => {
    const root = scratch();
    const registry = registryIn(root);
    const write = await registry.call("file_write", { path: "notes/plot.txt", content: "garden\n" }, ctx);
    expect(write.isError).toBeFalsy();
    expect(write.content).not.toContain(root);

    const read = await registry.call("file_read", { path: "notes/plot.txt" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.content).toContain("garden");

    const listed = await registry.call("file_list", { path: ".", recursive: true }, ctx);
    expect(listed.isError).toBeFalsy();
    expect(listed.content).toContain("plot.txt");

    const escaped = await registry.call("file_read", { path: "../outside.txt" }, ctx);
    expect(escaped.isError).toBe(true);
    expect(escaped.content).toContain("escapes");
  });

  test("truncates tool text to the registry cap", async () => {
    const registry = registryIn(scratch(), { maxOutputChars: 80 });
    const write = await registry.call("file_write", { path: "big.txt", content: "x".repeat(400) }, ctx);
    expect(write.isError).toBeFalsy();
    const read = await registry.call("file_read", { path: "big.txt" }, ctx);
    expect(read.isError).toBeFalsy();
    expect(read.truncated).toBe(true);
    expect(read.content.length).toBeLessThanOrEqual(80);
    expect(read.content).toContain("[output truncated to 80 characters]");
  });

  test("shell and code_exec run inside the jail", async () => {
    const root = scratch();
    const registry = registryIn(root);
    const echoed = await registry.call("shell", { command: "echo botanical-shell" }, ctx);
    expect(echoed.isError).toBeFalsy();
    expect(echoed.content).toContain("botanical-shell");
    expect(echoed.content).not.toContain(root);

    const code = await registry.call(
      "code_exec",
      { language: "javascript", code: "console.log('botanical-code')" },
      ctx,
    );
    expect(code.isError).toBeFalsy();
    expect(code.content).toContain("botanical-code");
    expect(code.content).not.toContain(root);
  }, 30_000);

  test("web_search does not call the network when search is unconfigured", async () => {
    let fetches = 0;
    const registry = createToolRegistry();
    registerBuiltinTools(registry, {
      workspaceRoot: scratch(),
      env: {},
      fetch: async () => {
        fetches += 1;
        throw new Error("network should not be used");
      },
    });
    const result = await registry.call("web_search", { query: "botanical agents" }, ctx);
    expect(fetches).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not configured");
    expect(result.content).toContain("botanical agents");
  });

  test("web_fetch extracts text through the injected client and blocks private URLs", async () => {
    const calls: string[] = [];
    const registry = createToolRegistry();
    registerBuiltinTools(registry, {
      workspaceRoot: scratch(),
      env: {},
      dnsLookup: async () => ["93.184.216.34"],
      fetch: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        return new Response(
          "<html><head><title>Acme</title></head><body><article><h1>Guide</h1><p>Hello garden.</p></article></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      },
    });
    const page = await registry.call("web_fetch", { url: "https://example.com/guide" }, ctx);
    expect(page.isError).toBeFalsy();
    expect(page.content).toContain("Guide");
    expect(page.content).toContain("Hello garden.");
    expect(calls).toEqual(["https://example.com/guide"]);

    const blocked = await registry.call("web_fetch", { url: "http://127.0.0.1/secret" }, ctx);
    expect(blocked.isError).toBe(true);
    expect(calls).toEqual(["https://example.com/guide"]);
  });

  test("send_agent_message calls the A2A service with the turn's sender", async () => {
    const sent: Array<{ fromAgentId: string; toAgentId?: string; toAgentName?: string; body: string; fromChatId?: string }> = [];
    const service: AgentToAgentService = {
      async send(input) {
        sent.push(input);
        return { id: "msg-1", toAgentId: input.toAgentId ?? "agent-by-name", status: "pending" };
      },
    };
    const registry = registryIn(scratch(), { agentMessages: service });
    const spoofed = await registry.call(
      "send_agent_message",
      { toAgentId: "agent-beta", body: "Check the beds.", fromAgentId: "someone-else" },
      ctx,
    );
    expect(spoofed.isError).toBeFalsy();
    expect(spoofed.content).toContain("msg-1");
    expect(spoofed.content).toContain("agent-beta");
    expect(sent).toEqual([
      { fromAgentId: "agent-alpha", toAgentId: "agent-beta", body: "Check the beds.", fromChatId: "chat-1" },
    ]);

    const byName = await registry.call(
      "send_agent_message",
      { toAgentName: "Sage", body: "Water the ferns." },
      ctx,
    );
    expect(byName.isError).toBeFalsy();
    expect(sent[1]).toMatchObject({ fromAgentId: "agent-alpha", toAgentName: "Sage", body: "Water the ferns." });

    const missing = await registry.call(
      "send_agent_message",
      { toAgentId: "agent-beta", body: "nope" },
      { agentId: "  ", chatId: "chat-1" },
    );
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("sender");
    expect(sent).toHaveLength(2);

    const unconfigured = registryIn(scratch());
    const refused = await unconfigured.call("send_agent_message", { toAgentId: "agent-beta", body: "hello" }, ctx);
    expect(refused.isError).toBe(true);
    expect(refused.content).toContain("not configured");
  });

  test("tool sources list builtins and return model text", async () => {
    const root = scratch();
    const registry = registryIn(root);
    await registry.call("file_write", { path: "note.txt", content: "leaf" }, ctx);
    const sources = registry.toToolSources((call) => ({ ...call, workspaceRoot: root }));
    const listed = (await Promise.all(sources.map((source) => source.listTools()))).flat();
    expect(listed.find((tool) => tool.name === "file_read")?.origin).toBe("builtin");
    const files = sources.find((source) => source.id === "builtin.files");
    const result = await files!.call("file_read", { path: "note.txt" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("leaf");
    const missing = await files!.call("nope", {}, ctx);
    expect(missing.isError).toBe(true);
  });
});

describe("GET /api/tools", () => {
  test("requires auth and lists builtins with source", async () => {
    const { app } = setup();
    const anonymous = await app.fetch(new Request("http://localhost/api/tools"));
    expect(anonymous.status).toBe(401);

    const { token } = await login(app);
    const response = await app.fetch(
      new Request("http://localhost/api/tools", { headers: bearer(token) }),
    );
    expect(response.status).toBe(200);
    const body = await readJson<{ tools: Array<Record<string, unknown>> }>(response);
    const fileRead = body.tools.find((tool) => tool.id === "file_read");
    expect(fileRead?.source).toBe("builtin");
    expect(fileRead).not.toHaveProperty("execute");
    expect(body.tools.map((tool) => tool.id)).toContain("send_agent_message");
    expect(body.tools.map((tool) => tool.id)).toContain("shell");
    expect(body.tools.map((tool) => tool.id)).toContain("web_fetch");
  });

  test("the HTTP catalog includes shell and web tools", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const response = await app.fetch(new Request("http://localhost/api/tools", { headers: bearer(token) }));
    const body = await readJson<{ tools: Array<{ id: string; source: string }> }>(response);
    const codeExec = body.tools.find((tool) => tool.id === "code_exec");
    expect(codeExec?.source).toBe("builtin");
    expect(body.tools.map((tool) => tool.id)).toContain("shell");
    expect(body.tools.map((tool) => tool.id)).toContain("web_fetch");
  });
});
