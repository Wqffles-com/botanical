import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { BUILTIN_ROLE_IDS, type ToolContributor } from "@botanical/agent-runtime";
import { runAsUser } from "@botanical/db";
import { clearCliAvailabilityCache } from "@botanical/providers";

import { agentWorkspace } from "../src/runtime/workspace.ts";
import { CLI_MCP_PATH } from "../src/cli-mcp.ts";
import { createDefaultToolRegistry } from "../src/tools/catalog.ts";
import { bearer, login, readJson, setup , ECHO_PROFILE } from "./helpers.ts";

const fixture = fileURLToPath(new URL("../../providers/test/fixtures/fake-cli.ts", import.meta.url));
chmodSync(fixture, 0o755);

function rpc(
  app: ReturnType<typeof setup>["app"],
  runId: string,
  token: string | null,
  body: unknown,
  extra?: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${CLI_MCP_PATH}/${runId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signIn(app: ReturnType<typeof setup>["app"], email?: string): Promise<{ token: string; userId: string }> {
  const { token } = await login(app, undefined, email ? { email } : undefined);
  const me = await readJson<{ user: { id: string } }>(
    await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) })),
  );
  return { token, userId: me.user.id };
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

describe("per-run CLI MCP", () => {
  test("auth, initialize, role-filtered list, memory call, and revocation", async () => {
    const { app, store: shared } = setup();
    const { token, userId } = await signIn(app);
    const store = shared.forUser(userId);
    const ada = await store.agents.create({
      name: "Ada",
      description: "",
      systemPrompt: "Ada",
      toolIds: ["memory_write", "memory_search", "file_read"],
    });
    const chat = await store.chats.create({ agentId: ada.id, profileId: "grok", title: "CLI" });
    const session = app.cliTools.open({ agentId: ada.id, chatId: chat.id, userId });

    expect((await rpc(app, session.runId, null, initialize)).status).toBe(401);
    expect((await rpc(app, session.runId, "not-the-token", initialize)).status).toBe(401);
    expect((await rpc(app, "00000000-0000-4000-8000-000000000099", session.token, initialize)).status).toBe(404);

    const probe = await app.fetch(
      new Request(`http://localhost${CLI_MCP_PATH}/${session.runId}`, {
        method: "GET",
        headers: { authorization: `Bearer ${session.token}`, accept: "text/event-stream" },
      }),
    );
    expect(probe.status).toBe(405);

    const init = await readJson<{ result: { protocolVersion: string; serverInfo: { name: string } } }>(
      await rpc(app, session.runId, session.token, initialize),
    );
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.serverInfo.name).toBe("botanical");

    const noted = await rpc(app, session.runId, session.token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(noted.status).toBe(202);

    const ping = await readJson<{ result: Record<string, never> }>(
      await rpc(app, session.runId, session.token, { jsonrpc: "2.0", id: 2, method: "ping" }),
    );
    expect(ping.result).toEqual({});

    const listed = await readJson<{ result: { tools: { name: string }[] } }>(
      await rpc(app, session.runId, session.token, { jsonrpc: "2.0", id: 3, method: "tools/list" }),
    );
    const names = listed.result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["file_read", "memory_search", "memory_write", "send_message"]);

    const called = await readJson<{ result: { isError: boolean; content: { text: string }[] } }>(
      await rpc(app, session.runId, session.token, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "memory_write", arguments: { scope: "agent", content: "fern from mcp" } },
      }),
    );
    expect(called.result.isError).toBe(false);
    const memoryId = JSON.parse(called.result.content[0]?.text ?? "{}").id as string;
    const memory = await store.memories.get(memoryId);
    expect(memory?.agentId).toBe(ada.id);
    expect(memory?.content).toBe("fern from mcp");

    const reviewer = await store.agents.create({
      name: "Rev",
      description: "",
      systemPrompt: "Read only.",
      toolIds: ["memory_write", "memory_search", "file_read", "shell"],
      roleIds: [BUILTIN_ROLE_IDS.Reviewer],
    });
    const denied = app.cliTools.open({ agentId: reviewer.id, chatId: chat.id, userId });
    const deniedList = await readJson<{ result: { tools: { name: string }[] } }>(
      await rpc(app, denied.runId, denied.token, { jsonrpc: "2.0", id: 5, method: "tools/list" }),
    );
    const deniedNames = deniedList.result.tools.map((tool) => tool.name);
    expect(deniedNames).toContain("memory_search");
    expect(deniedNames).toContain("file_read");
    expect(deniedNames).not.toContain("memory_write");
    expect(deniedNames).not.toContain("shell");

    const blocked = await readJson<{ result: { isError: boolean; content: { text: string }[] } }>(
      await rpc(app, denied.runId, denied.token, {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "memory_write", arguments: { scope: "agent", content: "should not stick" } },
      }),
    );
    expect(blocked.result.isError).toBe(true);
    expect(blocked.result.content[0]?.text).toContain("permission denied");
    expect(blocked.result.content[0]?.text).toContain("memory.write");
    const visible = await store.memories.listVisible(reviewer.id, { limit: 20 });
    expect(visible.some((row) => row.content === "should not stick")).toBe(false);

    const cookieOnly = await app.fetch(
      new Request(`http://localhost${CLI_MCP_PATH}/${session.runId}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `botanical_session=${token}` },
        body: JSON.stringify(initialize),
      }),
    );
    expect(cookieOnly.status).toBe(401);

    session.close();
    denied.close();
    expect(app.cliTools.size()).toBe(0);
    expect((await rpc(app, session.runId, session.token, initialize)).status).toBe(404);
  });

  test("user MCP tools use model-facing names and the same dispatch", async () => {
    const registry = createDefaultToolRegistry();
    const notes: ToolContributor = {
      id: "test.notes",
      source: "mcp",
      listTools() {
        return [
          {
            id: "mcp.notes.search",
            name: "search",
            description: "Search notes",
            parameters: { type: "object", properties: { q: { type: "string" } } },
            source: "mcp",
            serverId: "notes",
          },
        ];
      },
      async callTool(toolId) {
        return { content: `called ${toolId}`, isError: false };
      },
    };
    registry.register(notes);
    const { app, store: shared } = setup({}, { toolRegistry: registry, installPlatformTools: true });
    const { userId } = await signIn(app);
    const store = shared.forUser(userId);
    const ada = await store.agents.create({
      name: "Ada",
      description: "",
      systemPrompt: "Ada",
      toolIds: ["mcp.notes.search", "memory_write"],
    });
    const chat = await store.chats.create({ agentId: ada.id, profileId: "grok", title: "notes" });
    const session = app.cliTools.open({ agentId: ada.id, chatId: chat.id, userId });
    const listed = await readJson<{ result: { tools: { name: string }[] } }>(
      await rpc(app, session.runId, session.token, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual(["mcp__notes__search", "memory_write", "send_message"]);
    const called = await readJson<{ result: { isError: boolean; content: { text: string }[] } }>(
      await rpc(app, session.runId, session.token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "mcp__notes__search", arguments: { q: "fern" } },
      }),
    );
    expect(called.result.isError).toBe(false);
    expect(called.result.content[0]?.text).toBe("called mcp.notes.search");
    session.close();
  });

  test("a run is scoped to its user, and a missing agent is an error, not an empty list", async () => {
    const { app, store: shared } = setup();
    const owner = await signIn(app);
    const member = await signIn(app, "member@example.com");
    const store = shared.forUser(member.userId);
    const fern = await store.agents.create({
      name: "Fern",
      description: "",
      systemPrompt: "Fern",
      toolIds: ["memory_write", "memory_search"],
    });
    const chat = await store.chats.create({ agentId: fern.id, profileId: "grok", title: "CLI" });

    expect(() => app.cliTools.open({ agentId: fern.id, chatId: chat.id, userId: " " })).toThrow(/acting user/);
    expect(app.cliTools.size()).toBe(0);

    const session = app.cliTools.open({ agentId: fern.id, chatId: chat.id, userId: member.userId });
    const listed = await readJson<{ result: { tools: { name: string }[] } }>(
      await rpc(app, session.runId, session.token, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual(["memory_search", "memory_write", "send_message"]);
    const called = await readJson<{ result: { isError: boolean; content: { text: string }[] } }>(
      await rpc(app, session.runId, session.token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "memory_write", arguments: { scope: "agent", content: "member fern" } },
      }),
    );
    expect(called.result.isError).toBe(false);
    const memories = await store.memories.listVisible(fern.id, { limit: 10 });
    expect(memories.some((memory) => memory.content === "member fern")).toBe(true);

    // The owner's scope cannot see the member's agent.
    const foreign = app.cliTools.open({ agentId: fern.id, chatId: chat.id, userId: owner.userId });
    const missing = await readJson<{ error?: { code: number; message: string }; result?: unknown }>(
      await rpc(app, foreign.runId, foreign.token, { jsonrpc: "2.0", id: 3, method: "tools/list" }),
    );
    expect(missing.result).toBeUndefined();
    expect(missing.error?.code).toBe(-32603);
    expect(missing.error?.message).toContain("not found");

    session.close();
    foreign.close();
  });

  test("a CLI turn calls memory through the endpoint and revokes the token", async () => {
    clearCliAvailabilityCache();
    const previousMode = process.env.FAKE_CLI_MODE;
    const previousUrl = process.env.BOTANICAL_INTERNAL_URL;
    const previousHome = process.env.BOTANICAL_CLI_HOME;
    // A throwaway CLI home with a credential file, so availability does not
    // depend on the machine running the tests.
    const cliHome = mkdtempSync(join(tmpdir(), "botanical-cli-home-"));
    mkdirSync(join(cliHome, ".grok"), { recursive: true });
    writeFileSync(join(cliHome, ".grok", "auth.json"), '{"test":true}\n');
    process.env.BOTANICAL_CLI_HOME = cliHome;
    process.env.FAKE_CLI_MODE = "mcp-call";
    const profiles = [
      ECHO_PROFILE,
      { id: "grok-build", kind: "cli", cli: "grok", label: "Grok Build", bin: fixture, timeoutMs: 20_000 },
    ];
    const { app, store } = setup({ BOTANICAL_PROFILES: JSON.stringify(profiles) });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => app.fetch(request),
    });
    process.env.BOTANICAL_INTERNAL_URL = `http://127.0.0.1:${server.port}`;
    try {
      // The first account owns legacy rows. The turn runs as a second user (issue #92).
      await signIn(app);
      const { token, userId } = await signIn(app, "member@example.com");
      const headers = { "content-type": "application/json", ...bearer(token) };
      const agentResponse = await app.fetch(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Ada",
            prompt: "Be brief.",
            tools: ["memory_write", "memory_search"],
          }),
        }),
      );
      expect(agentResponse.status).toBe(201);
      const agentId = (await readJson<{ agent: { id: string } }>(agentResponse)).agent.id;
      const chatResponse = await app.fetch(
        new Request("http://localhost/api/chats", {
          method: "POST",
          headers,
          body: JSON.stringify({ agentId, profileId: "grok-build" }),
        }),
      );
      expect(chatResponse.status).toBe(201);
      const chatId = (await readJson<{ chat: { id: string } }>(chatResponse)).chat.id;
      const posted = await app.fetch(
        new Request(`http://localhost/api/chats/${chatId}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: "Remember the fern.", profileId: "grok-build", stream: false }),
        }),
      );
      if (posted.status !== 201) throw new Error(`${posted.status} ${await posted.text()}`);
      const messages = await readJson<{ messages: { role: string; content: string; name?: string }[] }>(
        await app.fetch(new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) })),
      );
      const assistant = messages.messages.find((message) => message.role === "assistant");
      expect(assistant?.content).toContain("CALL_OK");
      expect(assistant?.content).toContain("HAS_MEMORY:yes");
      const tool = messages.messages.find((message) => message.role === "tool");
      expect(tool?.name).toBe("memory_write");
      expect(tool?.content).toContain("\"id\"");
      expect(assistant?.content).toContain("PROMPT_TOOLS:send_message, memory_write, memory_search");
      const memories = await runAsUser(userId, () => store.memories.listVisible(agentId, { limit: 10 }));
      expect(memories.some((memory) => memory.content === "fern from cli" && memory.agentId === agentId)).toBe(true);
      const runId = /RUN_ID:([^\s]+)/.exec(assistant?.content ?? "")?.[1] ?? "";
      expect(runId.length).toBeGreaterThan(0);
      expect(app.cliTools.size()).toBe(0);
      const revoked = await app.fetch(
        new Request(`http://localhost${CLI_MCP_PATH}/${runId}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer revoked-token" },
          body: JSON.stringify(initialize),
        }),
      );
      expect(revoked.status).toBe(404);
      expect(existsSync(`${agentWorkspace(agentId)}/.grok/config.toml`)).toBe(false);
    } finally {
      server.stop(true);
      if (previousMode === undefined) delete process.env.FAKE_CLI_MODE;
      else process.env.FAKE_CLI_MODE = previousMode;
      if (previousUrl === undefined) delete process.env.BOTANICAL_INTERNAL_URL;
      else process.env.BOTANICAL_INTERNAL_URL = previousUrl;
      if (previousHome === undefined) delete process.env.BOTANICAL_CLI_HOME;
      else process.env.BOTANICAL_CLI_HOME = previousHome;
      rmSync(cliHome, { recursive: true, force: true });
      clearCliAvailabilityCache();
    }
  });

  test("an agent with no tools still gets the MCP endpoint for send_message", async () => {
    clearCliAvailabilityCache();
    const previousMode = process.env.FAKE_CLI_MODE;
    const previousHome = process.env.BOTANICAL_CLI_HOME;
    const cliHome = mkdtempSync(join(tmpdir(), "botanical-cli-home-"));
    mkdirSync(join(cliHome, ".grok"), { recursive: true });
    writeFileSync(join(cliHome, ".grok", "auth.json"), '{"test":true}\n');
    process.env.BOTANICAL_CLI_HOME = cliHome;
    process.env.FAKE_CLI_MODE = "capture";
    const profiles = [
      ECHO_PROFILE,
      { id: "grok-build", kind: "cli", cli: "grok", label: "Grok Build", bin: fixture, timeoutMs: 20_000 },
    ];
    const { app } = setup({ BOTANICAL_PROFILES: JSON.stringify(profiles) });
    try {
      const { token } = await login(app);
      const headers = { "content-type": "application/json", ...bearer(token) };
      const agentId = (
        await readJson<{ agent: { id: string } }>(
          await app.fetch(
            new Request("http://localhost/api/agents", {
              method: "POST",
              headers,
              body: JSON.stringify({ name: "Bare", prompt: "Be brief.", tools: [] }),
            }),
          ),
        )
      ).agent.id;
      const chatId = (
        await readJson<{ chat: { id: string } }>(
          await app.fetch(
            new Request("http://localhost/api/chats", {
              method: "POST",
              headers,
              body: JSON.stringify({ agentId, profileId: "grok-build" }),
            }),
          ),
        )
      ).chat.id;
      const posted = await app.fetch(
        new Request(`http://localhost/api/chats/${chatId}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: "Message Jan.", profileId: "grok-build", stream: false }),
        }),
      );
      if (posted.status !== 201) throw new Error(`${posted.status} ${await posted.text()}`);
      const messages = await readJson<{ messages: { role: string; content: string }[] }>(
        await app.fetch(new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) })),
      );
      const assistant = messages.messages.find((message) => message.role === "assistant");
      // send_message is every agent's tool, so the CLI always gets the endpoint.
      expect(assistant?.content).toContain("CONFIG:yes");
      expect(assistant?.content).toContain("TOKEN_ENV:ok");
      expect(app.cliTools.size()).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.FAKE_CLI_MODE;
      else process.env.FAKE_CLI_MODE = previousMode;
      if (previousHome === undefined) delete process.env.BOTANICAL_CLI_HOME;
      else process.env.BOTANICAL_CLI_HOME = previousHome;
      rmSync(cliHome, { recursive: true, force: true });
      clearCliAvailabilityCache();
    }
  });
});
