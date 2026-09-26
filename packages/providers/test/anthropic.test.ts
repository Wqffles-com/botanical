import { describe, expect, test } from "bun:test";
import { toAnthropicBody } from "../src/anthropic.ts";
import { ProviderError } from "../src/errors.ts";
import { collectChat } from "../src/collect.ts";
import { createRegistry } from "../src/registry.ts";
import { captureFetch, header, jsonBody, sseResponse } from "./helpers.ts";

describe("Anthropic adapter", () => {
  test("lifts system, groups tool results, and maps tool_use", () => {
    const body = toAnthropicBody({
      model: "claude-sonnet-4-5",
      maxTokens: 128,
      messages: [
        { role: "system", content: "one" },
        { role: "system", content: "two" },
        { role: "user", content: "weather in Paris" },
        {
          role: "assistant",
          content: "checking",
          toolCalls: [{ id: "toolu_1", name: "get_weather", arguments: { city: "Paris" } }],
        },
        { role: "tool", toolCallId: "toolu_1", content: "sunny" },
        { role: "tool", toolCallId: "toolu_2", content: "also" },
      ],
      tools: [{ name: "get_weather", description: "Weather", parameters: { type: "object", properties: {} } }],
    });

    expect(body.system).toBe("one\n\ntwo");
    expect(body.max_tokens).toBe(128);
    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "Weather",
        input_schema: { type: "object", properties: {} },
      },
    ]);
    const messages = body.messages as Array<{ role: string; content: unknown[] }>;
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "checking" },
      { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } },
    ]);
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "sunny" },
      { type: "tool_result", tool_use_id: "toolu_2", content: "also" },
    ]);
  });

  test("requires maxTokens instead of inventing one", () => {
    expect(() =>
      toAnthropicBody({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] }),
    ).toThrow(/maxTokens/);
  });

  test("streams text, thinking, and tool input", async () => {
    const raw = [
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 8, output_tokens: 1 } },
      })}\n\n`,
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
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Hi" },
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 1 })}\n\n`,
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
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 12 },
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");

    const captured = captureFetch(sseResponse([raw]));
    const registry = createRegistry(
      {
        providers: [{ id: "anthropic", type: "anthropic" }],
        profiles: [{ id: "reason", provider: "anthropic", model: "claude-sonnet-4-5", maxTokens: 64 }],
      },
      { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetch: captured.fetch },
    );
    const result = await collectChat(
      registry.complete({
        profileId: "reason",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(result.text).toBe("Hi");
    expect(result.reasoning).toBe("hmm");
    expect(result.toolCalls).toEqual([
      { id: "toolu_9", name: "get_weather", arguments: { city: "Paris" } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 12 });
    expect(captured.calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(header(captured.calls[0]?.init, "x-api-key")).toBe("sk-ant-test");
    expect(header(captured.calls[0]?.init, "anthropic-version")).toBe("2023-06-01");
    expect(header(captured.calls[0]?.init, "authorization")).toBeUndefined();
    const body = jsonBody(captured.calls[0]?.init);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.max_tokens).toBe(64);
    expect(body.stream).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-ant-test");
  });

  test("profile maxTokens is required before fetch", () => {
    const captured = captureFetch(sseResponse([""]));
    const registry = createRegistry(
      {
        providers: [{ id: "anthropic", type: "anthropic" }],
        profiles: [{ id: "reason", provider: "anthropic", model: "claude-sonnet-4-5" }],
      },
      { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetch: captured.fetch },
    );
    expect(() =>
      registry.complete({ profileId: "reason", messages: [{ role: "user", content: "hi" }] }),
    ).toThrow(ProviderError);
    expect(captured.calls).toHaveLength(0);
  });
});
