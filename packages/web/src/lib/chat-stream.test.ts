import { describe, expect, test } from "bun:test";
import { applyStreamEvent, emptyDraft } from "./chat-stream";
import { canStartChat, chatsByAgent } from "./chat-groups";
import { isProfileRequired, profileRequiredMessage } from "./errors";
import { ProfileRequiredError } from "@botanical/core";
import type { Agent, Chat } from "@botanical/core";

describe("new chat gates", () => {
  test("requires both an agent and a profile, with no default", () => {
    expect(canStartChat(null, null)).toBe(false);
    expect(canStartChat("agent-1", null)).toBe(false);
    expect(canStartChat(null, "grok")).toBe(false);
    expect(canStartChat("  ", "grok")).toBe(false);
    expect(canStartChat("agent-1", "grok")).toBe(true);
  });
});

describe("applyStreamEvent", () => {
  test("accumulates text, tool calls, and tool results", () => {
    let draft = emptyDraft("chat-1");
    draft = applyStreamEvent(draft, { type: "message-start", messageId: "a1", role: "assistant" });
    draft = applyStreamEvent(draft, {
      type: "tool-call",
      id: "t1",
      name: "file_list",
      arguments: { path: "." },
    });
    expect(draft.toolCalls).toEqual([
      { id: "t1", name: "file_list", arguments: { path: "." }, status: "running" },
    ]);
    draft = applyStreamEvent(draft, { type: "tool-result", id: "t1", content: "README.md" });
    expect(draft.toolCalls[0]).toMatchObject({ result: "README.md", status: "done" });
    draft = applyStreamEvent(draft, { type: "text-delta", text: "Hel" });
    draft = applyStreamEvent(draft, { type: "text-delta", text: "lo" });
    draft = applyStreamEvent(draft, { type: "usage", inputTokens: 3, outputTokens: 2 });
    draft = applyStreamEvent(draft, { type: "done", messageId: "a1" });
    expect(draft).toMatchObject({
      id: "a1",
      content: "Hello",
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });
});

describe("profile_required", () => {
  test("detects the locked error and keeps a readable message", () => {
    expect(isProfileRequired(new ProfileRequiredError())).toBe(true);
    expect(isProfileRequired(new Error("profile_required"))).toBe(true);
    expect(profileRequiredMessage()).toContain("no default model");
  });
});

describe("chatsByAgent", () => {
  const research: Agent = {
    id: "agent-research",
    name: "Research",
    description: "",
    systemPrompt: "",
    toolIds: [],
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
  const gardener: Agent = { ...research, id: "agent-garden", name: "Gardener" };

  test("groups chats under their owning agent", () => {
    const chats: Chat[] = [
      {
        id: "c2",
        agentId: gardener.id,
        profileId: "grok",
        title: "Soil",
        createdAt: "2026-09-23T02:00:00.000Z",
        updatedAt: "2026-09-23T02:00:00.000Z",
      },
      {
        id: "c1",
        agentId: research.id,
        profileId: null,
        title: "Notes",
        createdAt: "2026-09-23T01:00:00.000Z",
        updatedAt: "2026-09-23T03:00:00.000Z",
      },
    ];
    const groups = chatsByAgent(chats, [research, gardener]);
    expect(groups.map((group) => group.agent?.name)).toEqual(["Gardener", "Research"]);
    expect(groups[1]?.chats[0]?.id).toBe("c1");
  });
});
