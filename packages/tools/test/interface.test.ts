import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FILE_TOOL_NAMES,
  TOOL_INTERFACE_VERSION,
  createFileTools,
  createToolRegistry,
  resolveInsideWorkspace,
  canonicalizeWorkspaceRoot,
} from "../src/index.ts";

describe("tool interface", () => {
  test("exposes a stable definition shape and OpenAI function tools", async () => {
    expect(TOOL_INTERFACE_VERSION).toBe(1);
    const parent = await mkdtemp(path.join(tmpdir(), "botanical-iface-"));
    const root = path.join(parent, "ws");
    await mkdir(root);
    try {
      const tools = createFileTools({ workspaceRoot: root });
      expect(tools.map((tool) => tool.name)).toEqual([...FILE_TOOL_NAMES]);
      const registry = createToolRegistry(tools);
      expect(registry.get("file_read")?.risk).toBe("read");
      expect(registry.get("file_read")?.requiresApproval).toBe(false);
      expect(registry.get("file_write")?.risk).toBe("write");
      expect(registry.get("file_write")?.requiresApproval).toBe(true);
      expect(registry.get("file_list")?.requiresApproval).toBe(false);
      expect(registry.get("file_delete")?.risk).toBe("destructive");
      expect(registry.get("file_delete")?.requiresApproval).toBe(true);

      const openai = registry.toOpenAITools();
      expect(openai).toHaveLength(4);
      for (const tool of openai) {
        expect(tool.type).toBe("function");
        expect(tool.function.parameters.type).toBe("object");
        expect(tool.function.parameters.additionalProperties).toBe(false);
        expect(tool.function.name.length).toBeGreaterThan(0);
        expect(tool.function.description.length).toBeGreaterThan(0);
      }

      const unknown = await registry.execute("file_missing", {});
      expect(unknown.error?.code).toBe("unknown_tool");
      expect(() => createToolRegistry([...tools, ...tools])).toThrow(/duplicate tool/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("resolveInsideWorkspace rejects a lexical sibling of the root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "botanical-jail-"));
    const root = path.join(parent, "ws");
    const sibling = path.join(parent, "ws-evil");
    await mkdir(root);
    await mkdir(sibling);
    try {
      const canonical = await canonicalizeWorkspaceRoot(root);
      await expect(resolveInsideWorkspace(canonical, path.join(sibling, "x"))).rejects.toMatchObject({
        code: "path_escape",
      });
      await expect(resolveInsideWorkspace(canonical, "../ws-evil/x")).rejects.toMatchObject({
        code: "path_escape",
      });
      const dot = await resolveInsideWorkspace(canonical, ".");
      expect(dot.absolute).toBe(canonical);
      expect(dot.relative).toBe(".");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
