import { describe, expect, test } from "bun:test";
import { estimateTokens, trimToBudget } from "../src/context";
import type { ChatMessage } from "../src/provider";

function user(content: string): ChatMessage {
  return { role: "user", content };
}

function assistant(content: string): ChatMessage {
  return { role: "assistant", content };
}

describe("trimToBudget", () => {
  test("leaves the transcript alone when there is no budget", () => {
    const messages = [user("a"), assistant("b")];
    expect(trimToBudget(messages, 0)).toEqual(messages);
    expect(trimToBudget(messages, -1)).toEqual(messages);
  });

  test("keeps the system message and the newest turn", () => {
    const system: ChatMessage = { role: "system", content: "rules" };
    const old = user("x".repeat(400));
    const reply = assistant("old reply");
    const newest = user("now");
    const trimmed = trimToBudget([system, old, reply, newest], 30);
    expect(trimmed[0]).toEqual(system);
    expect(trimmed.at(-1)).toEqual(newest);
    expect(trimmed.some((message) => message.content === old.content)).toBe(false);
  });

  test("keeps a tool result with the assistant turn that requested it", () => {
    const system: ChatMessage = { role: "system", content: "rules" };
    const first = user("first");
    const call: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call-1", name: "echo", arguments: {} }],
    };
    const tool: ChatMessage = { role: "tool", content: "echo:first", toolCallId: "call-1" };
    const second = user("second ".repeat(80));
    const trimmed = trimToBudget([system, first, call, tool, second], estimateTokens([system, second]) + 5);
    const roles = trimmed.map((message) => message.role);
    expect(roles[0]).toBe("system");
    expect(roles.at(-1)).toBe("user");
    if (roles.includes("assistant")) {
      expect(roles).toContain("tool");
    }
  });
});
