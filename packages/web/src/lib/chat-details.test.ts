import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@botanical/core";
import { chatDetails, formatBytes, parentPath } from "./chat-details";

function row(partial: Partial<ChatMessage> & Pick<ChatMessage, "role">): ChatMessage {
  return { id: Math.random().toString(36), chatId: "c", content: "", createdAt: "", ...partial };
}

describe("chatDetails", () => {
  test("counts messages, tool calls, and the latest context size", () => {
    const details = chatDetails([
      row({ role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" }),
      row({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "file_list", arguments: {} }],
        usage: { inputTokens: 100, outputTokens: 10 },
        createdAt: "2026-01-01T00:00:01Z",
      }),
      row({ role: "tool", content: "a.txt file 3", toolCallId: "t1", createdAt: "2026-01-01T00:00:02Z" }),
      row({ role: "assistant", content: "done", usage: { inputTokens: 150, outputTokens: 5 }, createdAt: "2026-01-01T00:00:03Z" }),
    ]);
    expect(details).toMatchObject({
      messages: 3,
      user: 1,
      assistant: 2,
      toolCalls: 1,
      inputTokens: 250,
      outputTokens: 15,
      contextTokens: 155,
      characters: 9,
      firstAt: "2026-01-01T00:00:00Z",
      lastAt: "2026-01-01T00:00:03Z",
    });
  });

  test("context is unknown when no reply reports usage", () => {
    expect(chatDetails([row({ role: "user", content: "hi" })]).contextTokens).toBeNull();
  });
});

describe("workspace helpers", () => {
  test("parentPath walks up to the root", () => {
    expect(parentPath(".")).toBeNull();
    expect(parentPath("notes")).toBe(".");
    expect(parentPath("notes/2026/plan")).toBe("notes/2026");
  });

  test("formatBytes", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
