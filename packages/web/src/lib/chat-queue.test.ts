import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "@botanical/core";
import { applyQueueStatus, markAccepted, mergeMessage, settlePending, type PendingMessage } from "./chat-queue";

const at = "2026-09-28T00:00:00.000Z";

function row(id: string, posting = false): PendingMessage {
  return { id, content: id, createdAt: at, posting };
}

describe("chat queue state", () => {
  test("mergeMessage adds a stored message once", () => {
    const message: ChatMessage = { id: "m1", chatId: "c", role: "assistant", content: "hi", createdAt: at };
    const once = mergeMessage([], message);
    expect(once).toHaveLength(1);
    expect(mergeMessage(once, message)).toBe(once);
  });

  test("settlePending drops the bubble a stored message came from", () => {
    const pending = [row("a"), row("b")];
    expect(settlePending(pending, "a").map((item) => item.id)).toEqual(["b"]);
    expect(settlePending(pending, undefined)).toBe(pending);
    expect(settlePending(pending, "zzz")).toBe(pending);
  });

  test("markAccepted clears posting", () => {
    expect(markAccepted([row("a", true)], "a")).toEqual([row("a", false)]);
  });

  test("applyQueueStatus adds unseen server entries", () => {
    const next = applyQueueStatus([row("a")], {
      running: true,
      queued: [{ id: "a", content: "a", profileId: "p", createdAt: at }, { id: "b", content: "b", profileId: "p", createdAt: at }],
    });
    expect(next.map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("applyQueueStatus keeps only in-flight posts once the server is idle", () => {
    const next = applyQueueStatus([row("done"), row("sending", true)], { running: false, queued: [] });
    expect(next.map((item) => item.id)).toEqual(["sending"]);
    const busy = [row("a")];
    expect(applyQueueStatus(busy, { running: true, queued: [] })).toBe(busy);
  });
});
