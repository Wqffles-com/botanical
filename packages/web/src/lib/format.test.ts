import { describe, expect, test } from "bun:test";
import { unavailableProfileHint } from "./format";

describe("unavailableProfileHint", () => {
  test("names the profile and the reason, and stays quiet when the profile can run", () => {
    expect(
      unavailableProfileHint({
        name: "Claude Code",
        available: false,
        unavailableReason: "claude is not on PATH",
      }),
    ).toBe("Claude Code is unavailable: claude is not on PATH. Pick another profile.");
    expect(unavailableProfileHint({ name: "Mock", available: true })).toBeNull();
    expect(unavailableProfileHint({ name: "Mock" })).toBeNull();
    expect(unavailableProfileHint(null)).toBeNull();
    expect(unavailableProfileHint({ name: "Codex", available: false, unavailableReason: "  " })).toBe(
      "Codex is unavailable: it cannot be used right now. Pick another profile.",
    );
  });
});
