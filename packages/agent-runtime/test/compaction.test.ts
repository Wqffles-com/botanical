import { describe, expect, test } from "bun:test";
import { createAgentSchema } from "../src/agent";
import { createAgentMessageBus } from "../src/bus";
import {
  COMPACTION_NAME,
  NothingToCompactError,
  autoCompact,
  compactChat,
  needsCompaction,
  sinceCompaction,
} from "../src/compaction";
import { createMemoryStore } from "../src/memory";
import { staticProfileResolver } from "../src/profiles";
import { runAgentTurn, type RuntimeDeps } from "../src/loop";
import type { MessageRecord } from "../src/message";
import type { ChatRequest } from "../src/provider";
import { createScriptedProvider } from "../src/testing";

function reply(text: string) {
  return () => [{ type: "text-delta" as const, text }, { type: "done" as const }];
}

async function harness(script: Parameters<typeof createScriptedProvider>[0]) {
  const store = createMemoryStore();
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  const agent = await store.agents.create(createAgentSchema.parse({ name: "Ada", prompt: "You are Ada." }));
  const chat = await store.chats.create({ agentId: agent.id });
  const provider = createScriptedProvider(script);
  const deps: RuntimeDeps = {
    store,
    bus,
    profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
    toolSources: [],
  };
  async function turn(content: string) {
    for await (const event of runAgentTurn(deps, { chatId: chat.id, content, profileId: "fast" })) void event;
  }
  return { store, deps, chat, provider, turn };
}

function systemText(request: ChatRequest | undefined): string {
  const content = request?.messages[0]?.content;
  return typeof content === "string" ? content : "";
}

describe("compaction", () => {
  test("a summary stands in for the messages before it", async () => {
    const { store, deps, chat, provider, turn } = await harness([
      reply("Tomatoes need water."),
      reply("The user grows tomatoes and asked about watering."),
      reply("Water them at dawn."),
    ]);
    await turn("How do I keep tomatoes alive?");

    const summary = await compactChat(deps, { chatId: chat.id, profileId: "fast" });
    expect(summary.role).toBe("system");
    expect(summary.name).toBe(COMPACTION_NAME);
    expect(summary.content).toBe("The user grows tomatoes and asked about watering.");
    // The summary request carries the conversation as text and offers no tools.
    const request = provider.requests[1];
    expect(request?.tools).toEqual([]);
    expect(JSON.stringify(request?.messages)).toContain("How do I keep tomatoes alive?");

    await turn("When?");
    const next = provider.requests[2];
    expect(systemText(next)).toContain("## Earlier in this chat");
    expect(systemText(next)).toContain("The user grows tomatoes and asked about watering.");
    const said = JSON.stringify(next?.messages.slice(1));
    expect(said).not.toContain("How do I keep tomatoes alive?");
    expect(said).toContain("When?");

    // Everything stays in the chat for the user.
    const rows = await store.messages.listByChat(chat.id);
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "system", "user", "assistant"]);
  });

  test("nothing after the last summary is nothing to compact", async () => {
    const { deps, chat, turn } = await harness([reply("Hi."), reply("Summary.")]);
    await expect(compactChat(deps, { chatId: chat.id, profileId: "fast" })).rejects.toBeInstanceOf(
      NothingToCompactError,
    );
    await turn("Hello");
    await compactChat(deps, { chatId: chat.id, profileId: "fast" });
    await expect(compactChat(deps, { chatId: chat.id, profileId: "fast" })).rejects.toBeInstanceOf(
      NothingToCompactError,
    );
  });

  test("auto-compaction waits until the chat outgrows the context", async () => {
    const long = "x".repeat(16_000);
    const script = [
      ...Array.from({ length: 4 }, () => reply(long)),
      reply("Short summary."),
    ];
    const { deps, chat, provider, turn } = await harness(script);
    await turn("first");
    expect(await autoCompact(deps, { chatId: chat.id, profileId: "fast" })).toBeNull();
    for (const content of ["second", "third", "fourth"]) await turn(content);
    const summary = await autoCompact(deps, { chatId: chat.id, profileId: "fast" });
    expect(summary?.content).toBe("Short summary.");
    expect(provider.requests).toHaveLength(5);
    // Right after a summary there is nothing left to compact.
    expect(await autoCompact(deps, { chatId: chat.id, profileId: "fast" })).toBeNull();
  });

  test("needsCompaction counts only what the model still reads", () => {
    const row = (role: MessageRecord["role"], content: string, name?: string): MessageRecord => ({
      id: crypto.randomUUID(),
      chatId: "c",
      role,
      content,
      createdAt: new Date().toISOString(),
      ...(name ? { name } : {}),
    });
    const big = Array.from({ length: 8 }, (_, index) => row(index % 2 ? "assistant" : "user", "y".repeat(4_000)));
    expect(needsCompaction(big, 8_000)).toBe(true);
    const after = [...big, row("system", "summary", COMPACTION_NAME), row("user", "hi")];
    expect(sinceCompaction(after).rest).toHaveLength(1);
    expect(needsCompaction(after, 8_000)).toBe(false);
  });
});
