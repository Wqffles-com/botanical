import { describe, expect, test } from "bun:test";

import { normalizeChat, normalizeChatEvent, normalizeMessage } from "./normalize";

describe("group chat wire shapes", () => {
  test("chats carry their members, and older payloads read as one-agent chats", () => {
    const base = { id: "c1", agentId: "a", profileId: "grok", title: "Team", createdAt: "2026-09-29T00:00:00.000Z" };
    expect(normalizeChat({ chat: { ...base, memberIds: ["b", "", 3, "c"] } }).memberIds).toEqual(["b", "c"]);
    expect(normalizeChat({ chat: base }).memberIds).toEqual([]);
  });

  test("messages keep their author and the status event names who is answering", () => {
    const message = normalizeMessage({ id: "m1", chatId: "c1", role: "assistant", content: "Hi", agentId: "b" });
    expect(message.agentId).toBe("b");
    expect(normalizeChatEvent("status", { running: true, queued: [], agentId: "b" })).toEqual({
      type: "status",
      running: true,
      queued: [],
      agentId: "b",
    });
  });
});
