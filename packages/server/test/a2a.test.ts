import { describe, expect, test } from "bun:test";

import { createSendAgentMessageTool } from "../src/a2a/tool.ts";
import { INBOX_CHAT_TITLE } from "../src/a2a/constants.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

const PROFILES = [
  { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
  { id: "mock", name: "Mock", provider: "mock", model: "echo" },
];

function appWith(overrides: Record<string, string> = {}) {
  return setup({
    BOTANICAL_PROFILES: JSON.stringify(PROFILES),
    ...overrides,
  });
}

async function postJson(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? bearer(token) : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function createChat(
  app: ReturnType<typeof setup>["app"],
  token: string,
  agentId: string,
  profileId = "grok",
  title = "Plot",
): Promise<string> {
  const response = await postJson(app, "/api/chats", { agentId, profileId, title }, token);
  expect(response.status).toBe(201);
  const body = await readJson<{ chat: { id: string } }>(response);
  return body.chat.id;
}

describe("agent messages", () => {
  test("requires a session", async () => {
    const { app } = appWith();
    const response = await app.fetch(new Request("http://localhost/api/agent-messages?agentId=x"));
    expect(response.status).toBe(401);
  });

  test("sends, lists, and marks a message read", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    const chatId = await createChat(app, token, from.id);

    const created = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "Check the east bed.", fromChatId: chatId },
      token,
    );
    expect(created.status).toBe(201);
    const sent = await readJson<{
      message: { id: string; status: string; fromChatId: string; toAgentId: string };
    }>(created);
    expect(sent.message.status).toBe("delivered");
    expect(sent.message.fromChatId).toBe(chatId);
    expect(sent.message.toAgentId).toBe(to.id);

    const inbox = await app.fetch(
      new Request(`http://localhost/api/agent-messages?agentId=${to.id}`, { headers: bearer(token) }),
    );
    expect(inbox.status).toBe(200);
    const listed = await readJson<{ messages: { id: string; body: string; status: string }[] }>(inbox);
    expect(listed.messages.map((message) => message.body)).toEqual(["Check the east bed."]);

    const senderInbox = await app.fetch(
      new Request(`http://localhost/api/agent-messages?agentId=${from.id}`, { headers: bearer(token) }),
    );
    const senderListed = await readJson<{ messages: unknown[] }>(senderInbox);
    expect(senderListed.messages).toEqual([]);

    const patched = await app.fetch(
      new Request(`http://localhost/api/agent-messages/${sent.message.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ status: "read" }),
      }),
    );
    expect(patched.status).toBe(200);
    const read = await readJson<{ message: { status: string; readAt: string } }>(patched);
    expect(read.message.status).toBe("read");
    expect(read.message.readAt).toBeTruthy();

    const unread = await app.fetch(
      new Request(`http://localhost/api/agent-messages?agentId=${to.id}&status=delivered`, {
        headers: bearer(token),
      }),
    );
    const unreadBody = await readJson<{ messages: unknown[] }>(unread);
    expect(unreadBody.messages).toEqual([]);
  });

  test("rejects a missing agent, a self-send, and a blank body", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });

    const missing = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: "missing-agent", body: "Hello" },
      token,
    );
    expect(missing.status).toBe(404);

    const self = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: from.id, body: "Hello" },
      token,
    );
    expect(self.status).toBe(400);

    const blank = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: from.id, body: "   " },
      token,
    );
    expect(blank.status).toBe(400);

    const noAgent = await app.fetch(
      new Request("http://localhost/api/agent-messages", { headers: bearer(token) }),
    );
    expect(noAgent.status).toBe(400);
  });

  test("refuses to move a delivered message back to pending", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    const created = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "Stay delivered" },
      token,
    );
    const sent = await readJson<{ message: { id: string } }>(created);
    const backwards = await app.fetch(
      new Request(`http://localhost/api/agent-messages/${sent.message.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ status: "pending" }),
      }),
    );
    expect(backwards.status).toBe(409);

    const missing = await app.fetch(
      new Request("http://localhost/api/agent-messages/missing", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ status: "read" }),
      }),
    );
    expect(missing.status).toBe(404);
  });

  test("send_agent_message uses the running agent as the sender", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    const chatId = await createChat(app, token, from.id);
    const tool = createSendAgentMessageTool(app.a2a);

    const spoofed = await tool.execute(
      { toAgentId: to.id, body: "From the tool", fromAgentId: to.id },
      { agentId: from.id, chatId },
    );
    expect(spoofed.ok).toBe(false);

    const sent = await tool.execute(
      { toAgentName: "Keeper", body: "From the tool" },
      { agentId: from.id, chatId },
    );
    expect(sent.ok).toBe(true);
    expect(sent.content).toContain(to.id);

    const inbox = await readJson<{ messages: { body: string; fromAgentId: string; fromChatId?: string }[] }>(
      await app.fetch(
        new Request(`http://localhost/api/agent-messages?agentId=${to.id}`, { headers: bearer(token) }),
      ),
    );
    expect(inbox.messages).toEqual([
      expect.objectContaining({
        body: "From the tool",
        fromAgentId: from.id,
        fromChatId: chatId,
      }),
    ]);
  });

  test("a mock turn can call send_agent_message", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout", toolIds: ["send_agent_message"] });
    const to = await createAgent(app, token, { name: "Keeper" });
    const chatId = await createChat(app, token, from.id, "mock");
    const content = `send_agent_message ${JSON.stringify({ toAgentId: to.id, body: "Beds are dry." })}`;

    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content, profileId: "mock", stream: false },
      token,
    );
    expect(posted.status).toBe(201);
    const turn = await readJson<{ toolCall: { name: string }; assistantMessage: { content: string } }>(posted);
    expect(turn.toolCall.name).toBe("send_agent_message");
    expect(turn.assistantMessage.content).toContain("Beds are dry.");
    expect(turn.assistantMessage.content).toContain("Used send_agent_message");

    const inbox = await readJson<{ messages: { body: string; status: string }[] }>(
      await app.fetch(
        new Request(`http://localhost/api/agent-messages?agentId=${to.id}`, { headers: bearer(token) }),
      ),
    );
    expect(inbox.messages).toEqual([expect.objectContaining({ body: "Beds are dry.", status: "delivered" })]);
  });

  test("autorun is off unless BOTANICAL_A2A_AUTORUN is set", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    await createChat(app, token, to.id);
    await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "No turn" },
      token,
    );
    await app.a2a.whenIdle();
    const chats = await readJson<{ chats: { title: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats?agentId=${to.id}`, { headers: bearer(token) })),
    );
    expect(chats.chats.map((chat) => chat.title)).not.toContain(INBOX_CHAT_TITLE);
  });

  test("autorun writes the mail into the recipient Inbox chat and marks it read", async () => {
    const { app } = appWith({ BOTANICAL_A2A_AUTORUN: "true" });
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    await createChat(app, token, to.id, "grok", "Ordinary");

    const first = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "First note" },
      token,
    );
    const second = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "Second note" },
      token,
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await app.a2a.whenIdle();

    const chats = await readJson<{ chats: { id: string; title: string; agentId: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats?agentId=${to.id}`, { headers: bearer(token) })),
    );
    const inboxes = chats.chats.filter((chat) => chat.title === INBOX_CHAT_TITLE);
    expect(inboxes).toHaveLength(1);
    const inbox = inboxes[0];
    expect(inbox?.agentId).toBe(to.id);

    const transcript = await readJson<{ messages: { role: string; content: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats/${inbox?.id}/messages`, { headers: bearer(token) })),
    );
    const joined = transcript.messages.map((message) => message.content).join("\n");
    expect(joined).toContain("First note");
    expect(joined).toContain("Second note");
    expect(joined).toContain("Asynchronous messages from other agents");
    expect(transcript.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(joined).toContain("Profile grok");

    const mail = await readJson<{ messages: { status: string }[] }>(
      await app.fetch(
        new Request(`http://localhost/api/agent-messages?agentId=${to.id}`, { headers: bearer(token) }),
      ),
    );
    expect(mail.messages.every((message) => message.status === "read")).toBe(true);
  });

  test("autorun leaves mail delivered when the recipient has no profile", async () => {
    const { app } = appWith({ BOTANICAL_A2A_AUTORUN: "true" });
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    const created = await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "Waiting on a profile" },
      token,
    );
    expect(created.status).toBe(201);
    await app.a2a.whenIdle();

    const chats = await readJson<{ chats: { title: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats?agentId=${to.id}`, { headers: bearer(token) })),
    );
    expect(chats.chats).toEqual([]);
    const mail = await readJson<{ messages: { status: string }[] }>(
      await app.fetch(
        new Request(`http://localhost/api/agent-messages?agentId=${to.id}`, { headers: bearer(token) }),
      ),
    );
    expect(mail.messages.map((message) => message.status)).toEqual(["delivered"]);
  });

  test("mock autorun acknowledges through the mock provider", async () => {
    const { app } = appWith({ BOTANICAL_A2A_AUTORUN: "true" });
    const { token } = await login(app);
    const from = await createAgent(app, token, { name: "Scout" });
    const to = await createAgent(app, token, { name: "Keeper" });
    await createChat(app, token, to.id, "mock", "Ordinary");
    await postJson(
      app,
      "/api/agent-messages",
      { fromAgentId: from.id, toAgentId: to.id, body: "Ping" },
      token,
    );
    await app.a2a.whenIdle();
    const chats = await readJson<{ chats: { id: string; title: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats?agentId=${to.id}`, { headers: bearer(token) })),
    );
    const inbox = chats.chats.find((chat) => chat.title === INBOX_CHAT_TITLE);
    const transcript = await readJson<{ messages: { role: string; content: string }[] }>(
      await app.fetch(new Request(`http://localhost/api/chats/${inbox?.id}/messages`, { headers: bearer(token) })),
    );
    const assistant = transcript.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("Acknowledged 1 inbox message(s).");
  });
});
