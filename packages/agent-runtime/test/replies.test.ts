import { describe, expect, test } from "bun:test";
import { createAgentSchema } from "../src/agent";
import { createAgentMessageBus } from "../src/bus";
import { createMemoryStore } from "../src/memory";
import { staticProfileResolver } from "../src/profiles";
import { runAgentTurn, type RuntimeDeps } from "../src/loop";
import { isSentMessage, replyIds, SENT_MESSAGE_NAME } from "../src/replies";
import { createScriptedProvider } from "../src/testing";
import type { RuntimeEvent } from "../src/index";

async function setup(script: Parameters<typeof createScriptedProvider>[0], options: { members?: boolean } = {}) {
  const store = createMemoryStore();
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  const make = (name: string) =>
    store.agents.create(
      createAgentSchema.parse({ name, prompt: `You are ${name}.`, toolAllowlist: [], a2aEnabled: false }),
    );
  const ada = await make("Ada");
  const bob = await make("Bob");
  const chat = await store.chats.create({ agentId: ada.id, ...(options.members ? { memberIds: [bob.id] } : {}) });
  const provider = createScriptedProvider(script);
  const deps: RuntimeDeps = {
    store,
    bus,
    profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
    toolSources: [],
  };
  return { store, deps, chat, ada, bob, provider };
}

async function collect(deps: RuntimeDeps, input: Parameters<typeof runAgentTurn>[1]) {
  const events: RuntimeEvent[] = [];
  for await (const event of runAgentTurn(deps, input)) events.push(event);
  return events;
}

describe("send_message", () => {
  test("stores each message as its own row, so one turn can send several", async () => {
    const { deps, chat, store, provider } = await setup([
      () => [
        { type: "text-delta", text: "Checking the logs first." },
        { type: "tool-call", id: "c1", name: "send_message", arguments: { text: "On it." } },
        { type: "done" },
      ],
      () => [{ type: "tool-call", id: "c2", name: "send_message", arguments: { text: "Found it." } }, { type: "done" }],
      () => [{ type: "done" }],
    ]);
    const events = await collect(deps, { chatId: chat.id, content: "Why is it slow?", profileId: "fast" });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });

    const rows = await store.messages.listByChat(chat.id);
    const sent = rows.filter(isSentMessage);
    expect(sent.map((row) => [row.role, row.content])).toEqual([
      ["assistant", "On it."],
      ["assistant", "Found it."],
    ]);
    expect([...replyIds(rows, chat.agentId)]).toEqual(sent.map((row) => row.id));

    // The model reads its messages once, in its own tool calls, not again as rows.
    const last = provider.requests.at(-1)?.messages ?? [];
    expect(last.filter((message) => message.content === "On it.")).toEqual([]);
    expect(last[0]?.content).toContain("send_message");
  });

  test("is offered to an agent with an empty allowlist and A2A off", async () => {
    const { deps, chat, provider } = await setup([
      () => [{ type: "tool-call", id: "c1", name: "send_message", arguments: { text: "Hi" } }, { type: "done" }],
      () => [{ type: "done" }],
    ]);
    const events = await collect(deps, { chatId: chat.id, content: "Hello", profileId: "fast" });
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(["send_message"]);
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({ name: "send_message", isError: false });
  });

  test("rejects an empty message", async () => {
    const { deps, chat } = await setup([
      () => [{ type: "tool-call", id: "c1", name: "send_message", arguments: { text: "  " } }, { type: "done" }],
      () => [{ type: "done" }],
    ]);
    const events = await collect(deps, { chatId: chat.id, content: "Hello", profileId: "fast" });
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({ isError: true });
  });

  test("in a group chat, others read an agent's messages and not its notes", async () => {
    const { deps, chat, bob, provider } = await setup(
      [
        () => [
          { type: "text-delta", text: "private note" },
          { type: "tool-call", id: "c1", name: "send_message", arguments: { text: "Ada here." } },
          { type: "done" },
        ],
        () => [{ type: "done" }],
        () => [{ type: "done" }],
      ],
      { members: true },
    );
    await collect(deps, { chatId: chat.id, content: "Hi both", profileId: "fast" });
    await collect(deps, { chatId: chat.id, content: "Hi both", profileId: "fast", agentId: bob.id, appendUserMessage: false });
    const bobRequest = provider.requests.at(-1)?.messages ?? [];
    expect(bobRequest.slice(1).map((message) => [message.role, message.content])).toEqual([
      ["user", "Hi both"],
      ["user", "[Ada] Ada here."],
    ]);
  });
});

describe("replyIds", () => {
  const row = (id: string, role: "user" | "assistant" | "tool", content: string, extra: { name?: string; agentId?: string } = {}) => ({
    id,
    role,
    content,
    ...extra,
  });

  test("a round with no sent messages reads the text output, as older chats did", () => {
    const ids = replyIds(
      [row("u1", "user", "hi"), row("a1", "assistant", "hello"), row("a2", "assistant", "")],
      "owner",
    );
    expect([...ids]).toEqual(["a1"]);
  });

  test("a round with sent messages hides that agent's text output, per agent", () => {
    const ids = replyIds(
      [
        row("u1", "user", "hi"),
        row("a1", "assistant", "note", { agentId: "ada" }),
        row("s1", "assistant", "Hello", { agentId: "ada", name: SENT_MESSAGE_NAME }),
        row("b1", "assistant", "Bob says hi", { agentId: "bob" }),
        row("u2", "user", "again"),
        row("a2", "assistant", "plain", { agentId: "ada" }),
      ],
      "ada",
    );
    expect([...ids]).toEqual(["s1", "b1", "a2"]);
  });
});
