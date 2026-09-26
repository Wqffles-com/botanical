import { describe, expect, test } from "bun:test";

import { executeWithLimits, truncateContent } from "../src/limits.ts";

describe("tool output limits", () => {
  test("truncates long text and keeps the notice inside the cap", () => {
    const next = truncateContent("x".repeat(200), 80);
    expect(next.truncated).toBe(true);
    expect(next.content.length).toBeLessThanOrEqual(80);
    expect(next.content).toContain("[output truncated to 80 characters]");
  });

  test("aborts a hung call at the timeout", async () => {
    const started = Date.now();
    const result = await executeWithLimits(() => new Promise(() => {}), {
      timeoutMs: 40,
      maxOutputChars: 200,
      toolName: "hang",
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("returns aborted when the caller signal fires", async () => {
    const controller = new AbortController();
    const pending = executeWithLimits(() => new Promise(() => {}), {
      timeoutMs: 5_000,
      maxOutputChars: 200,
      toolName: "hang",
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.content).toContain("aborted");
  });
});
