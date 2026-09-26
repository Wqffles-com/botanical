import { describe, expect, test } from "bun:test";
import { ProviderError } from "../src/errors.ts";
import { toOpenAIMessages } from "../src/openai-client.ts";
import { createRegistry } from "../src/registry.ts";
import { collectChat } from "../src/collect.ts";
import { captureFetch, dataEvents, header, jsonBody, sseResponse } from "./helpers.ts";

describe("OpenAI-compatible client", () => {
  test("maps messages, images, and tool history", () => {
    const messages = toOpenAIMessages([
      { role: "system", content: "be brief" },
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image", data: "aaaa", mediaType: "image/png" },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "lookup", arguments: { q: "x" } }],
      },
      { role: "tool", toolCallId: "call_1", name: "lookup", content: "found" },
    ]);
    expect(messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aaaa" } },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } },
      ],
    });
    expect(messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      name: "lookup",
      content: "found",
    });
  });

  test("streams text, assembles tool calls, and reads usage", async () => {
    const toolStream = [
      dataEvents([
        JSON.stringify({ choices: [{ delta: { content: "Sure. " } }] }),
      ]).slice(0, 20),
    ];
    const rest = dataEvents([
      JSON.stringify({ choices: [{ delta: { content: "Sure. " } }] }),
    ]).slice(20);
    const tail = dataEvents([
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
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"city\":" } }] } }],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"Paris\"}" } }] } }],
      }),
      JSON.stringify({
        choices: [{ delta: { reasoning_content: "look up" } }],
      }),
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }),
      "[DONE]",
    ]);

    const captured = captureFetch(sseResponse([toolStream[0] ?? "", rest + tail]));
    const registry = createRegistry(
      {
        providers: [{ id: "openai", type: "openai" }],
        profiles: [{ id: "chat", provider: "openai", model: "gpt-4.1", temperature: 0.2, maxTokens: 32 }],
      },
      { env: { OPENAI_API_KEY: "sk-test-openai" }, fetch: captured.fetch },
    );

    const result = await collectChat(
      registry.complete({
        profileId: "chat",
        messages: [{ role: "user", content: "weather" }],
        tools: [{ name: "get_weather", description: "Weather", parameters: { type: "object" } }],
      }),
    );

    expect(result.done).toBe(true);
    expect(result.text).toBe("Sure. ");
    expect(result.reasoning).toBe("look up");
    expect(result.toolCalls).toEqual([
      { id: "call_1", name: "get_weather", arguments: { city: "Paris" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 4 });
    expect(captured.calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(header(captured.calls[0]?.init, "authorization")).toBe("Bearer sk-test-openai");
    const body = jsonBody(captured.calls[0]?.init);
    expect(body.model).toBe("gpt-4.1");
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.2);
    expect(body.max_completion_tokens).toBe(32);
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(JSON.stringify(body)).not.toContain("sk-test-openai");
  });

  test("redacts the server key from HTTP errors", async () => {
    const secret = "sk-test-openai";
    const captured = captureFetch(
      () => new Response(`{"error":{"message":"bad key ${secret}"}}`, { status: 401 }),
    );
    const registry = createRegistry(
      {
        providers: [{ id: "openai", type: "openai" }],
        profiles: [{ id: "chat", provider: "openai", model: "gpt-4.1" }],
      },
      { env: { OPENAI_API_KEY: secret }, fetch: captured.fetch },
    );
    let caught: unknown;
    try {
      await collectChat(
        registry.complete({ profileId: "chat", messages: [{ role: "user", content: "hi" }] }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.status).toBe(401);
    expect(error.code).toBe("http");
    expect(error.message).toContain("[redacted]");
    expect(error.message).not.toContain(secret);
  });
});
