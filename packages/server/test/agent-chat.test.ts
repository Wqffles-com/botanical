import { describe, expect, test } from "bun:test";

import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

const PROFILES = [
  { id: "mock", name: "Mock", provider: "mock", model: "echo" },
  { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
];

type App = ReturnType<typeof setup>["app"];

function appWith() {
  return setup({ BOTANICAL_PROFILES: JSON.stringify(PROFILES) });
}

function send(app: App, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...bearer(token) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function openChat(app: App, token: string, agentId: string, memberIds: string[] = []) {
  const response = await send(app, token, "POST", "/api/chats", { agentId, profileId: "mock", memberIds });
  return (await readJson<{ chat: { id: string; memberIds: string[] } }>(response)).chat;
}

async function transcript(app: App, token: string, chatId: string) {
  const response = await send(app, token, "GET", `/api/chats/${chatId}/messages`);
  return (await readJson<{ messages: Array<{ id: string; role: string; content: string; name?: string }> }>(response))
    .messages;
}

describe("one chat per agent", () => {
  test("an agent has one chat of its own and group chats beside it", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const ada = await createAgent(app, token, { name: "Ada" });
    const bo = await createAgent(app, token, { name: "Bo" });

    const none = await readJson<{ chat: unknown }>(await send(app, token, "GET", `/api/agents/${ada.id}/chat`));
    expect(none.chat).toBeNull();

    const first = await send(app, token, "POST", "/api/chats", { agentId: ada.id, profileId: "mock" });
    expect(first.status).toBe(201);
    const own = (await readJson<{ chat: { id: string; title: string } }>(first)).chat;
    expect(own.title).toBe("Ada");
    const second = await send(app, token, "POST", "/api/chats", { agentId: ada.id, profileId: "grok" });
    expect(second.status).toBe(200);
    expect((await readJson<{ chat: { id: string } }>(second)).chat.id).toBe(own.id);

    // Group chats are extra threads, as many as you like.
    const groupA = await openChat(app, token, ada.id, [bo.id]);
    const groupB = await openChat(app, token, ada.id, [bo.id]);
    expect(new Set([own.id, groupA.id, groupB.id]).size).toBe(3);
    const found = await readJson<{ chat: { id: string } }>(await send(app, token, "GET", `/api/agents/${ada.id}/chat`));
    expect(found.chat.id).toBe(own.id);

    // The agent's own chat never gains members, and a group chat never loses its last one.
    const joined = await send(app, token, "PATCH", `/api/chats/${own.id}`, { memberIds: [bo.id] });
    expect(joined.status).toBe(400);
    const emptied = await send(app, token, "PATCH", `/api/chats/${groupA.id}`, { memberIds: [] });
    expect(emptied.status).toBe(400);
  });

  test("a routine run lands in the agent's own chat, live", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const ada = await createAgent(app, token, { name: "Ada" });
    const chat = await openChat(app, token, ada.id);

    const controller = new AbortController();
    const events = await app.fetch(
      new Request(`http://localhost/api/chats/${chat.id}/events`, { headers: bearer(token), signal: controller.signal }),
    );
    const reader = events.body!.getReader();
    const seen: string[] = [];
    const reading = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        seen.push(decoder.decode(value));
      }
    })();

    const routine = await readJson<{ routine: { id: string } }>(
      await send(app, token, "POST", "/api/routines", {
        agentId: ada.id,
        name: "Morning",
        prompt: "Look at the ferns",
        cron: "0 9 * * *",
        timezone: "UTC",
        profileId: "mock",
      }),
    );
    await send(app, token, "POST", `/api/routines/${routine.routine.id}/run`, {});
    await app.turns.whenIdle();

    const runs = await readJson<{ runs: Array<{ status: string; chatId: string | null }> }>(
      await send(app, token, "GET", `/api/routines/${routine.routine.id}/runs`),
    );
    expect(runs.runs[0]).toMatchObject({ status: "succeeded", chatId: chat.id });
    const rows = await transcript(app, token, chat.id);
    expect(rows[0]?.role).toBe("user");
    expect(rows[0]?.content).toStartWith("[Routine · Morning");
    expect(rows[0]?.content).toContain("Look at the ferns");
    expect(rows.some((row) => row.role === "assistant")).toBe(true);

    controller.abort();
    await reading;
    const feed = seen.join("");
    expect(feed).toContain('"running":true');
    expect(feed).toContain("Look at the ferns");

    const chats = await readJson<{ chats: unknown[] }>(await send(app, token, "GET", `/api/chats?agentId=${ada.id}`));
    expect(chats.chats).toHaveLength(1);
  });

  test("clear empties the chat, and compact stores a summary the next turn reads", async () => {
    const { app } = appWith();
    const { token } = await login(app);
    const ada = await createAgent(app, token, { name: "Ada" });
    const chat = await openChat(app, token, ada.id);

    const nothing = await send(app, token, "POST", `/api/chats/${chat.id}/compact`, {});
    expect(nothing.status).toBe(409);
    expect((await readJson<{ error: { code: string } }>(nothing)).error.code).toBe("nothing_to_compact");

    await send(app, token, "POST", `/api/chats/${chat.id}/messages`, { content: "Water the ferns", profileId: "mock" });
    const compacted = await send(app, token, "POST", `/api/chats/${chat.id}/compact`, {});
    expect(compacted.status).toBe(201);
    const summary = (await readJson<{ message: { role: string; name: string; content: string } }>(compacted)).message;
    expect(summary.role).toBe("system");
    expect(summary.name).toBe("compaction");
    expect(summary.content.length).toBeGreaterThan(0);

    const rows = await transcript(app, token, chat.id);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "system"]);

    const cleared = await send(app, token, "DELETE", `/api/chats/${chat.id}/messages`);
    expect(cleared.status).toBe(200);
    expect((await readJson<{ deleted: string[] }>(cleared)).deleted).toEqual(rows.map((row) => row.id));
    expect(await transcript(app, token, chat.id)).toEqual([]);
  });
});
