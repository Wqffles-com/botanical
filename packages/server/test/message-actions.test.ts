import { describe, expect, test } from "bun:test";

import { messagesToDelete } from "../src/routes/messages.ts";
import type { Message } from "../src/types.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

type TestApp = ReturnType<typeof setup>["app"];

async function openChat(app: TestApp, token: string): Promise<string> {
  const agent = await createAgent(app, token, { toolIds: [] });
  const created = await app.fetch(
    new Request("http://localhost/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ agentId: agent.id, profileId: "grok" }),
    }),
  );
  return (await readJson<{ chat: { id: string } }>(created)).chat.id;
}

async function say(app: TestApp, token: string, chatId: string, content: string): Promise<void> {
  const response = await app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ content, profileId: "grok", stream: false }),
    }),
  );
  expect(response.status).toBe(201);
}

async function transcript(app: TestApp, token: string, chatId: string) {
  const response = await app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) }),
  );
  return (await readJson<{ messages: Array<{ id: string; role: string; content: string }> }>(response)).messages;
}

function patch(app: TestApp, token: string, chatId: string, messageId: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify(body),
    }),
  );
}

function remove(app: TestApp, token: string, chatId: string, messageId: string, query = ""): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages/${messageId}${query}`, {
      method: "DELETE",
      headers: bearer(token),
    }),
  );
}

describe("message actions", () => {
  test("PATCH replaces a message's text", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const chatId = await openChat(app, token);
    await say(app, token, chatId, "hello");
    const [user, reply] = await transcript(app, token, chatId);

    const edited = await patch(app, token, chatId, reply!.id, { content: "  fixed reply  " });
    expect(edited.status).toBe(200);
    expect((await readJson<{ message: { id: string; content: string } }>(edited)).message).toMatchObject({
      id: reply!.id,
      content: "fixed reply",
    });

    expect((await patch(app, token, chatId, user!.id, { content: "" })).status).toBe(400);
    expect((await patch(app, token, chatId, "missing", { content: "x" })).status).toBe(404);
    const rows = await transcript(app, token, chatId);
    expect(rows.map((row) => row.content)).toEqual(["hello", "fixed reply"]);
  });

  test("DELETE removes one message, or it and everything after", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const chatId = await openChat(app, token);
    await say(app, token, chatId, "one");
    await say(app, token, chatId, "two");
    const rows = await transcript(app, token, chatId);
    expect(rows.map((row) => row.content)).toEqual(["one", "Reply from grok-4", "two", "Reply from grok-4"]);

    const single = await remove(app, token, chatId, rows[1]!.id);
    expect(single.status).toBe(200);
    expect((await readJson<{ deleted: string[] }>(single)).deleted).toEqual([rows[1]!.id]);
    expect((await transcript(app, token, chatId)).map((row) => row.content)).toEqual([
      "one",
      "two",
      "Reply from grok-4",
    ]);

    const rest = await remove(app, token, chatId, rows[2]!.id, "?following=true");
    expect((await readJson<{ deleted: string[] }>(rest)).deleted).toEqual([rows[2]!.id, rows[3]!.id]);
    expect((await transcript(app, token, chatId)).map((row) => row.content)).toEqual(["one"]);

    expect((await remove(app, token, chatId, rows[2]!.id)).status).toBe(404);
    expect((await remove(app, token, chatId, rows[0]!.id, "?following=maybe")).status).toBe(400);
  });

  test("another user cannot change the chat", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const chatId = await openChat(app, token);
    await say(app, token, chatId, "mine");
    const [row] = await transcript(app, token, chatId);
    const other = await login(app, undefined, { email: "other@example.com" });

    expect((await patch(app, other.token, chatId, row!.id, { content: "theirs" })).status).toBe(404);
    expect((await remove(app, other.token, chatId, row!.id)).status).toBe(404);
    expect((await transcript(app, token, chatId))[0]?.content).toBe("mine");
  });
});

describe("messagesToDelete", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const rows: Message[] = [
    { id: "u1", chatId: "c", role: "user", content: "hi", createdAt: at },
    {
      id: "a1",
      chatId: "c",
      role: "assistant",
      content: "",
      createdAt: at,
      toolCalls: [{ id: "call-1", name: "read", arguments: {} }],
    },
    { id: "t1", chatId: "c", role: "tool", content: "ok", toolCallId: "call-1", createdAt: at },
    { id: "a2", chatId: "c", role: "assistant", content: "done", createdAt: at },
  ];

  test("an assistant message takes its tool results", () => {
    expect(messagesToDelete(rows, "a1", false)).toEqual(["a1", "t1"]);
    expect(messagesToDelete(rows, "u1", false)).toEqual(["u1"]);
  });

  test("following takes every later message", () => {
    expect(messagesToDelete(rows, "a1", true)).toEqual(["a1", "t1", "a2"]);
  });

  test("unknown ids return null", () => {
    expect(messagesToDelete(rows, "nope", false)).toBeNull();
  });
});
