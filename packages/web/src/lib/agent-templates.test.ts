import { describe, expect, test } from "bun:test";
import { AGENT_TEMPLATES } from "./agent-templates";
import { parseAgentImport } from "./agent-export";
import { resolveAgentIconName } from "./agent-icons";

describe("agent templates", () => {
  test("every template parses as an agent import with nothing dropped", () => {
    for (const { id, file } of AGENT_TEMPLATES) {
      const { draft, notes } = parseAgentImport(JSON.stringify(file), [], []);
      expect(notes, id).toEqual([]);
      expect(draft.name, id).toBe(file.name);
      expect(draft.tools.length, id).toBeGreaterThan(0);
      expect(draft.color, id).toBe(file.color);
      expect(resolveAgentIconName(file.icon), id).toBe(file.icon);
    }
  });
});
