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

  test("named colors are distinct hues and gray stays neutral", () => {
    const fills = new Set(AGENT_COLORS.map((color) => AGENT_COLOR_TOKENS[color].fill));
    expect(fills.size).toBe(AGENT_COLORS.length);
    expect(AGENT_COLOR_TOKENS.gray.fill).toMatch(/^#([0-9a-f]{2})\1\1$/i);
    expect(AGENT_COLOR_TOKENS.blue.fill).not.toBe(AGENT_COLOR_TOKENS.red.fill);
    expect(AGENT_COLOR_TOKENS.green.fill).not.toMatch(/^#([0-9a-f]{2})\1\1$/i);
  });

  test("resolves unknown values to green", () => {
    expect(isAgentColor("green")).toBe(true);
    expect(isAgentColor("navy")).toBe(false);
    expect(resolveAgentColor("violet")).toBe("violet");
    expect(resolveAgentColor("navy")).toBe("green");
    expect(resolveAgentColor(undefined)).toBe("green");
  });
});
