import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/provider";
import { withImages } from "../src/loop";

const png = { mimeType: "image/png", data: "AAAA" };

describe("withImages", () => {
  test("adds image parts to user messages the loader finds images for", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "see [pic]" },
      { role: "assistant", content: "ok" },
    ];
    const next = await withImages({ loadImages: async (_agent, content) => (content.includes("[pic]") ? [png] : []) }, "a1", messages);
    expect(next[1]?.content).toEqual([
      { type: "text", text: "see [pic]" },
      { type: "image", url: "data:image/png;base64,AAAA", mimeType: "image/png", data: "AAAA" },
    ]);
    expect(next[2]).toBe(messages[2]);
    expect(messages[1]?.content).toBe("see [pic]");
  });

  test("keeps only the most recent images", async () => {
    const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    const next = await withImages({ loadImages: async () => [png] }, "a1", messages);
    expect(next.filter((m) => Array.isArray(m.content))).toHaveLength(4);
    expect(Array.isArray(next[5]?.content)).toBe(true);
    expect(Array.isArray(next[0]?.content)).toBe(false);
  });

  test("does nothing without a loader", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "x" }];
    expect(await withImages({}, "a1", messages)).toBe(messages);
  });
});
