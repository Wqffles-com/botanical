import { describe, expect, test } from "bun:test";
import { groupProfilesByProvider, modelLabel, profileForProvider, type PickableProfile } from "./profile-groups";

const profiles: PickableProfile[] = [
  { id: "mock", name: "Mock", provider: "mock", model: "echo", kind: "api" },
  { id: "deepseek", name: "DeepSeek", provider: "deepseek", model: "deepseek-chat", kind: "api" },
  { id: "deepseek-r1", name: "DeepSeek R1", provider: "deepseek", model: "deepseek-reasoner", kind: "api" },
  { id: "claude-code", name: "Claude Code", provider: "cli", model: "claude", kind: "cli", cli: "claude", defaultModel: true },
  { id: "claude-opus", name: "Claude Code Opus", provider: "cli", model: "opus", kind: "cli", cli: "claude" },
  {
    id: "grok-build",
    name: "Grok Build",
    provider: "cli",
    model: "grok",
    kind: "cli",
    cli: "grok",
    defaultModel: true,
    available: false,
    unavailableReason: "grok is not installed",
  },
];

describe("groupProfilesByProvider", () => {
  test("lists vendors and harnesses as providers, with their profiles as models", () => {
    const groups = groupProfilesByProvider(profiles);
    expect(groups.map((group) => [group.label, group.kind, group.profiles.map((profile) => profile.id)])).toEqual([
      ["Mock", "api", ["mock"]],
      ["DeepSeek", "api", ["deepseek", "deepseek-r1"]],
      ["Claude Code", "cli", ["claude-code", "claude-opus"]],
      ["Grok Build", "cli", ["grok-build"]],
    ]);
  });

  test("a provider is unavailable only when none of its models can run", () => {
    const groups = groupProfilesByProvider(profiles);
    const grok = groups.find((group) => group.label === "Grok Build")!;
    expect(grok.available).toBe(false);
    expect(grok.unavailableReason).toBe("grok is not installed");
    expect(groups.find((group) => group.label === "Claude Code")!.available).toBe(true);
  });
});

describe("modelLabel", () => {
  test("shows the model, and Default model when a CLI picks its own", () => {
    expect(modelLabel(profiles[1]!)).toBe("deepseek-chat");
    expect(modelLabel(profiles[3]!)).toBe("Default model");
    expect(modelLabel(profiles[4]!)).toBe("opus");
  });

  test("adds the profile name when two profiles share a model", () => {
    const twin = { ...profiles[1]!, id: "deepseek-cold", name: "DeepSeek cold" };
    expect(modelLabel(twin, [profiles[1]!, twin])).toBe("deepseek-chat (DeepSeek cold)");
  });
});

describe("profileForProvider", () => {
  test("keeps the current profile inside the provider, else takes the first that can run", () => {
    const [, deepseek, claude, grok] = groupProfilesByProvider(profiles);
    expect(profileForProvider(deepseek!, "deepseek-r1")?.id).toBe("deepseek-r1");
    expect(profileForProvider(deepseek!, "mock")?.id).toBe("deepseek");
    expect(profileForProvider(claude!, null)?.id).toBe("claude-code");
    expect(profileForProvider(grok!, null)).toBeNull();
  });
});
