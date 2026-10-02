import { describe, expect, test } from "bun:test";

import { draftsFromOverrides, formatTokens, formatUsd, overridesFromDrafts } from "./usage-format";

describe("usage formatting", () => {
  test("compacts tokens and formats dollars", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1250)).toBe("1.3K");
    expect(formatTokens(3_400_000)).toBe("3.4M");
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(12.5)).toBe("$12.50");
  });

  test("price drafts round trip and reject bad rows", () => {
    const drafts = draftsFromOverrides({ "claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15 } });
    expect(overridesFromDrafts(drafts)).toEqual({
      overrides: { "claude-sonnet": { inputPerMTok: 3, outputPerMTok: 15 } },
    });
    expect(overridesFromDrafts([{ prefix: "", input: "", output: "" }])).toEqual({ overrides: {} });
    expect(overridesFromDrafts([{ prefix: "x", input: "1", output: "" }])).toHaveProperty("error");
    expect(overridesFromDrafts([{ prefix: "", input: "1", output: "2" }])).toHaveProperty("error");
    expect(overridesFromDrafts([{ prefix: "x", input: "-1", output: "2" }])).toHaveProperty("error");
  });
});
