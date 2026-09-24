import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "../registry.ts";
import { ToolError, ToolErrorCode } from "../errors.ts";
import type { ToolDefinition } from "../types.ts";
import { asBoolean, asString } from "../validate.ts";
import { assertInsideWorkspace, isInsideWorkspace, resolveInsideWorkspace } from "../path-jail.ts";
import { openWorkspace, type ResolvedFileLimits } from "./config.ts";

export interface FileDeleteData {
  path: string;
  files: number;
  directories: number;
  symlinks: number;
}

const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["path", "confirm"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description: "File, symlink, or directory inside the workspace. The workspace root itself is refused.",
    },
    confirm: {
      type: "boolean",
      description: "Must be true. Any other value refuses the delete.",
    },
    recursive: {
      type: "boolean",
      default: false,
      description: "Required to delete a non-empty directory. Symlinks are never followed.",
    },
  },
} as const;

interface PlannedNode {
  absolute: string;
  kind: "file" | "directory" | "symlink" | "other";
}

export function createFileDeleteTool(config: ResolvedFileLimits): ToolDefinition<FileDeleteData> {
  return defineTool({
    name: "file_delete",
    description:
      "Delete a file, symlink, or directory inside the workspace. confirm must be true. Refuses the workspace root. A non-empty directory requires recursive: true. Symlinks are removed without deleting their targets. The tree is counted first and left untouched when it exceeds the entry cap. Requires approval.",
    parameters,
    risk: "destructive",
    requiresApproval: true,
    async run(params, ctx) {
      const userPath = asString(params, "path");
      const confirm = params.confirm;
      if (confirm !== true) {
        throw new ToolError(
          ToolErrorCode.confirmationRequired,
          "refusing to delete without confirm: true",
        );
      }
      const recursive = asBoolean(params, "recursive", false);
      const root = await openWorkspace(config, ctx);
      const resolved = await resolveInsideWorkspace(root, userPath, { noFollowFinal: true });
      if (resolved.absolute === root || resolved.relative === ".") {
        throw new ToolError(
          ToolErrorCode.workspaceRootProtected,
          "refusing to delete the workspace root",
        );
      }

      const planned: PlannedNode[] = [];
      await planRemoval(root, resolved.absolute, recursive, config.maxDeleteEntries, planned);

      const counts = { files: 0, directories: 0, symlinks: 0 };
      for (let index = planned.length - 1; index >= 0; index--) {
        const node = planned[index];
        if (!node) continue;
        assertInsideWorkspace(root, node.absolute);
        if (node.absolute === root) {
          throw new ToolError(
            ToolErrorCode.workspaceRootProtected,
            "refusing to delete the workspace root",
          );
        }
        try {
          if (node.kind === "directory") await rmdir(node.absolute);
          else await unlink(node.absolute);
        } catch {
          throw new ToolError(ToolErrorCode.ioError, "failed to delete path");
        }
        if (node.kind === "directory") counts.directories += 1;
        else if (node.kind === "symlink") counts.symlinks += 1;
        else counts.files += 1;
      }

      const data: FileDeleteData = { path: resolved.relative, ...counts };
      return {
        ok: true,
        content: `deleted ${data.path} (files=${data.files}, directories=${data.directories}, symlinks=${data.symlinks})`,
        data,
      };
    },
  });
}

async function planRemoval(
  root: string,
  absolute: string,
  recursive: boolean,
  maxEntries: number,
  planned: PlannedNode[],
): Promise<void> {
  if (planned.length >= maxEntries) {
    throw new ToolError(
      ToolErrorCode.tooManyEntries,
      `refusing to delete more than ${maxEntries} entries`,
    );
  }
  if (absolute === root || !isInsideWorkspace(root, absolute)) {
    throw new ToolError(ToolErrorCode.workspaceRootProtected, "refusing to delete the workspace root");
  }

  let listed;
  try {
    listed = await lstat(absolute);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (code === "ENOENT") throw new ToolError(ToolErrorCode.notFound, "path not found");
    throw new ToolError(ToolErrorCode.ioError, "failed to stat path");
  }

  if (listed.isSymbolicLink()) {
    planned.push({ absolute, kind: "symlink" });
    return;
  }
  if (listed.isDirectory()) {
    let names: string[];
    try {
      names = await readdir(absolute);
    } catch {
      throw new ToolError(ToolErrorCode.ioError, "failed to list directory");
    }
    if (names.length > 0 && !recursive) {
      throw new ToolError(
        ToolErrorCode.notEmpty,
        "directory is not empty; set recursive: true to delete it",
      );
    }
    planned.push({ absolute, kind: "directory" });
    if (recursive) {
      for (const name of names.sort()) {
        const child = path.join(absolute, name);
        assertInsideWorkspace(root, child);
        await planRemoval(root, child, true, maxEntries, planned);
      }
    }
    return;
  }
  planned.push({ absolute, kind: listed.isFile() ? "file" : "other" });
}
