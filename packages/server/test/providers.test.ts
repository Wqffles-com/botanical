import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createMemoryStore } from "../src/db/memory.ts";
import { bearer, createAgent, login, PASSWORD, readJson, setup } from "./helpers.ts";

function sse(chunks: string): Response {
  return new Response(chunks, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function postJson(
  app: ReturnType<typeof setup>["app"],
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("GET /api/profiles", () => {
  test("returns mock only until a provider key is set, and never a default", async () => {
    const { app } = setup({
      BOTANICAL_PROFILES: "",
      XAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
    });
    const { token } = await login(app);
    const body = await readJson<{ profiles: { id: string }[]; defaultProfileId: null }>(
      await app.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) })),
    );
    expect(body.defaultProfileId).toBeNull();
    expect(body.profiles.map((profile) => profile.id)).toEqual(["mock"]);
  });

  test("lists one profile for each configured key and the compat host", async () => {
    const { app } = setup({
      BOTANICAL_PROFILES: "",
      XAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-ant",
      OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:11434/v1",
      OPENAI_COMPAT_API_KEY: "local",
    });
    const { token } = await login(app);
    const body = await readJson<{ profiles: { id: string; provider: string; model: string }[] }>(
      await app.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) })),
    );
    expect(body.profiles.map((profile) => profile.id)).toEqual([
      "mock",
      "openai",
      "anthropic",
      "openai-compat",
    ]);
    expect(JSON.stringify(body)).not.toContain("sk-openai");
    expect(JSON.stringify(body)).not.toContain("local");
  });

  test("profiles.json overrides the model list and omits providers whose key is missing", async () => {
    const config = loadConfig(
      {
        BOTANICAL_PASSWORD: PASSWORD,
        BOTANICAL_PROFILES_FILE: "/opt/profiles.json",
        BOTANICAL_PROFILES: JSON.stringify([{ id: "inline", name: "Inline", provider: "openai", model: "gpt-4.1" }]),
        XAI_API_KEY: "present",
        OPENAI_API_KEY: "",
      },
      {
        readFile: () =>
          JSON.stringify({
            profiles: [
              { id: "grok-mini", name: "Grok mini", provider: "xai", model: "grok-3" },
              { id: "gpt", name: "GPT", provider: "openai", model: "gpt-4.1" },
            ],
          }),
      },
    );
    expect(config.profiles.map((profile) => profile.id)).toEqual(["mock", "grok-mini"]);
    const hosted = createApp({ config, store: createMemoryStore() });
    const { token } = await login(hosted);
    const body = await readJson<{ profiles: { id: string; model: string }[]; defaultProfileId: null }>(
      await hosted.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) })),
    );
    expect(body.defaultProfileId).toBeNull();
    expect(body.profiles.map((profile) => profile.model)).toEqual(["echo", "grok-3"]);
  });
});

describe("provider streaming", () => {
  test("xAI streams text and a tool call, and the response does not contain the key", async () => {
    const calls: { url: string; body: string; authorization: string | null }[] = [];
    const { app } = setup(
      { XAI_API_KEY: "sk-xai-secret" },
      {
        fetch: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          const headers = new Headers(init?.headers);
          calls.push({
            url,
            body: typeof init?.body === "string" ? init.body : "",
            authorization: headers.get("authorization"),
          });
          return sse(
            [
              data({ choices: [{ delta: { content: "Looking. " } }] }),
              data({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_files",
                          type: "function",
                          function: { name: "file_list", arguments: "{\"path\":\".\"}" },
                        },
                      ],
                    },
                  },
                ],
              }),
              "data: [DONE]\n\n",
            ].join(""),
          );
        },
      },
    );
    const { token } = await login(app);
    const agent = await createAgent(app, token, {
      systemPrompt: "You keep the garden.",
      toolIds: ["file_list"],
    });
    const created = await postJson(app, "/api/chats", { agentId: agent.id, profileId: "grok" }, bearer(token));
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const response = await app.fetch(
      new Request(`http://localhost/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...bearer(token) },
        body: JSON.stringify({ content: "List the plots", profileId: "grok" }),
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("event: text-delta");
    expect(text).toContain("Looking. ");
    expect(text).toContain("event: tool-call");
    expect(text).toContain("file_list");
    expect(text).toContain("event: done");
    expect(text).not.toContain("sk-xai-secret");
    expect(calls[0]?.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(calls[0]?.authorization).toBe("Bearer sk-xai-secret");
    const outbound = JSON.parse(calls[0]?.body ?? "{}") as {
      model: string;
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };
    expect(outbound.model).toBe("grok-4");
    expect(outbound.messages[0]?.role).toBe("system");
    expect(outbound.messages[0]?.content).toContain("You keep the garden.");
    expect(outbound.messages[0]?.content).toContain("Description: Tends the plots");
    expect(outbound.tools[0]?.function.name).toBe("file_list");
    expect(JSON.stringify(outbound)).not.toContain("sk-xai-secret");
  });

  test("anthropic function calls arrive as runtime tool-call events", async () => {
    const calls: { url: string; apiKey: string | null }[] = [];
    const { app } = setup(
      {
        BOTANICAL_PROFILES: JSON.stringify([
          { id: "reason", name: "Reason", provider: "anthropic", model: "claude-sonnet-4-5", maxTokens: 128 },
        ]),
        ANTHROPIC_API_KEY: "sk-ant-secret",
        XAI_API_KEY: "",
        DEEPSEEK_API_KEY: "",
      },
      {
        fetch: async (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          calls.push({ url, apiKey: new Headers(init?.headers).get("x-api-key") });
          return sse(
            [
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Checking." },
              })}\n\n`,
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: 1,
                content_block: { type: "tool_use", id: "toolu_1", name: "file_list", input: {} },
              })}\n\n`,
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 1,
                delta: { type: "input_json_delta", partial_json: "{\"path\":\".\"}" },
              })}\n\n`,
              `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
              `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
            ].join(""),
          );
        },
      },
    );
    const { token } = await login(app);
    const agent = await createAgent(app, token, { toolIds: ["file_list"] });
    const created = await postJson(app, "/api/chats", { agentId: agent.id, profileId: "reason" }, bearer(token));
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "List files", profileId: "reason", stream: false },
      bearer(token),
    );
    expect(posted.status).toBe(201);
    const body = await readJson<{
      assistantMessage: { content: string };
      toolCall?: { name: string; arguments: { path: string } };
    }>(posted);
    expect(body.assistantMessage.content).toBe("Checking.");
    expect(body.toolCall).toMatchObject({ name: "file_list", arguments: { path: "." } });
    expect(JSON.stringify(body)).not.toContain("sk-ant-secret");
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.apiKey).toBe("sk-ant-secret");
  });

  test("a provider error is redacted and returned without the key", async () => {
    const { app } = setup(
      { XAI_API_KEY: "sk-xai-secret" },
      {
        fetch: async () => new Response("bad key sk-xai-secret", { status: 401 }),
      },
    );
    const { token } = await login(app);
    const agent = await createAgent(app, token);
    const created = await postJson(app, "/api/chats", { agentId: agent.id, profileId: "grok" }, bearer(token));
    const chatId = (await readJson<{ chat: { id: string } }>(created)).chat.id;
    const posted = await postJson(
      app,
      `/api/chats/${chatId}/messages`,
      { content: "Hi", profileId: "grok", stream: false },
      bearer(token),
    );
    expect(posted.status).toBe(201);
    const text = await posted.text();
    expect(text).toContain("[redacted]");
    expect(text).toContain("401");
    expect(text).not.toContain("sk-xai-secret");
  });
});
