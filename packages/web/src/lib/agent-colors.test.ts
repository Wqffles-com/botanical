import { describe, expect, test } from "bun:test";
import {
  AGENT_COLORS,
  AGENT_COLOR_TOKENS,
  DEFAULT_AGENT_COLOR,
  isAgentColor,
  resolveAgentColor,
} from "./agent-colors";

describe("agent colors", () => {
  test("covers the ten contract colors", () => {
    expect(AGENT_COLORS).toEqual([
      "red",
      "orange",
      "amber",
      "green",
      "teal",
      "cyan",
      "blue",
      "violet",
      "pink",
      "gray",
    ]);
    expect(DEFAULT_AGENT_COLOR).toBe("green");
    for (const color of AGENT_COLORS) {
      expect(AGENT_COLOR_TOKENS[color].fill).toMatch(/^#/);
    }
  });

  test("resolves unknown values to green", () => {
    expect(isAgentColor("green")).toBe(true);
    expect(isAgentColor("navy")).toBe(false);
    expect(resolveAgentColor("violet")).toBe("violet");
    expect(resolveAgentColor("navy")).toBe("green");
    expect(resolveAgentColor(undefined)).toBe("green");
  });
});
