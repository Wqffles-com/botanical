import { describe, expect, test } from "bun:test";

import { formatToolResult, parseToolArguments } from "../src/format.js";

describe("formatToolResult", () => {
  test("joins text and keeps structured content", () => {
    const result = formatToolResult({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { ok: true },
    });
    expect(result).toEqual({ ok: true, isError: false, content: "hello", structured: { ok: true } });
  });

  test("does not inline image bytes", () => {
    const result = formatToolResult({
      content: [{ type: "image", data: "aaaa", mimeType: "image/png" }],
      isError: true,
    });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("[image image/png]");
    expect(result.content).not.toContain("aaaa");
  });

  test("falls back to structured JSON when there is no text", () => {
    const result = formatToolResult({ structuredContent: { n: 1 }, content: [] });
    expect(result.content).toBe('{"n":1}');
  });
});

describe("parseToolArguments", () => {
  test("accepts objects and JSON strings", () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ ok: true, value: { a: 1 } });
    expect(parseToolArguments('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseToolArguments(undefined)).toEqual({ ok: true, value: {} });
  });

  test("rejects arrays and invalid JSON", () => {
    expect(parseToolArguments([1]).ok).toBe(false);
    expect(parseToolArguments("{").ok).toBe(false);
  });
});
