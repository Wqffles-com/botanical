import { describe, expect, test } from "bun:test";

import { searchSnippet } from "../src/routes/messages.ts";
import { bearer, createAgent, login, readJson, setup, ECHO_PROFILE } from "./helpers.ts";

type Hit = { message: { id: string; role: string; content: string }; agentId: string; snippet: { text: string; start: number; end: number } };

describe("message search", () => {
  test("finds user and reply text, honours filters, and highlights the match", async () => {
    const { app } = setup({ BOTANICAL_PROFILES: JSON.stringify([ECHO_PROFILE]) });
    const { token } = await login(app);
    const ada = await createAgent(app, token, { name: "Ada" });
    const bob = await createAgent(app, token, { name: "Bob" });
    const call = (method: string, path: string, body?: unknown) =>
      app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...bearer(token) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    for (const agent of [ada, bob]) {
      const chat = (await readJson<{ chat: { id: string } }>(await call("POST", "/api/chats", { agentId: agent.id, profileId: "echo" }))).chat;
      await call("POST", `/api/chats/${chat.id}/messages`, { content: `Water the ferns for ${agent.name}`, profileId: "echo" });
    }
    const search = async (query: string) =>
      (await readJson<{ results: Hit[] }>(await call("GET", `/api/messages/search?${query}`))).results;

    const all = await search("q=ferns");
    expect(all.length).toBeGreaterThanOrEqual(2);
    const hit = all[0]!;
    expect(hit.snippet.text.slice(hit.snippet.start, hit.snippet.end).toLowerCase()).toBe("ferns");

    const onlyAda = await search(`q=ferns&agentId=${ada.id}`);
    expect(onlyAda.every((row) => row.agentId === ada.id)).toBe(true);
    const mine = await search("q=ferns&role=user");
    expect(mine.length).toBe(2);
    expect(mine.every((row) => row.message.role === "user")).toBe(true);
    expect(await search("q=ferns&from=2999-01-01")).toEqual([]);
    expect(await search("q=zzzznothing")).toEqual([]);
    expect((await call("GET", "/api/messages/search?q=")).status).toBe(400);
    expect((await call("GET", "/api/messages/search?q=a&role=tool")).status).toBe(400);
  });

  test("snippet windows long text around the match", () => {
    const text = `${"lorem ".repeat(40)}needle ${"ipsum ".repeat(40)}`;
    const snippet = searchSnippet(text, "needle");
    expect(snippet.text.slice(snippet.start, snippet.end)).toBe("needle");
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(searchSnippet("short", "zzz")).toEqual({ text: "short", start: 0, end: 0 });
  });
});
