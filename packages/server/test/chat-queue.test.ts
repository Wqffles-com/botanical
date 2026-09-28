import { describe, expect, test } from "bun:test";

import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

/** OpenAI-style provider that holds each reply until the test releases it. */
function gatedFetch() {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const gates: Array<() => void> = [];
  let arrived: (() => void) | null = null;
  const fetch = (_input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as (typeof requests)[number];
    requests.push(body);
    const n = requests.length;
    arrived?.();
    arrived = null;
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      gates.push(() => {
        const sse = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: `reply ${n}` } }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        resolve(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
      });
    });
  };
  return {
    fetch,
    requests,
    release() {
      gates.shift()?.();
    },
    /** Resolves once the provider has been called `count` times in total. */
    async waitForRequests(count: number) {
      while (requests.length < count) {
        await new Promise<void>((resolve) => {
          arrived = resolve;
        });
      }
    },
  };
}

async function openChat(app: ReturnType<typeof setup>["app"], token: string): Promise<string> {
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

function queueMessage(
  app: ReturnType<typeof setup>["app"],
  token: string,
  chatId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ profileId: "grok", async: true, ...body }),
    }),
  );
}

async function transcript(app: ReturnType<typeof setup>["app"], token: string, chatId: string) {
  const response = await app.fetch(
    new Request(`http://localhost/api/chats/${chatId}/messages`, { headers: bearer(token) }),
  );
  return (await readJson<{ messages: Array<{ role: string; content: string }> }>(response)).messages;
}

describe("async chat messages", () => {
  test("returns 202 at once and answers messages sent mid-turn in one batch", async () => {
    const provider = gatedFetch();
    const { app } = setup({}, { fetch: provider.fetch });
    const { token } = await login(app);
    const chatId = await openChat(app, token);

    const first = await queueMessage(app, token, chatId, { content: "one", clientId: "c1" });
    expect(first.status).toBe(202);
    const body = await readJson<{ queued: { id: string; content: string } }>(first);
    expect(body.queued).toMatchObject({ id: "c1", content: "one" });

    await provider.waitForRequests(1);
    expect((await queueMessage(app, token, chatId, { content: "two" })).status).toBe(202);
    expect((await queueMessage(app, token, chatId, { content: "three" })).status).toBe(202);

    provider.release();
    await provider.waitForRequests(2);
    provider.release();
    await app.chatQueue.whenIdle();

    expect(provider.requests).toHaveLength(2);
    const second = provider.requests[1]?.messages.filter((message) => message.role === "user");
    expect(second?.map((message) => message.content)).toEqual(["one", "two", "three"]);
    const rows = await transcript(app, token, chatId);
    expect(rows.map((row) => [row.role, row.content])).toEqual([
      ["user", "one"],
      ["assistant", "reply 1"],
      ["user", "two"],
      ["user", "three"],
      ["assistant", "reply 2"],
    ]);
  });

  test("events stream status and whole messages, without deltas", async () => {
    const provider = gatedFetch();
    const { app } = setup({}, { fetch: provider.fetch });
    const { token } = await login(app);
    const chatId = await openChat(app, token);

    const abort = new AbortController();
    const response = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/events`, { headers: bearer(token), signal: abort.signal }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('"running":false');
    await queueMessage(app, token, chatId, { content: "hello", clientId: "q-1" });
    await provider.waitForRequests(1);
    provider.release();
    await readUntil('"content":"reply 1"');
    await readUntil('"running":false,"queued":[]}\n\n');
    abort.abort();
    await reader.cancel().catch(() => undefined);

    expect(text).toContain('"queuedId":"q-1"');
    expect(text).toContain("event: message");
    expect(text).not.toContain("text-delta");
    expect(text).toContain('"running":true');
  });

  test("stop aborts the running turn without an error event", async () => {
    const provider = gatedFetch();
    const { app } = setup({}, { fetch: provider.fetch });
    const { token } = await login(app);
    const chatId = await openChat(app, token);

    const events: Array<{ event: string }> = [];
    app.chatQueue.subscribe(chatId, (event) => events.push(event));
    await queueMessage(app, token, chatId, { content: "long job" });
    await provider.waitForRequests(1);

    const stopped = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/stop`, { method: "POST", headers: bearer(token) }),
    );
    expect(await readJson<{ stopped: boolean }>(stopped)).toEqual({ stopped: true });
    await app.chatQueue.whenIdle();
    expect(events.some((event) => event.event === "error")).toBe(false);
    expect(app.chatQueue.status(chatId)).toEqual({ running: false, queued: [] });
  });

  test("rejects async with stream, and malformed client ids", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const chatId = await openChat(app, token);
    expect((await queueMessage(app, token, chatId, { content: "x", stream: true })).status).toBe(400);
    expect((await queueMessage(app, token, chatId, { content: "x", clientId: "no spaces" })).status).toBe(400);
    expect((await queueMessage(app, token, chatId, { content: "x", async: "yes" })).status).toBe(400);
  });

  test("events and stop are scoped to the chat owner", async () => {
    const { app } = setup({ BOTANICAL_SIGNUP_MODE: "open" });
    const { token } = await login(app);
    const chatId = await openChat(app, token);
    const other = await login(app, "another password", { email: "other@example.com" });
    const events = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/events`, { headers: bearer(other.token) }),
    );
    expect(events.status).toBe(404);
    const stop = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/stop`, { method: "POST", headers: bearer(other.token) }),
    );
    expect(stop.status).toBe(404);
  });
});
