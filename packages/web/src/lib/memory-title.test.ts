import { describe, expect, test } from "bun:test";
import { memoryTitle } from "./memory-title";

describe("memoryTitle", () => {
  test("uses the first non-empty line", () => {
    expect(memoryTitle("\n\n  Deploys go out on Fridays\nMore detail here")).toBe("Deploys go out on Fridays");
  });

  test("drops heading, list and quote markers", () => {
    expect(memoryTitle("## Release checklist\n- one")).toBe("Release checklist");
    expect(memoryTitle("- Prefers tabs")).toBe("Prefers tabs");
    expect(memoryTitle("> quoted note")).toBe("quoted note");
  });

  test("cuts long lines with an ellipsis", () => {
    const title = memoryTitle("x".repeat(200));
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });

  test("falls back when content is blank", () => {
    expect(memoryTitle("   \n ")).toBe("Untitled memory");
  });
});
