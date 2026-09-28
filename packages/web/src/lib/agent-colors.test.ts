import { readFileSync } from "node:fs";
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
      expect(AGENT_COLOR_TOKENS[color]).toEqual({
        fill: `var(--agent-${color})`,
        ink: `var(--agent-${color}-ink)`,
      });
    }
  });

  test("every slot has a fill and ink token in light and dark", () => {
    const css = readFileSync(new URL("../../../ui/src/styles.css", import.meta.url), "utf8");
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return css.slice(start, css.indexOf("\n}", start));
    };
    const light = block(":root");
    const dark = block(".dark");
    for (const color of AGENT_COLORS) {
      expect(light).toContain(`--agent-${color}:`);
      expect(light).toContain(`--agent-${color}-ink:`);
      expect(dark).toContain(`--agent-${color}:`);
    }
    // Gray stays neutral: zero chroma in both themes.
    expect(light).toMatch(/--agent-gray: oklch\([\d.]+ 0 0\)/);
    expect(dark).toMatch(/--agent-gray: oklch\([\d.]+ 0 0\)/);
  });

  test("resolves unknown values to green", () => {
    expect(isAgentColor("green")).toBe(true);
    expect(isAgentColor("navy")).toBe(false);
    expect(resolveAgentColor("violet")).toBe("violet");
    expect(resolveAgentColor("navy")).toBe("green");
    expect(resolveAgentColor(undefined)).toBe("green");
  });
});
