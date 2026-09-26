import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ToolInputError } from "../src/errors.ts";
import { resolveWorkspaceCwd } from "../src/sandbox/paths.ts";

function makeTree(): { root: string; outside: string } {
  const root = mkdtempSync(path.join(tmpdir(), "botanical-paths-"));
  const outside = mkdtempSync(path.join(tmpdir(), "botanical-outside-"));
  mkdirSync(path.join(root, "sub"));
  writeFileSync(path.join(outside, "secret.txt"), "nope");
  symlinkSync(outside, path.join(root, "escape"));
  return { root, outside };
}

describe("workspace cwd jail", () => {
  test("resolves the workspace and a subdirectory to jail paths", () => {
    const { root, outside } = makeTree();
    try {
      expect(resolveWorkspaceCwd(root, undefined)).toEqual({
        workspaceReal: realpathSync(root),
        jailCwd: "/workspace",
      });
      expect(resolveWorkspaceCwd(root, "sub").jailCwd).toBe("/workspace/sub");
      expect(resolveWorkspaceCwd(root, "sub/../sub").jailCwd).toBe("/workspace/sub");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects paths that leave the workspace, including symlinks", () => {
    const { root, outside } = makeTree();
    try {
      expect(() => resolveWorkspaceCwd(root, "..")).toThrow(ToolInputError);
      expect(() => resolveWorkspaceCwd(root, "escape")).toThrow(ToolInputError);
      expect(() => resolveWorkspaceCwd(root, path.join(outside))).toThrow(ToolInputError);
      expect(() => resolveWorkspaceCwd("/", undefined)).toThrow(/filesystem root/);
      expect(() => resolveWorkspaceCwd(path.join(root, "missing-dir"), undefined)).toThrow(ToolInputError);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
