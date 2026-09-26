import { describe, expect, test } from "bun:test";

import { createConfiguredRegistry, createRuntimeBridge, selectProfiles } from "../src/index.ts";
import type { RuntimeChatEvent } from "../src/runtime.ts";
import { captureFetch, dataEvents, header, jsonBody, sseResponse } from "./helpers.ts";

const weatherTool = {
  name: "get_weather",
  description: "Weather",
  parameters: { type: "object", properties: { city: { type: "string" } } },
};

function openAiSse(): string {
  return dataEvents([
    JSON.stringify({ choices: [{ delta: { content: "Sure. " } }] }),
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } },
            ],
          },
        },
      ],
    }),
    JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"city\":\"Paris\"}" } }] } }],
    }),
    JSON.stringify({ choices: [{ delta: { reasoning_content: "hidden" } }] }),
    JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    "[DONE]",
  ]);
}

const anthropicSse = [
  `event: content_block_start\ndata: ${JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "hmm" },
  })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "Hi" },
  })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "toolu_9", name: "get_weather", input: {} },
  })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 2,
    delta: { type: "input_json_delta", partial_json: "{\"city\":\"Paris\"}" },
  })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 2 })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    usage: { output_tokens: 5 },
  })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
].join("");

async function collect(stream: AsyncIterable<RuntimeChatEvent>): Promise<RuntimeChatEvent[]> {
  const events: RuntimeChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("runtime bridge", () => {
  const cases = [
    {
      id: "openai",
      env: { OPENAI_API_KEY: "sk-openai" },
      key: "sk-openai",
      url: "https://api.openai.com/v1/chat/completions",
      tokenField: "max_completion_tokens",
    },
    {
      id: "xai",
      env: { XAI_API_KEY: "sk-xai" },
      key: "sk-xai",
      url: "https://api.x.ai/v1/chat/completions",
      tokenField: "max_tokens",
    },
    {
      id: "deepseek",
      env: { DEEPSEEK_API_KEY: "sk-deepseek" },
      key: "sk-deepseek",
      url: "https://api.deepseek.com/chat/completions",
      tokenField: "max_tokens",
    },
    {
      id: "openrouter",
      env: { OPENROUTER_API_KEY: "sk-router" },
      key: "sk-router",
      url: "https://openrouter.ai/api/v1/chat/completions",
      tokenField: "max_tokens",
    },
    {
      id: "openai-compat",
      env: {
        OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:11434/v1",
        OPENAI_COMPAT_API_KEY: "sk-local",
        OPENAI_COMPAT_MODEL: "llama",
      },
      key: "sk-local",
      url: "http://127.0.0.1:11434/v1/chat/completions",
      tokenField: "max_tokens",
    },
  ] as const;

  for (const item of cases) {
    test(`${item.id} streams text and tool calls through the runtime interface`, async () => {
      const captured = captureFetch(sseResponse([openAiSse()]));
      const profiles = selectProfiles(undefined, item.env);
      const registry = createConfiguredRegistry(profiles, { env: { ...item.env }, fetch: captured.fetch });
      const bridge = createRuntimeBridge(registry);
      const resolved = await bridge.resolve(item.id);
      const events = await collect(
        resolved.provider.complete({
          model: resolved.model,
          maxTokens: 32,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "weather" },
                { type: "image", url: "https://example.com/plot.png", mimeType: "image/png" },
              ],
            },
          ],
          tools: [weatherTool],
        }),
      );

      expect(events.map((event) => event.type)).not.toContain("reasoning-delta");
      expect(events).toContainEqual({ type: "text-delta", text: "Sure. " });
      expect(events).toContainEqual({
        type: "tool-call",
        id: "call_1",
        name: "get_weather",
        arguments: { city: "Paris" },
      });
      expect(events).toContainEqual({ type: "usage", inputTokens: 3, outputTokens: 4 });
      expect(events.at(-1)).toEqual({ type: "done" });

      const caps = resolved.provider.capabilities(resolved.model);
      expect(Object.keys(caps).sort()).toEqual(["maxContext", "parallelTools", "streaming", "tools", "vision"]);
      expect(caps.tools).toBe(true);
      expect(caps.streaming).toBe(true);

      expect(captured.calls[0]?.url).toBe(item.url);
      expect(header(captured.calls[0]?.init, "authorization")).toBe(`Bearer ${item.key}`);
      const body = jsonBody(captured.calls[0]?.init);
      expect(body.model).toBe(resolved.model);
      expect(body.stream).toBe(true);
      expect(body[item.tokenField]).toBe(32);
      expect(JSON.stringify(body)).toContain("get_weather");
      expect(JSON.stringify(body)).toContain("https://example.com/plot.png");
      expect(JSON.stringify(body)).not.toContain(item.key);
      if (item.id === "openrouter") expect(header(captured.calls[0]?.init, "X-Title")).toBe("Botanical");
      if (item.id === "openai-compat") expect(body.stream_options).toBeUndefined();
    });
  }

  test("anthropic tool calls normalize to the same runtime events", async () => {
    const captured = captureFetch(sseResponse([anthropicSse]));
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" };
    const profiles = selectProfiles(undefined, env);
    const registry = createConfiguredRegistry(profiles, { env, fetch: captured.fetch });
    const bridge = createRuntimeBridge(registry);
    const resolved = await bridge.resolve("anthropic");
    const events = await collect(
      resolved.provider.complete({
        model: resolved.model,
        messages: [{ role: "user", content: "hi" }],
        tools: [weatherTool],
      }),
    );

    expect(events.map((event) => event.type)).not.toContain("reasoning-delta");
    expect(events).toContainEqual({ type: "text-delta", text: "Hi" });
    expect(events).toContainEqual({
      type: "tool-call",
      id: "toolu_9",
      name: "get_weather",
      arguments: { city: "Paris" },
    });
    expect(captured.calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(header(captured.calls[0]?.init, "x-api-key")).toBe("sk-ant-test");
    expect(header(captured.calls[0]?.init, "authorization")).toBeUndefined();
    const body = jsonBody(captured.calls[0]?.init);
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(true);
    expect(JSON.stringify(body.tools)).toContain("get_weather");
    expect(JSON.stringify(body)).not.toContain("sk-ant-test");
  });
});
