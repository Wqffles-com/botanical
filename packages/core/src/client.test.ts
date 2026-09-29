import { describe, expect, test } from "bun:test";
import { BotanicalClient } from "./client";
import { isAgentChat, isCompactionMessage } from "./chats";
import { AgentRequiredError, ProfileRequiredError } from "./errors";
import { normalizeAgent, normalizeProfile } from "./normalize";

interface Call {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

function startStub() {
  const calls: Call[] = [];
  let token = "";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const bodyText = request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
      const body = bodyText ? (JSON.parse(bodyText) as unknown) : null;
      calls.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get("authorization"),
        body,
      });
      const auth = request.headers.get("authorization");
      const allowed = url.pathname === "/api/health" || url.pathname === "/api/auth/login" || auth === `Bearer ${token}`;
      if (!allowed) return Response.json({ error: "Sign in." }, { status: 401 });

      if (url.pathname === "/api/health") {
        return Response.json({ ok: true, mode: "SELF_HOST", version: "0" });
      }
      if (url.pathname === "/api/auth/login") {
        const password = body && typeof body === "object" ? (body as { password?: string }).password : "";
        if (password !== "sprout") return Response.json({ error: "That passcode was not accepted." }, { status: 401 });
        token = "secret-token";
        return Response.json({ token, expiresAt: null, mode: "self-host" });
      }
      if (url.pathname === "/api/auth/me") return Response.json({ authenticated: true, mode: "SAAS" });
      if (url.pathname === "/api/auth/logout") return new Response(null, { status: 204 });
      if (url.pathname === "/api/profiles") {
        return Response.json({
          profiles: [{ id: "grok", name: "Grok", provider: "xai", model_id: "grok-4" }],
        });
      }
      if (url.pathname === "/api/agents" && request.method === "POST") {
        const input = body as {
          name: string;
          systemPrompt?: string;
          prompt?: string;
          toolIds?: string[];
          tools?: string[];
          icon?: string;
          color?: string;
          defaultProfileId?: string | null;
        };
        return Response.json({
          id: "agent-1",
          name: input.name,
          description: "",
          system_prompt: input.systemPrompt ?? input.prompt ?? "",
          tool_ids: input.toolIds ?? input.tools ?? [],
          icon: input.icon,
          color: input.color,
          defaultProfileId: input.defaultProfileId ?? null,
          created_at: "2026-09-23T00:00:00.000Z",
        });
      }
      if (url.pathname === "/api/agents/agent-1" && request.method === "PATCH") {
        const input = body as { icon?: string; color?: string; prompt?: string };
        return Response.json({
          id: "agent-1",
          name: "Research",
          icon: input.icon ?? "Bot",
          color: input.color ?? "green",
          prompt: input.prompt ?? "Look it up.",
          tools: ["web_search"],
          created_at: "2026-09-23T00:00:00.000Z",
        });
      }
      if (url.pathname === "/api/chats" && request.method === "POST") {
        const input = body as { agentId?: string; profileId?: string; title?: string };
        if (!input.profileId) return Response.json({ error: "profile required" }, { status: 400 });
        if (!input.agentId) return Response.json({ error: "agent required" }, { status: 400 });
        return Response.json({
          chat: {
            id: "chat-1",
            agent_id: input.agentId,
            profile_id: input.profileId,
            title: input.title ?? "",
            created_at: "2026-09-23T00:00:00.000Z",
          },
        });
      }
      if (url.pathname === "/api/chats/chat-1" && request.method === "PATCH") {
        return new Response(null, { status: 405 });
      }
      if (url.pathname === "/api/chats/chat-1/messages" && request.method === "POST") {
        const input = body as { profileId?: string; content?: string };
        if (!input.profileId) return Response.json({ message: "Choose a model profile." }, { status: 400 });
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: text-delta\ndata: {"text":"Hel"}\n\n'));
            controller.enqueue(encoder.encode('event: text-delta\ndata: {"text":"lo"}\n\n'));
            controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ error: "missing" }, { status: 404 });
    },
  });
  return { server, calls, url: `http://127.0.0.1:${server.port}` };
}

describe("BotanicalClient", () => {
  test("refuses to create a chat or send a message without an explicit profile", async () => {
    const { server, calls, url } = startStub();
    try {
      const client = new BotanicalClient({ baseUrl: url, getToken: () => "secret-token" });
      await expect(client.createChat({ agentId: "agent-1", profileId: "  " })).rejects.toBeInstanceOf(
        ProfileRequiredError,
      );
      await expect(client.createChat({ agentId: " ", profileId: "grok" })).rejects.toBeInstanceOf(AgentRequiredError);
      await expect(client.streamMessage("chat-1", { content: "Hi", profileId: "" }).next()).rejects.toBeInstanceOf(
        ProfileRequiredError,
      );
      expect(calls).toHaveLength(0);
    } finally {
      server.stop(true);
    }
  });

  test("logs in, stores the bearer token on later calls, and streams SSE", async () => {
    const { server, calls, url } = startStub();
    try {
      let token = "";
      const client = new BotanicalClient({ baseUrl: url, getToken: () => token });
      const session = await client.login({ email: "ada@example.com", password: "sprout" });
      expect(session.token).toBe("secret-token");
      expect(session.mode).toBe("SELF_HOST");
      token = session.token;

      expect((await client.me()).mode).toBe("SAAS");
      const profiles = await client.listProfiles();
      expect(profiles[0]).toMatchObject({ id: "grok", model: "grok-4", provider: "xai" });

      const agent = await client.createAgent({ name: "Research", systemPrompt: "Look it up.", toolIds: ["web_search"] });
      expect(agent.systemPrompt).toBe("Look it up.");
      expect(agent.prompt).toBe("Look it up.");
      expect(agent.toolIds).toEqual(["web_search"]);
      expect(agent.tools).toEqual(["web_search"]);
      expect(agent.icon).toBe("Bot");
      expect(agent.color).toBe("green");
      expect(agent.defaultProfileId).toBeNull();
      const createAgentCall = calls.find((call) => call.path === "/api/agents" && call.method === "POST");
      expect(createAgentCall?.body).toEqual({
        name: "Research",
        icon: "Bot",
        color: "green",
        description: "",
        prompt: "Look it up.",
        systemPrompt: "Look it up.",
        tools: ["web_search"],
        toolIds: ["web_search"],
        defaultProfileId: null,
      });

      const chat = await client.createChat({ agentId: agent.id, profileId: "grok", title: "Soil" });
      expect(chat).toMatchObject({ id: "chat-1", agentId: "agent-1", profileId: "grok", title: "Soil" });
      expect(await client.updateChat(chat.id, { profileId: "grok" })).toBeNull();

      const events = [];
      for await (const event of client.streamMessage(chat.id, { content: "Hello", profileId: "grok" })) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: "text-delta", text: "Hel" },
        { type: "text-delta", text: "lo" },
        { type: "done" },
      ]);

      const messageCall = calls.find((call) => call.path === "/api/chats/chat-1/messages");
      expect(messageCall?.body).toEqual({ content: "Hello", profileId: "grok", stream: true });
      expect(messageCall?.authorization).toBe("Bearer secret-token");
      expect(calls.some((call) => call.path === "/api/chats" && Array.isArray((call.body as { agentIds?: unknown })?.agentIds))).toBe(
        false,
      );
      const createChat = calls.find((call) => call.path === "/api/chats" && call.method === "POST");
      expect(createChat?.body).toEqual({ agentId: "agent-1", profileId: "grok", title: "Soil" });
    } finally {
      server.stop(true);
    }
  });

  test("accepts a JSON message when the server does not stream", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          id: "m1",
          chat_id: "c1",
          role: "assistant",
          content: "Plain reply",
          created_at: "2026-09-23T00:00:00.000Z",
        });
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      const events = [];
      for await (const event of client.streamMessage("c1", { content: "Hi", profileId: "grok" })) events.push(event);
      expect(events).toEqual([
        { type: "message-start", messageId: "m1", role: "assistant" },
        { type: "text-delta", text: "Plain reply" },
        { type: "done", messageId: "m1" },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("queues a message, stops the chat, and reads chat events", async () => {
    const posted: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/chats/c1/messages") {
          posted.push(await request.json());
          return Response.json(
            { queued: { id: "q1", content: "Hi", profileId: "grok", createdAt: "2026-09-28T00:00:00.000Z" } },
            { status: 202 },
          );
        }
        if (url.pathname === "/api/chats/c1/stop") return Response.json({ stopped: true });
        if (url.pathname === "/api/chats/c1/events") {
          const body = [
            ": ping\n\n",
            'event: status\ndata: {"running":true,"queued":[]}\n\n',
            'event: message\ndata: {"message":{"id":"m1","chatId":"c1","role":"user","content":"Hi","createdAt":"2026-09-28T00:00:00.000Z"},"queuedId":"q1"}\n\n',
            'event: error\ndata: {"error":"Rate limited","code":"rate_limited"}\n\n',
            "event: text-delta\ndata: {}\n\n",
          ].join("");
          return new Response(body, { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ error: "missing" }, { status: 404 });
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      await expect(client.queueMessage("c1", { content: " ", profileId: "grok" })).rejects.toBeInstanceOf(Error);
      const queued = await client.queueMessage("c1", { content: " Hi ", profileId: "grok", clientId: "q1" });
      expect(queued).toEqual({ id: "q1", content: "Hi", profileId: "grok", createdAt: "2026-09-28T00:00:00.000Z" });
      expect(posted).toEqual([{ content: "Hi", profileId: "grok", async: true, clientId: "q1" }]);
      expect(await client.stopChat("c1")).toBe(true);

      const events = [];
      for await (const event of client.chatEvents("c1")) events.push(event);
      expect(events).toEqual([
        { type: "status", running: true, queued: [] },
        {
          type: "message",
          queuedId: "q1",
          message: expect.objectContaining({ id: "m1", role: "user", content: "Hi" }),
        },
        { type: "error", error: "Rate limited", code: "rate_limited" },
      ]);
      await expect(client.chatEvents("missing").next()).rejects.toBeInstanceOf(Error);
    } finally {
      server.stop(true);
    }
  });

  test("edits and deletes messages, and reads their events", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname + url.search;
        if (request.method === "PATCH" && url.pathname === "/api/chats/c1/messages/m1") {
          const body = await request.json();
          calls.push({ method: "PATCH", path, body });
          return Response.json({
            message: { id: "m1", chatId: "c1", role: "assistant", content: "Fixed", createdAt: "2026-09-28T00:00:00.000Z" },
          });
        }
        if (request.method === "DELETE" && url.pathname === "/api/chats/c1/messages/m1") {
          calls.push({ method: "DELETE", path });
          return Response.json({ deleted: ["m1", "m2"] });
        }
        if (url.pathname === "/api/chats/c1/events") {
          const body = [
            'event: message-updated\ndata: {"message":{"id":"m1","chatId":"c1","role":"assistant","content":"Fixed","createdAt":"2026-09-28T00:00:00.000Z"}}\n\n',
            'event: messages-deleted\ndata: {"ids":["m1",2,"m2"]}\n\n',
          ].join("");
          return new Response(body, { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ error: "missing" }, { status: 404 });
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      await expect(client.updateMessage("c1", "m1", "  ")).rejects.toBeInstanceOf(Error);
      expect(await client.updateMessage("c1", "m1", " Fixed ")).toMatchObject({ id: "m1", content: "Fixed" });
      expect(await client.deleteMessage("c1", "m1", { following: true })).toEqual(["m1", "m2"]);
      expect(calls).toEqual([
        { method: "PATCH", path: "/api/chats/c1/messages/m1", body: { content: "Fixed" } },
        { method: "DELETE", path: "/api/chats/c1/messages/m1?following=true" },
      ]);

      const events = [];
      for await (const event of client.chatEvents("c1")) events.push(event);
      expect(events).toEqual([
        { type: "message-updated", message: expect.objectContaining({ id: "m1", content: "Fixed" }) },
        { type: "messages-deleted", ids: ["m1", "m2"] },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("lists and reads an agent's workspace files", async () => {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        seen.push(`${url.pathname}${url.search}`);
        if (url.pathname === "/api/agents/a%201/files") {
          return Response.json({
            path: url.searchParams.get("path") ?? ".",
            entries: [{ name: "plan.md", path: "notes/plan.md", type: "file", size: 7, modifiedAt: "2026-01-01T00:00:00Z" }],
            truncated: false,
          });
        }
        if (url.pathname === "/api/agents/a%201/files/content") {
          return Response.json({ path: url.searchParams.get("path"), content: "# Plan\n", bytes: 7 });
        }
        return Response.json({ error: "missing" }, { status: 404 });
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      expect((await client.listAgentFiles("a 1")).path).toBe(".");
      const listing = await client.listAgentFiles("a 1", "notes");
      expect(listing.entries.map((entry) => entry.path)).toEqual(["notes/plan.md"]);
      expect(await client.readAgentFile("a 1", "notes/plan.md")).toEqual({ path: "notes/plan.md", content: "# Plan\n", bytes: 7 });
      expect(seen).toEqual([
        "/api/agents/a%201/files",
        "/api/agents/a%201/files?path=notes",
        "/api/agents/a%201/files/content?path=notes%2Fplan.md",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("opens an agent's own chat, clears it, and compacts it", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const chat = {
      id: "c1",
      agentId: "a1",
      memberIds: [],
      profileId: "grok",
      title: "Ada",
      createdAt: "2026-09-29T00:00:00.000Z",
    };
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        calls.push({ method: request.method, path: url.pathname, ...(body !== undefined ? { body } : {}) });
        if (url.pathname === "/api/agents/a1/chat") return Response.json({ chat });
        if (url.pathname === "/api/agents/a2/chat") return Response.json({ chat: null });
        if (request.method === "DELETE" && url.pathname === "/api/chats/c1/messages") {
          return Response.json({ deleted: ["m1", 7, "m2"] });
        }
        if (url.pathname === "/api/chats/c1/compact") {
          return Response.json(
            {
              message: {
                id: "s1",
                chatId: "c1",
                role: "system",
                name: "compaction",
                content: "Summary",
                createdAt: "2026-09-29T00:00:00.000Z",
              },
            },
            { status: 201 },
          );
        }
        return Response.json({ error: "missing" }, { status: 404 });
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      const own = await client.getAgentChat("a1");
      expect(own).toMatchObject({ id: "c1", memberIds: [] });
      expect(own && isAgentChat(own)).toBe(true);
      expect(await client.getAgentChat("a2")).toBeNull();
      expect(await client.clearChat("c1")).toEqual(["m1", "m2"]);
      const summary = await client.compactChat("c1");
      expect(isCompactionMessage(summary)).toBe(true);
      await client.compactChat("c1", { profileId: "fast" });
      expect(calls.filter((call) => call.path === "/api/chats/c1/compact").map((call) => call.body)).toEqual([
        {},
        { profileId: "fast" },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("normalizes snake_case rows", () => {
    expect(normalizeProfile({ id: "p", name: "Fast", provider: "deepseek", model_id: "deepseek-chat" }).model).toBe(
      "deepseek-chat",
    );
    expect(normalizeAgent({ id: "a", name: "A", prompt: "Be brief", tools: "web_search, file_read" })).toMatchObject({
      toolIds: ["web_search", "file_read"],
      tools: ["web_search", "file_read"],
      prompt: "Be brief",
      systemPrompt: "Be brief",
      icon: "Bot",
      color: "green",
      defaultProfileId: null,
    });
    expect(
      normalizeAgent({
        id: "b",
        name: "Scout",
        icon: "Search",
        color: "amber",
        default_profile_id: "grok",
        prompt: "Look",
      }),
    ).toMatchObject({ icon: "Search", color: "amber", defaultProfileId: "grok", prompt: "Look" });
    expect(normalizeAgent({ id: "c", name: "C", icon: "nope", color: "lime" })).toMatchObject({
      icon: "Bot",
      color: "green",
    });
  });

  test("sends contract identity fields and rejects a bad name, icon, or color", async () => {
    const client = new BotanicalClient();
    await expect(client.createAgent({ name: " ", prompt: "x" })).rejects.toThrow(/Name/);
    await expect(client.createAgent({ name: "x".repeat(41), prompt: "x" })).rejects.toThrow(/40/);
    await expect(client.createAgent({ name: "Ok", prompt: "x", icon: "sprout" })).rejects.toThrow(/Lucide/);
    await expect(client.createAgent({ name: "Ok", prompt: "x", color: "lime" as "green" })).rejects.toThrow(/Color/);
    await expect(client.createAgent({ name: "Ok", prompt: "a", systemPrompt: "b" })).rejects.toThrow(/match/);

    const { server, calls, url } = startStub();
    try {
      const authed = new BotanicalClient({ baseUrl: url, getToken: () => "secret-token" });
      await authed.login({ email: "ada@example.com", password: "sprout" });
      const agent = await authed.createAgent({
        name: "Scout",
        prompt: "Look it up.",
        tools: ["web_search"],
        icon: "Search",
        color: "amber",
        defaultProfileId: "grok",
      });
      expect(agent).toMatchObject({
        name: "Scout",
        icon: "Search",
        color: "amber",
        prompt: "Look it up.",
        tools: ["web_search"],
        defaultProfileId: "grok",
      });
      const patched = await authed.updateAgent(agent.id, { icon: "Leaf", color: "teal" });
      expect(patched).toMatchObject({ icon: "Leaf", color: "teal" });
      const patchCall = calls.find((call) => call.method === "PATCH");
      expect(patchCall?.body).toEqual({ icon: "Leaf", color: "teal" });
    } finally {
      server.stop(true);
    }
  });
});
