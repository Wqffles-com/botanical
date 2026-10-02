import { describe, expect, test } from "bun:test";
import { agentToExport, parseAgentImport } from "./agent-export";
import { EMPTY_AGENT_DRAFT, type ProfileInfo } from "./agent-identity";

const profile = (id: string, model: string, available = true): ProfileInfo => ({
  id,
  name: model,
  provider: "anthropic",
  model,
  description: "",
  kind: "api",
  available,
  unavailableReason: null,
  cli: null,
  defaultModel: false,
});

describe("agent export", () => {
  test("round-trips by model name, not profile id", () => {
    const draft = { ...EMPTY_AGENT_DRAFT, name: "Fern", prompt: "Be kind.", tools: ["file_read", "gone"], defaultProfileId: "p1" };
    const file = JSON.stringify(agentToExport(draft, [profile("p1", "m1")]));
    expect(file).not.toContain("p1");
    const { draft: back, notes } = parseAgentImport(file, [profile("other", "m1")], ["file_read"]);
    expect(back).toMatchObject({ name: "Fern", prompt: "Be kind.", tools: ["file_read"], defaultProfileId: "other" });
    expect(notes[0]).toContain("gone");
  });

  test("notes a missing model and rejects other files", () => {
    const file = JSON.stringify(agentToExport({ ...EMPTY_AGENT_DRAFT, name: "A", prompt: "p", defaultProfileId: "p1" }, [profile("p1", "m1")]));
    expect(parseAgentImport(file, [], []).notes.join(" ")).toContain("m1");
    expect(() => parseAgentImport("{", [], [])).toThrow("valid JSON");
    expect(() => parseAgentImport('{"name":"x"}', [], [])).toThrow("not a Botanical agent");
  });
});
