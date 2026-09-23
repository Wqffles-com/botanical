import { describe, expect, test } from "bun:test";
import type { Agent, Chat, ChatMessage, ModelProfile } from "@botanical/core";
import { mergeServerMessages } from "./merge";
import { canSend, canStartChat, initialAppState, profileForChat, reducer, type AppState } from "./model";

const profile: ModelProfile = {
  id: "grok",
  name: "Grok",
  provider: "xai",
  model: "grok-4",
  description: null,
};

const other: ModelProfile = { ...profile, id: "fast", name: "Fast", provider: "deepseek", model: "deepseek-chat" };

const research: Agent = {
  id: "agent-research",
  name: "Research",
  description: "Looks things up",
  systemPrompt: "",
  toolIds: [],
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
};

const gardener: Agent = { ...research, id: "agent-garden", name: "Gardener" };

function ready(): AppState {
  return reducer(
    { ...initialAppState, profiles: [profile, other] },
    { type: "boot-ready", mode: "SELF_HOST", agents: [research, gardener], profiles: [profile, other], chats: [] },
  );
}

describe("new chat gates", () => {
  test("a new chat starts with no agent and no profile", () => {
    const drafted = reducer(ready(), { type: "open-draft" });
    expect(drafted.draft).toEqual({ agentId: null, profileId: null, title: "" });
    expect(canStartChat(drafted.draft)).toBe(false);
    expect(drafted.profileByChat).toEqual({});
  });

  test("the agent picker keeps a single agent and still requires a profile", () => {
    let state = reducer(ready(), { type: "open-draft" });
    state = reducer(state, { type: "draft-agent", agentId: research.id });
    state = reducer(state, { type: "draft-agent", agentId: gardener.id });
    expect(state.draft?.agentId).toBe(gardener.id);
    expect(canStartChat(state.draft)).toBe(false);
    state = reducer(state, { type: "draft-profile", profileId: profile.id });
    expect(canStartChat(state.draft)).toBe(true);
  });

  test("creating a chat remembers that explicit profile even if the server omits it", () => {
    const chat: Chat = {
      id: "chat-1",
      agentId: gardener.id,
      profileId: null,
      title: "Soil",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    };
    const state = reducer(ready(), { type: "chat-created", chat, profileId: "grok" });
    expect(state.activeChatId).toBe("chat-1");
    expect(state.draft).toBeNull();
    expect(profileForChat(state)).toBe("grok");
    expect(state.chats[0]?.profileId).toBe("grok");
    expect(canSend(state)).toBe(true);
  });

  test("opening another draft does not reuse the previous profile", () => {
    let state = reducer(ready(), { type: "open-draft" });
    state = reducer(state, { type: "draft-profile", profileId: "fast" });
    state = reducer(state, { type: "open-draft" });
    expect(state.draft?.profileId).toBeNull();
  });
});

describe("sending", () => {
  test("blocks sending until a profile is selected, then accumulates stream text", () => {
    const chat: Chat = {
      id: "chat-2",
      agentId: research.id,
      profileId: null,
      title: "Untitled chat",
      createdAt: "2026-09-23T01:00:00.000Z",
      updatedAt: "2026-09-23T01:00:00.000Z",
    };
    let state = reducer(ready(), { type: "chat-created", chat, profileId: "" });
    state = reducer(state, { type: "select-profile", chatId: chat.id, profileId: null });
    expect(canSend(state)).toBe(false);

    state = reducer(state, { type: "select-profile", chatId: chat.id, profileId: "fast" });
    expect(canSend(state)).toBe(true);
    state = reducer(state, { type: "stream-start", chatId: chat.id });
    expect(canSend(state)).toBe(false);
    state = reducer(state, { type: "stream-delta", text: "Hel" });
    state = reducer(state, { type: "stream-delta", text: "lo" });
    expect(state.streaming?.text).toBe("Hello");
  });
});

describe("mergeServerMessages", () => {
  const user: ChatMessage = {
    id: "local-user",
    chatId: "c",
    role: "user",
    content: "Hello",
    createdAt: "2026-09-23T00:00:00.000Z",
  };
  const assistant: ChatMessage = {
    id: "local-assistant",
    chatId: "c",
    role: "assistant",
    content: "Hi",
    createdAt: "2026-09-23T00:00:01.000Z",
  };

  test("keeps the streamed transcript when the server has not stored the turn", () => {
    expect(mergeServerMessages([user, assistant], [], "Hello", assistant)).toEqual([user, assistant]);
    expect(mergeServerMessages([user, assistant], [{ ...user, id: "old", content: "Earlier" }], "Hello", assistant)).toEqual([
      user,
      assistant,
    ]);
  });

  test("uses the server transcript once it contains the turn", () => {
    const server = [
      { ...user, id: "u1" },
      { ...assistant, id: "a1" },
    ];
    expect(mergeServerMessages([user, assistant], server, "Hello", assistant)).toEqual(server);
  });
});
