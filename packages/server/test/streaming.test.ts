import { describe, expect, test } from "bun:test";

import { sseStream } from "../src/streaming.ts";

describe("sseStream heartbeat", () => {
  test("sends SSE comments while the event source is silent", async () => {
    async function* slow() {
      await new Promise((resolve) => setTimeout(resolve, 120));
      yield { event: "done", data: { type: "done" } };
    }
    const text = await sseStream(slow(), { heartbeatMs: 30 }).text();
    expect(text).toContain(": ping\n\n");
    expect(text.trimEnd().endsWith('data: {"type":"done"}')).toBe(true);
  });

  test("no heartbeat when events keep flowing or it is disabled", async () => {
    async function* quick() {
      yield { event: "text-delta", data: { text: "a" } };
      yield { event: "done", data: { type: "done" } };
    }
    expect(await sseStream(quick(), { heartbeatMs: 1_000 }).text()).not.toContain(": ping");
    async function* slow() {
      await new Promise((resolve) => setTimeout(resolve, 60));
      yield { event: "done", data: { type: "done" } };
    }
    expect(await sseStream(slow(), { heartbeatMs: 0 }).text()).not.toContain(": ping");
  });
});
