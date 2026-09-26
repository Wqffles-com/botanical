import { describe, expect, test } from "bun:test";
import { AgentRequiredError, ProfileRequiredError, requireAgentId, requireProfileId } from "./errors";

describe("profile and agent gates", () => {
  test("requires an explicit profile id", () => {
    expect(requireProfileId(" grok ")).toBe("grok");
    expect(() => requireProfileId("")).toThrow(ProfileRequiredError);
    expect(() => requireProfileId(null)).toThrow(ProfileRequiredError);
    expect(() => requireProfileId("   ")).toThrow(ProfileRequiredError);
  });

  test("requires exactly one agent id", () => {
    expect(requireAgentId("agent-1")).toBe("agent-1");
    expect(() => requireAgentId(undefined)).toThrow(AgentRequiredError);
    expect(() => requireAgentId("")).toThrow(AgentRequiredError);
  });
});
