import { describe, expect, test } from "bun:test";
import {
  AGENT_ICON_NAMES,
  DEFAULT_AGENT_ICON,
  getAgentIcon,
  isAgentIconName,
  resolveAgentIconName,
} from "./agent-icons";

describe("agent icons", () => {
  test("includes the contract defaults", () => {
    for (const name of ["Sprout", "Bot", "Brain", "Code", "Search", "Leaf", "Rocket", "Sparkles"]) {
      expect(isAgentIconName(name)).toBe(true);
    }
    expect(DEFAULT_AGENT_ICON).toBe("Bot");
    expect(AGENT_ICON_NAMES.length).toBeGreaterThan(20);
  });

  test("falls back to Bot", () => {
    expect(resolveAgentIconName("NotARealIcon")).toBe("Bot");
    expect(getAgentIcon("Sprout")).toBeDefined();
    expect(getAgentIcon(null)).toBe(getAgentIcon("Bot"));
  });
});
