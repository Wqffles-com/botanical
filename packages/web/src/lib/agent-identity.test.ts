import { describe, expect, test } from "bun:test";
import {
  agentWritePayload,
  filterAgents,
  identitiesFromUnknown,
  identityFromUnknown,
  profilesFromUnknown,
  toolsFromUnknown,
  validateAgentDraft,
} from "./agent-identity";

describe("agent identity mapping", () => {
  test("reads both contract and v0 field names", () => {
    const agent = identityFromUnknown({
      id: "ag_1",
      name: "Gardener",
      description: "Tends the beds",
      systemPrompt: "You garden.",
      toolIds: ["web_search", { id: "files" }],
      icon: "Sprout",
      color: "green",
      default_profile_id: "mock",
    });
    expect(agent.prompt).toBe("You garden.");
    expect(agent.tools).toEqual(["web_search", "files"]);
    expect(agent.icon).toBe("Sprout");
    expect(agent.color).toBe("green");
    expect(agent.defaultProfileId).toBe("mock");
  });

  test("unwraps list envelopes", () => {
    const agents = identitiesFromUnknown({
      agents: [
        { id: "a", name: "Scout", icon: "Search", color: "amber" },
        { id: "b", name: "Builder", icon: "Code", color: "blue" },
      ],
    });
    expect(agents.map((agent) => agent.name)).toEqual(["Scout", "Builder"]);
  });

  test("write payload includes prompt and systemPrompt aliases", () => {
    const payload = agentWritePayload({
      name: "  Scout  ",
      description: "Looks around",
      prompt: "Search first.",
      icon: "Search",
      color: "amber",
      tools: ["web_search", "web_search", ""],
      defaultProfileId: "",
    });
    expect(payload.name).toBe("Scout");
    expect(payload.prompt).toBe("Search first.");
    expect(payload.systemPrompt).toBe("Search first.");
    expect(payload.tools).toEqual(["web_search"]);
    expect(payload.toolIds).toEqual(["web_search"]);
    expect(payload.defaultProfileId).toBeNull();
    expect(payload.icon).toBe("Search");
    expect(payload.color).toBe("amber");
  });

  test("validates name and prompt", () => {
    expect(
      validateAgentDraft({
        name: "",
        description: "",
        prompt: "",
        icon: "Bot",
        color: "green",
        tools: [],
        defaultProfileId: null,
      }),
    ).toMatch(/name/i);
    expect(
      validateAgentDraft({
        name: "x".repeat(41),
        description: "",
        prompt: "You are helpful.",
        icon: "Bot",
        color: "green",
        tools: [],
        defaultProfileId: null,
      }),
    ).toMatch(/40/);
    expect(
      validateAgentDraft({
        name: "Scout",
        description: "",
        prompt: "   ",
        icon: "Search",
        color: "amber",
        tools: [],
        defaultProfileId: null,
      }),
    ).toMatch(/prompt/i);
  });

  test("parses tools and profiles from API envelopes", () => {
    const tools = toolsFromUnknown({
      tools: [
        { id: "web_search", name: "Web search", source: "builtin" },
        "shell",
      ],
    });
    expect(tools[0]?.id).toBe("web_search");
    expect(tools[1]?.id).toBe("shell");
    const profiles = profilesFromUnknown({
      profiles: [{ id: "mock", name: "Mock", provider: "mock", model: "mock" }],
    });
    expect(profiles[0]?.id).toBe("mock");
  });

  test("filters agents by name and description", () => {
    const agents = identitiesFromUnknown([
      { id: "1", name: "Gardener", description: "plants", icon: "Sprout", color: "green" },
      { id: "2", name: "Builder", description: "code", icon: "Code", color: "blue" },
    ]);
    expect(filterAgents(agents, "plant").map((agent) => agent.id)).toEqual(["1"]);
    expect(filterAgents(agents, "BLUE").map((agent) => agent.id)).toEqual(["2"]);
  });
});
