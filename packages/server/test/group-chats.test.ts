import { describe, expect, test } from "bun:test";

import { handoffs, respondersFor } from "../src/runtime/group.ts";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

type ProviderMessage = { role: string; content: unknown };

/** OpenAI-style provider that answers as the agent named in the system prompt ("You are Ada."). */
function groupFetch(reply: (name: string, messages: ProviderMessage[]) => string = (name) => `${name} here`) {
  const requests: Array<{ messages: ProviderMessage[] }> = [];
  const fetch = (_input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: ProviderMessage[] };
    requests.push(body);
    const system = String(body.messages.find((message) => message.role === "system")?.content ?? "");
    const name = /^You are (\w+)\./.exec(system)?.[1] ?? "Someone";
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: reply(name, body.messages) } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return Promise.resolve(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
  };
  return { fetch, requests };
}

async function groupSetup(reply?: Parameters<typeof groupFetch>[0]) {
  const provider = groupFetch(reply);
  const { app, store } = setup({}, { fetch: provider.fetch });
  const { token } = await login(app);
  const ada = await createAgent(app, token, { name: "Ada", systemPrompt: "You are Ada." });
  const bob = await createAgent(app, token, { name: "Bob", systemPrompt: "You are Bob." });
  const cy = await createAgent(app, token, { name: "Cy", systemPrompt: "You are Cy." });
  return { app, store, token, provider, ada, bob, cy };
}

function post(app: ReturnType<typeof setup>["app"], token: string, path: string, body: unknown, method = "POST") {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify(body),
    }),
  );
}

type Row = { id: string; role: string; content: string; agentId?: string | null };

async function transcript(app: ReturnType<typeof setup>["app"], token: string, chatId: string): Promise<Row[]> {
  const response = await app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) }),
  );
  return (await readJson<{ messages: Row[] }>(response)).messages;
}

describe("group chat members", () => {
  test("create, list by member, update, and validate members", async () => {
    const { app, token, ada, bob, cy } = await groupSetup();
    const created = await post(app, token, "/api/chats", {
      agentId: ada.id,
      memberIds: [bob.id, bob.id],
      profileId: "grok",
    });
    expect(created.status).toBe(201);
    const { chat } = await readJson<{ chat: { id: string; memberIds: string[] } }>(created);
    expect(chat.memberIds).toEqual([bob.id]);

    const byMember = await app.fetch(
      new Request(`http://localhost/api/chats?agentId=${bob.id}`, { headers: bearer(token) }),
    );
    expect((await readJson<{ chats: Array<{ id: string }> }>(byMember)).chats.map((row) => row.id)).toEqual([chat.id]);

    const patched = await post(app, token, `/api/chats/${chat.id}`, { memberIds: [cy.id, bob.id] }, "PATCH");
    expect(patched.status).toBe(200);
    expect((await readJson<{ chat: { memberIds: string[] } }>(patched)).chat.memberIds).toEqual([cy.id, bob.id]);

    const owner = await post(app, token, `/api/chats/${chat.id}`, { memberIds: [ada.id] }, "PATCH");
    expect(owner.status).toBe(400);
    const unknown = await post(app, token, `/api/chats/${chat.id}`, { memberIds: ["nope"] }, "PATCH");
    expect(unknown.status).toBe(404);
    const notArray = await post(app, token, "/api/chats", { agentId: ada.id, memberIds: bob.id, profileId: "grok" });
    expect(notArray.status).toBe(400);

    const busy = await app.fetch(
      new Request(`http://localhost/api/agents/${cy.id}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(busy.status).toBe(409);
  });

  test("every member answers in order when nobody is mentioned, and each sees the others", async () => {
    const { app, token, provider, ada, bob } = await groupSetup();
    const created = await post(app, token, "/api/chats", { agentId: ada.id, memberIds: [bob.id], profileId: "grok" });
    const { chat } = await readJson<{ chat: { id: string } }>(created);

    const response = await post(app, token, `/api/chats/${chat.id}/messages`, { content: "Hello team", profileId: "grok", stream: false });
    expect(response.status).toBe(201);
    const body = await readJson<{ replies: Row[]; assistantMessage: Row; mentions: unknown[] }>(response);
    expect(body.replies.map((row) => [row.agentId, row.content])).toEqual([
      [ada.id, "Ada here"],
      [bob.id, "Bob here"],
    ]);
    expect(body.assistantMessage.content).toBe("Bob here");
    expect(body.mentions).toEqual([]);

    const rows = await transcript(app, token, chat.id);
    expect(rows.map((row) => [row.role, row.content, row.agentId ?? null])).toEqual([
      ["user", "Hello team", null],
      ["assistant", "Ada here", ada.id],
      ["assistant", "Bob here", bob.id],
    ]);
    const bobSaw = provider.requests[1]?.messages.filter((message) => message.role !== "system");
    expect(bobSaw).toEqual([
      { role: "user", content: "Hello team" },
      { role: "user", content: "[Ada] Ada here" },
    ]);
  });

  test("a mention picks who answers, a reply can hand off, and members get no mail", async () => {
    const { app, token, ada, bob, cy } = await groupSetup((name) => (name === "Bob" ? "Over to @Ada" : `${name} here`));
    const created = await post(app, token, "/api/chats", {
      agentId: ada.id,
      memberIds: [bob.id, cy.id],
      profileId: "grok",
    });
    const { chat } = await readJson<{ chat: { id: string } }>(created);

    const response = await post(app, token, `/api/chats/${chat.id}/messages`, {
      content: "@Bob what do you think?",
      profileId: "grok",
      stream: false,
    });
    const body = await readJson<{ replies: Row[]; mentions: unknown[] }>(response);
    expect(body.replies.map((row) => row.agentId)).toEqual([bob.id, ada.id]);
    expect(body.mentions).toEqual([]);
  });

  test("async messages run each responder and report who is working", async () => {
    const { app, token, ada, bob } = await groupSetup();
    const created = await post(app, token, "/api/chats", { agentId: ada.id, memberIds: [bob.id], profileId: "grok" });
    const { chat } = await readJson<{ chat: { id: string } }>(created);
    const working: string[] = [];
    app.chatQueue.subscribe(chat.id, (event) => {
      const data = event.data as { running?: boolean; agentId?: string };
      if (event.event === "status" && data.running && data.agentId && working.at(-1) !== data.agentId) {
        working.push(data.agentId);
      }
    });

    const queued = await post(app, token, `/api/chats/${chat.id}/messages`, {
      content: "Hi",
      async: true,
      profileId: "grok",
    });
    expect(queued.status).toBe(202);
    await app.chatQueue.whenIdle();

    expect(working).toEqual([ada.id, bob.id]);
    const rows = await transcript(app, token, chat.id);
    expect(rows.map((row) => [row.role, row.agentId ?? null])).toEqual([
      ["user", null],
      ["assistant", ada.id],
      ["assistant", bob.id],
    ]);
  });
});

describe("responder selection", () => {
  const agents = [
    { id: "a", name: "Ada" },
    { id: "b", name: "Bob" },
    { id: "c", name: "Cy" },
  ];
  const chat = { agentId: "a", memberIds: ["b"] };

  test("everyone without a mention, the mentioned otherwise, and outsiders never", () => {
    expect(respondersFor(chat, agents, "hi all")).toEqual(["a", "b"]);
    expect(respondersFor(chat, agents, "@Bob then @Ada")).toEqual(["b", "a"]);
    expect(respondersFor(chat, agents, "@Cy only")).toEqual(["a", "b"]);
  });

  test("a handoff skips agents that already answered or are waiting", () => {
    expect(handoffs(chat, agents, "ask @Bob and @Cy", new Set(["a"]))).toEqual(["b"]);
    expect(handoffs(chat, agents, "ask @Bob", new Set(["a", "b"]))).toEqual([]);
  });
});
