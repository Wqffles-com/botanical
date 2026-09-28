import { describe, expect, test } from "bun:test";
import { BotanicalApiError, ProfileRequiredError, type Agent, type Chat, type ChatMessage } from "@botanical/core";
import { canStartChat, chatsByAgent } from "./chat-groups";
import { applyStreamEvent, emptyDraft, presentThread, toolResultStatus } from "./chat-stream";
import { isProfileRequired, isProfileUnavailable, profileRequiredMessage, profileUnavailableText } from "./errors";

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

  test("marks a tool result as an error when the stream says so", () => {
    let draft = emptyDraft("chat-1");
    draft = applyStreamEvent(draft, { type: "tool-call", id: "t1", name: "file_write", arguments: {} });
    draft = applyStreamEvent(draft, { type: "tool-result", id: "t1", content: "denied", isError: true });
    expect(draft.toolCalls[0]?.status).toBe("error");
    expect(toolResultStatus('{"error":"permission denied: file.write"}')).toBe("error");
    expect(toolResultStatus("README.md")).toBe("done");
  });
});

describe("presentThread", () => {
  test("merges a tool result into the assistant call", () => {
    const messages: ChatMessage[] = [
      {
        id: "a1",
        chatId: "c",
        role: "assistant",
        content: "Done",
        createdAt: "t",
        toolCalls: [{ id: "t1", name: "file_list", arguments: { path: "." } }],
      },
      {
        id: "r1",
        chatId: "c",
        role: "tool",
        content: "README.md",
        toolCallId: "t1",
        name: "file_list",
        createdAt: "t2",
      },
    ];
    const rows = presentThread(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tools[0]).toMatchObject({ id: "t1", result: "README.md", status: "done" });
  });
});

describe("profile_unavailable", () => {
  test("turns a 422 into a profile-specific message", () => {
    const error = new BotanicalApiError("CLI binary not found", {
      status: 422,
      body: { error: { code: "profile_unavailable", message: "CLI binary not found" } },
    });
    expect(isProfileUnavailable(error)).toBe(true);
    expect(profileUnavailableText("Grok Build", error.message)).toBe(
      "Grok Build is unavailable: CLI binary not found. Pick another profile.",
    );
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
    prompt: "",
    title: "",
    icon: "Bot",
    shape: "squircle",
    picture: null,
    color: "green",
    toolIds: [],
    tools: [],
    defaultProfileId: null,
    createdByAgentId: null,
    roleIds: [],
    roles: [],
    effectivePermissions: { unrestricted: true, capabilities: [], mcp: [], roleNames: [] },
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
