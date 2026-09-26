import { describe, expect, test } from "bun:test";
import {
  AGENT_ICON_NAMES,
  DEFAULT_AGENT_ICON,
  getAgentIcon,
  isAgentIconName,
  resolveAgentIconName,
  searchAgentIcons,
} from "./agent-icons";

describe("agent icons", () => {
  test("curates about sixty lucide names including the contract defaults", () => {
    for (const name of ["Sprout", "Bot", "Brain", "Code", "Search", "Leaf", "Rocket", "Sparkles"]) {
      expect(isAgentIconName(name)).toBe(true);
    }
    expect(DEFAULT_AGENT_ICON).toBe("Bot");
    expect(AGENT_ICON_NAMES.length).toBeGreaterThanOrEqual(60);
  });

  test("falls back to Bot", () => {
    expect(resolveAgentIconName("NotARealIcon")).toBe("Bot");
    expect(resolveAgentIconName("")).toBe("Bot");
    expect(getAgentIcon("Sprout")).toBeDefined();
    expect(getAgentIcon(null)).toBe(getAgentIcon("Bot"));
  });

  test("searches by name and keyword", () => {
    expect(searchAgentIcons("garden")).toContain("Sprout");
    expect(searchAgentIcons("cli")).toContain("Terminal");
    expect(searchAgentIcons("zzzz-missing")).toEqual([]);
    expect(searchAgentIcons("").length).toBe(AGENT_ICON_NAMES.length);
  });
});
