import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "@botanical/agent-runtime";
import { adaptTool } from "../src/adapt";
import { loadAgentConfigFile } from "../src/load-agents";

describe("agent config file", () => {
  test("upserts by id and adapts a raw built-in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "botanical-agents-"));
    const path = join(dir, "agents.json");
    await writeFile(
      path,
      JSON.stringify([
        { id: "ada", name: "Ada", prompt: "First", toolAllowlist: ["web_search"] },
      ]),
    );
    const store = createMemoryStore();
    const created = await loadAgentConfigFile(path, store.agents);
    expect(created[0]?.prompt).toBe("First");
    expect(created[0]?.a2aEnabled).toBe(true);

    await writeFile(
      path,
      JSON.stringify([
        { id: "ada", name: "Ada", prompt: "Second", toolAllowlist: ["web_search", "shell"] },
      ]),
    );
    const updated = await loadAgentConfigFile(path, store.agents);
    expect(await store.agents.list()).toHaveLength(1);
    expect(updated[0]?.prompt).toBe("Second");
    expect(updated[0]?.toolAllowlist).toEqual(["web_search", "shell"]);

    const tool = adaptTool({
      name: "web_search",
      description: "Search",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      async execute(args) {
        return `hit:${JSON.stringify(args)}`;
      },
    });
    expect(tool.parameters).toMatchObject({ type: "object" });
    const result = await tool.execute({ q: "fern" }, { agentId: "ada", chatId: "c" });
    expect(result.output).toBe('hit:{"q":"fern"}');
    const wrapped = adaptTool({
      name: "web_fetch",
      description: "Fetch",
      execute() {
        return { output: "page", isError: false };
      },
    });
    expect(await wrapped.execute({}, { agentId: "ada", chatId: "c" })).toEqual({ output: "page", isError: false });
  });
});
