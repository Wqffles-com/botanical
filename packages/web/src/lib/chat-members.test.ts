import { describe, expect, test } from "bun:test";
import type { Agent } from "@botanical/core";

import { isGroupChat, messageAuthor, toggleMember } from "./chat-members";

describe("chat members", () => {
  test("toggling keeps speaking order", () => {
    expect(toggleMember(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleMember(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  test("a chat is a group only with members", () => {
    expect(isGroupChat({ memberIds: [] })).toBe(false);
    expect(isGroupChat({ memberIds: ["b"] })).toBe(true);
    expect(isGroupChat(null)).toBe(false);
  });

  test("replies without an author belong to the owner", () => {
    const agents = [{ id: "a", name: "Ada" }, { id: "b", name: "Bob" }] as Agent[];
    const chat = { agentId: "a" };
    expect(messageAuthor({ role: "assistant", agentId: "b" }, chat, agents)?.name).toBe("Bob");
    expect(messageAuthor({ role: "assistant" }, chat, agents)?.name).toBe("Ada");
    expect(messageAuthor({ role: "user" }, chat, agents)).toBeNull();
  });
});
