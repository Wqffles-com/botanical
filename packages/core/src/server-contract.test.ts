import { describe, expect, test } from "bun:test";
import { BotanicalClient } from "./client";
import { ProfileRequiredError } from "./errors";

/**
 * Fixtures copied from the v0 server route shapes:
 * error `{ error: { code, message } }`, profiles `{ profiles, defaultProfileId: null }`,
 * me `{ deploymentMode, brand }`, and SSE `message.created` / `text-delta` /
 * `message.completed` / `done`.
 */
describe("v0 server contract", () => {
  test("reads health, me, profiles, and the message stream without inventing a default profile", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/health") {
          return Response.json({
            ok: true,
            service: "botanical-server",
            version: "0.1.0",
            deploymentMode: "SELF_HOST",
            brand: { name: "Botanical" },
            persistence: "memory",
          });
        }
        if (url.pathname === "/api/auth/me") {
          return Response.json({
            operator: { id: "operator" },
            deploymentMode: "SAAS",
            brand: { name: "Botanical Cloud" },
            session: { id: "s1", expiresAt: "2099-01-01T00:00:00.000Z" },
          });
        }
        if (url.pathname === "/api/profiles") {
          return Response.json({
            profiles: [{ id: "grok", name: "Grok", provider: "xai", model: "grok-4" }],
            defaultProfileId: null,
          });
        }
        if (url.pathname === "/api/chats/chat-1/messages" && request.method === "GET") {
          return Response.json({ messages: [] });
        }
        if (url.pathname === "/api/chats/chat-1/messages" && request.method === "POST") {
          const body = (await request.json()) as { content: string; profileId: string; stream: boolean };
          if (!body.profileId) return Response.json({ error: { code: "invalid_body", message: "profile required" } }, { status: 422 });
          const user = {
            id: "u1",
            chatId: "chat-1",
            role: "user",
            content: body.content,
            createdAt: "2026-09-23T00:00:00.000Z",
          };
          const assistant = {
            id: "a1",
            chatId: "chat-1",
            role: "assistant",
            content: "Stub reply on grok.",
            createdAt: "2026-09-23T00:00:01.000Z",
          };
          if (body.stream === false) {
            return Response.json({ userMessage: user, assistantMessage: assistant, profileId: body.profileId }, { status: 201 });
          }
          const encoder = new TextEncoder();
          const frames = [
            `event: message.created\ndata: ${JSON.stringify({ message: user })}\n\n`,
            `event: text-delta\ndata: ${JSON.stringify({ text: "Stub reply" })}\n\n`,
            `event: text-delta\ndata: ${JSON.stringify({ text: " on grok." })}\n\n`,
            `event: message.completed\ndata: ${JSON.stringify({ message: assistant })}\n\n`,
            `event: done\ndata: {}\n\n`,
          ];
          return new Response(
            new ReadableStream({
              start(controller) {
                for (const frame of frames) controller.enqueue(encoder.encode(frame));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream; charset=utf-8" } },
          );
        }
        return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
      },
    });

    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}`, getToken: () => "t" });
      expect(await client.health()).toMatchObject({ ok: true, mode: "SELF_HOST", brandName: "Botanical", version: "0.1.0" });
      expect(await client.me()).toEqual({ authenticated: true, mode: "SAAS", brandName: "Botanical Cloud" });
      const profiles = await client.listProfiles();
      expect(profiles.map((profile) => profile.id)).toEqual(["grok"]);

      const events = [];
      for await (const event of client.streamMessage("chat-1", { content: "Hello", profileId: "grok" })) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: "message-start", messageId: "u1", role: "user" },
        { type: "text-delta", text: "Stub reply" },
        { type: "text-delta", text: " on grok." },
        { type: "done", messageId: "a1" },
        { type: "done" },
      ]);

      await expect(client.streamMessage("chat-1", { content: "Hi", profileId: "" }).next()).rejects.toBeInstanceOf(
        ProfileRequiredError,
      );
    } finally {
      server.stop(true);
    }
  });

  test("surfaces the server error message and a JSON assistant message", async () => {
    let jsonTurn = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        if (!jsonTurn) {
          return Response.json({ error: { code: "unauthorized", message: "Invalid credentials" } }, { status: 401 });
        }
        return Response.json(
          {
            userMessage: { id: "u1", chatId: "c", role: "user", content: "Hi", createdAt: "2026-09-23T00:00:00.000Z" },
            assistantMessage: {
              id: "a1",
              chatId: "c",
              role: "assistant",
              content: "Plain",
              createdAt: "2026-09-23T00:00:01.000Z",
            },
            profileId: "grok",
          },
          { status: 201 },
        );
      },
    });
    try {
      const client = new BotanicalClient({ baseUrl: `http://127.0.0.1:${server.port}` });
      await expect(client.login("nope")).rejects.toThrow("Invalid credentials");
      jsonTurn = true;
      const events = [];
      for await (const event of client.streamMessage("c", { content: "Hi", profileId: "grok" })) events.push(event);
      expect(events).toEqual([
        { type: "message-start", messageId: "a1", role: "assistant" },
        { type: "text-delta", text: "Plain" },
        { type: "done", messageId: "a1" },
      ]);
    } finally {
      server.stop(true);
    }
  });
});
