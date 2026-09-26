import { describe, expect, test } from "bun:test";
import { parseNdjsonLine, parseSseFrame, readChatStream } from "./sse";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[], contentType = ""): Promise<unknown[]> {
  const events = [];
  for await (const event of readChatStream(streamFrom(chunks), contentType)) events.push(event);
  return events;
}

describe("parseSseFrame", () => {
  test("reads named events and json data", () => {
    expect(parseSseFrame('event: text-delta\ndata: {"text":"Hi"}')).toEqual({
      type: "text-delta",
      text: "Hi",
    });
  });

  test("accepts delta, tool_call, and tool_result aliases", () => {
    expect(parseSseFrame('event: delta\ndata: {"text":"Hi"}')).toEqual({ type: "text-delta", text: "Hi" });
    expect(parseSseFrame('event: tool_call\ndata: {"id":"c1","name":"file_list","arguments":{"path":"."}}')).toEqual({
      type: "tool-call",
      id: "c1",
      name: "file_list",
      arguments: { path: "." },
    });
    expect(parseSseFrame('event: tool_result\ndata: {"id":"c1","content":"notes.txt"}')).toEqual({
      type: "tool-result",
      id: "c1",
      content: "notes.txt",
    });
  });

  test("joins a JSON payload split across data lines and ignores comments", () => {
    expect(parseSseFrame(': keep-alive\ndata: {"text":\ndata: "Hello"}')).toEqual({
      type: "text-delta",
      text: "Hello",
    });
  });

  test("treats [DONE] as done", () => {
    expect(parseSseFrame("data: [DONE]")).toEqual({ type: "done" });
  });

  test("accepts a type field when the event name is omitted", () => {
    expect(parseSseFrame('data: {"type":"usage","inputTokens":2,"outputTokens":1}')).toEqual({
      type: "usage",
      inputTokens: 2,
      outputTokens: 1,
    });
  });
});

describe("readChatStream", () => {
  test("reassembles SSE frames split across chunks", async () => {
    const events = await collect(
      ['event: text-delta\ndata: {"te', 'xt":"Hello"}\n\n', "event: done\ndata: {}\n\n"],
      "text/event-stream",
    );
    expect(events).toEqual([
      { type: "text-delta", text: "Hello" },
      { type: "done" },
    ]);
  });

  test("parses NDJSON when the content type says so", async () => {
    const events = await collect(
      ['{"type":"text-delta","text":"A"}\n{"type":"tool-call","id":"t1","name":"web_search","arguments":"{\\"q\\":\\"soil\\"}"}\n'],
      "application/x-ndjson",
    );
    expect(events).toEqual([
      { type: "text-delta", text: "A" },
      { type: "tool-call", id: "t1", name: "web_search", arguments: { q: "soil" } },
    ]);
  });

  test("sniffs a JSON line stream when the content type is missing", async () => {
    const events = await collect(['{"type":"error","error":"nope"}\n']);
    expect(events).toEqual([{ type: "error", error: "nope" }]);
  });

  test("parses a single NDJSON line with no trailing newline", async () => {
    expect(parseNdjsonLine('{"type":"done"}')).toEqual({ type: "done" });
    const events = await collect(['{"type":"text-delta","text":"Z"}'], "application/x-ndjson");
    expect(events).toEqual([{ type: "text-delta", text: "Z" }]);
  });
});
