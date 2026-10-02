import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@botanical/core";
import { chatToJson, chatToMarkdown } from "./chat-export";

const chat = { id: "c1", title: "Plan", agentId: "a1", memberIds: [], createdAt: "t0", updatedAt: "t1" };
const messages: ChatMessage[] = [
  { id: "1", chatId: "c1", role: "system", name: "compaction", content: "Earlier: set up repo.", createdAt: "t1" },
  { id: "2", chatId: "c1", role: "user", content: "list files", createdAt: "t2" },
  {
    id: "3",
    chatId: "c1",
    role: "assistant",
    content: "",
    toolCalls: [{ id: "x", name: "file_list", arguments: { path: "." } }],
    createdAt: "t3",
  },
  { id: "4", chatId: "c1", role: "tool", toolCallId: "x", content: "a.txt ```", createdAt: "t4" },
];
const context = { chat, messages, agentNames: { a1: "Fern" }, exportedAt: "now" };

describe("chat export", () => {
  test("markdown has the title, compaction summary, tool call, and result", () => {
    const md = chatToMarkdown(context);
    expect(md).toContain("# Plan");
    expect(md).toContain("## Conversation compacted");
    expect(md).toContain("Earlier: set up repo.");
    expect(md).toContain("## You");
    expect(md).toContain("## Fern");
    expect(md).toContain("**Tool call: file_list**");
    expect(md).toContain('"path": "."');
    expect(md).toContain("````\na.txt ```\n````");
  });

  test("json keeps every message with its tool calls", () => {
    const json = JSON.parse(chatToJson(context));
    expect(json.format).toBe("botanical-chat");
    expect(json.messages).toHaveLength(4);
    expect(json.messages[0].compaction).toBe(true);
    expect(json.messages[2].toolCalls[0].name).toBe("file_list");
    expect(json.messages[2].author).toBe("Fern");
  });
});
