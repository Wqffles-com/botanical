import { describe, expect, test } from "bun:test";

import { activeMentionQuery, findMentions, mentionedAgents } from "./mentions";

const agents = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Ada Lovelace" },
  { id: "c", name: "Research" },
];

describe("findMentions", () => {
  test("matches names case-insensitively, longest first", () => {
    const found = findMentions("hey @ada lovelace and @RESEARCH, thoughts?", agents);
    expect(found.map((m) => m.agent.id)).toEqual(["b", "c"]);
    expect(found[0]).toMatchObject({ start: 4, end: 17 });
  });

  test("ignores emails and partial words", () => {
    expect(findMentions("mail x@ada.com or @Adam", agents)).toEqual([]);
  });

  test("matches at the start and in brackets", () => {
    expect(findMentions("@Ada (@Research)", agents).map((m) => m.agent.id)).toEqual(["a", "c"]);
  });
});

test("mentionedAgents dedupes", () => {
  expect(mentionedAgents("@Ada @ada @Research", agents).map((a) => a.id)).toEqual(["a", "c"]);
});

describe("activeMentionQuery", () => {
  test("returns the query being typed", () => {
    expect(activeMentionQuery("ask @Ada Lo", 11)).toEqual({ start: 4, query: "Ada Lo" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  test("null outside a mention", () => {
    expect(activeMentionQuery("a@b", 3)).toBeNull();
    expect(activeMentionQuery("no mention", 5)).toBeNull();
    expect(activeMentionQuery("@Ada\nhi", 7)).toBeNull();
  });
});
