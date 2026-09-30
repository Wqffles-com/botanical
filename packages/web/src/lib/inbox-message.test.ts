import { describe, expect, test } from "bun:test";

import { conversationBetween, inboxPreview, isInboxMessage, parseInboxMessage, parseMention } from "./inbox-message";

const HEADER = "[Asynchronous messages from other agents — not the human user]";

describe("inbox messages", () => {
  test("splits a mention into its chat and text", () => {
    const content = [
      HEADER,
      "- from Ash (b846ce17-a8ad-4951-989b-b72e2a5d3f49) at 2026-09-29T07:36:45.178Z, id 43fa5420-0f27-4860-b775-a730943c6ae5:",
      'You were mentioned in the chat "hello boss" (chat e6b67464-dfcf-4159-a52a-80a238baad57). The user wrote:',
      "",
      "@Jan hi",
    ].join("\n");
    expect(parseInboxMessage({ role: "user", content })).toEqual([
      {
        id: "43fa5420-0f27-4860-b775-a730943c6ae5",
        fromName: "Ash",
        fromAgentId: "b846ce17-a8ad-4951-989b-b72e2a5d3f49",
        createdAt: "2026-09-29T07:36:45.178Z",
        body: 'You were mentioned in the chat "hello boss" (chat e6b67464-dfcf-4159-a52a-80a238baad57). The user wrote:\n\n@Jan hi',
        mention: { chatTitle: "hello boss", chatId: "e6b67464-dfcf-4159-a52a-80a238baad57", text: "@Jan hi" },
      },
    ]);
  });

  test("keeps several messages and multiline bodies apart", () => {
    const content = [
      HEADER,
      "- from Ash (Smith) (a1) at 2026-09-29T07:00:00.000Z, id m1:",
      "line one",
      "- not a header",
      "- from Bo (b2) at 2026-09-29T08:00:00.000Z, id m2:",
      "hi",
    ].join("\n");
    const entries = parseInboxMessage({ role: "user", content });
    expect(entries?.map((entry) => [entry.fromName, entry.body])).toEqual([
      ["Ash (Smith)", "line one\n- not a header"],
      ["Bo", "hi"],
    ]);
    expect(entries?.[0]?.mention).toBeUndefined();
  });

  test("ignores ordinary messages", () => {
    expect(isInboxMessage({ role: "user", content: "hello" })).toBe(false);
    expect(isInboxMessage({ role: "assistant", content: `${HEADER}\n- from A (a) at t, id m:\nx` })).toBe(false);
    expect(isInboxMessage({ role: "user", content: HEADER })).toBe(false);
  });

  test("keeps only mail between the two agents, oldest first, without duplicates", () => {
    const mail = (id: string, fromAgentId: string, toAgentId: string, createdAt: string) => ({ id, fromAgentId, toAgentId, createdAt });
    const listed = [
      mail("3", "b", "a", "2026-09-30T03:00:00Z"),
      mail("1", "a", "b", "2026-09-30T01:00:00Z"),
      mail("x", "c", "a", "2026-09-30T02:00:00Z"),
      mail("2", "b", "a", "2026-09-30T02:00:00Z"),
      mail("1", "a", "b", "2026-09-30T01:00:00Z"),
    ];
    expect(conversationBetween(listed, "a", "b").map((message) => message.id)).toEqual(["1", "2", "3"]);
  });

  test("previews a mention by what the user wrote, on one line", () => {
    const body = 'You were mentioned in the chat "hi" (chat c1). The user wrote:\n\n@Jan look\nhere';
    expect(parseMention(body)).toEqual({ chatTitle: "hi", chatId: "c1", text: "@Jan look\nhere" });
    expect(inboxPreview({ body, mention: parseMention(body)! })).toBe("@Jan look here");
    expect(inboxPreview({ body: "plain\n\nmail" })).toBe("plain mail");
  });
});
