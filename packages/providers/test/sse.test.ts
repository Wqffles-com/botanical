import { describe, expect, test } from "bun:test";
import { readSse } from "../src/sse.ts";
import { sseBody } from "./helpers.ts";

describe("readSse", () => {
  test("parses events split across chunks and crlf", async () => {
    const chunks = ["data: hel", "lo\r\n", "\r\ndata: wor", "ld\n\n"];
    const messages = [];
    for await (const message of readSse(sseBody(chunks))) messages.push(message);
    expect(messages).toEqual([
      { event: null, data: "hello" },
      { event: null, data: "world" },
    ]);
  });

  test("keeps anthropic event names and ignores comments", async () => {
    const raw = ": ping\n\nevent: content_block_delta\ndata: {\"text\":\"Hi\"}\n\n";
    const messages = [];
    for await (const message of readSse(sseBody([raw]))) messages.push(message);
    expect(messages).toEqual([{ event: "content_block_delta", data: "{\"text\":\"Hi\"}" }]);
  });
});
