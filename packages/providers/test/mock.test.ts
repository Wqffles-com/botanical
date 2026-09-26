import { describe, expect, test } from "bun:test";
import { collectChat } from "../src/collect.ts";
import { createMockProvider } from "../src/mock.ts";
import { createRegistry } from "../src/registry.ts";

describe("mock provider", () => {
  test("records the request and streams a reply in chunks", async () => {
    const mock = createMockProvider("mock", { reply: "hello world", chunkSize: 5 });
    const result = await collectChat(
      mock.complete({ model: "mock-1", messages: [{ role: "user", content: "hi" }] }),
    );
    expect(result.text).toBe("hello world");
    expect(result.events.filter((event) => event.type === "text-delta").map((event) => event.type === "text-delta" ? event.text : "")).toEqual([
      "hello",
      " worl",
      "d",
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.model).toBe("mock-1");
    expect(mock.calls[0]?.signal).toBeUndefined();
  });

  test("emits scripted tool calls through the registry", async () => {
    const registry = createRegistry({
      providers: [
        {
          id: "mock",
          type: "mock",
          mock: {
            events: [
              { type: "tool-call", id: "call_1", name: "echo", arguments: { text: "hi" } },
            ],
          },
        },
      ],
      profiles: [{ id: "mock", provider: "mock", model: "mock-1" }],
    });
    const result = await collectChat(
      registry.complete({
        profileId: "mock",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(result.toolCalls).toEqual([{ id: "call_1", name: "echo", arguments: { text: "hi" } }]);
    expect(result.done).toBe(true);
    expect(registry.capabilities("mock").tools).toBe(true);
  });

  test("echoes the last user message when no script is set", async () => {
    const mock = createMockProvider();
    const result = await collectChat(
      mock.complete({ model: "mock-1", messages: [{ role: "user", content: "ping" }] }),
    );
    expect(result.text).toBe("mock:ping");
  });
});
