import { describe, expect, test } from "bun:test";
import type { Chat } from "@botanical/core";
import { agentChatHref, groupChats, ownChat } from "./chat-groups";

function chat(id: string, agentId: string, memberIds: string[], updatedAt: string): Chat {
  return { id, agentId, memberIds, profileId: "grok", title: id, createdAt: updatedAt, updatedAt };
}

describe("one chat per agent", () => {
  const chats = [
    chat("group-old", "ada", ["bo"], "2026-09-01T00:00:00Z"),
    chat("ada-own", "ada", [], "2026-09-02T00:00:00Z"),
    chat("group-new", "bo", ["ada"], "2026-09-03T00:00:00Z"),
  ];

  test("finds the agent's own chat and links to it", () => {
    expect(ownChat("ada", chats)?.id).toBe("ada-own");
    expect(ownChat("bo", chats)).toBeNull();
    expect(agentChatHref("ada", chats)).toBe("/chats/ada-own");
    // Before its first conversation, the agent's chat page opens one.
    expect(agentChatHref("bo", chats)).toBe("/agents/bo/chat");
  });

  test("lists group chats, newest first", () => {
    expect(groupChats(chats).map((item) => item.id)).toEqual(["group-new", "group-old"]);
  });
});
