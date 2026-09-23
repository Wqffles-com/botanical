import { lstat, readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "../registry.ts";
import { ToolError, ToolErrorCode } from "../errors.ts";
import type { ToolDefinition } from "../types.ts";
import { asBoolean } from "../validate.ts";
import {
  isInsideWorkspace,
  resolveInsideWorkspace,
  toPosixRelative,
} from "../path-jail.ts";
import { openWorkspace, type ResolvedFileLimits } from "./config.ts";

export interface FileListEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedAt: string;
  linkTarget?: string;
  linkEscapesWorkspace?: boolean;
  linkDangling?: boolean;
}

export interface FileListData {
  path: string;
  entries: FileListEntry[];
  truncated: boolean;
}

const parameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: {
      type: "string",
      minLength: 1,
      default: ".",
      description: "Directory relative to the workspace root. Defaults to the workspace root.",
    },
    recursive: {
      type: "boolean",
      default: false,
      description: "Walk subdirectories. Symlink directories are listed and not followed.",
    },
    includeHidden: {
      type: "boolean",
      default: true,
      description: "Include names that start with a dot.",
    },
    maxEntries: {
      type: "integer",
      minimum: 1,
      description: "Cap on returned entries. Cannot exceed the configured maximum.",
    },
  },
} as const;

export function createFileListTool(config: ResolvedFileLimits): ToolDefinition<FileListData> {
  return defineTool({
    name: "file_list",
    description:
      "List files and directories inside the workspace. path defaults to the workspace root. recursive walks subdirectories. Symlinks are listed and not followed; targets outside the workspace are marked and their paths are omitted.",
    parameters,
    risk: "read",
    requiresApproval: false,
    async run(params, ctx) {
      const userPath = typeof params.path === "string" ? params.path : ".";
      const recursive = asBoolean(params, "recursive", false);
      const includeHidden = asBoolean(params, "includeHidden", true);
      const requestedMax = params.maxEntries;
      const maxEntries =
        typeof requestedMax === "number" && Number.isInteger(requestedMax)
          ? Math.min(requestedMax, config.maxListEntries)
          : config.maxListEntries;
      if (typeof requestedMax === "number" && (!Number.isInteger(requestedMax) || requestedMax < 1)) {
        throw new ToolError(ToolErrorCode.invalidParams, "maxEntries must be a positive integer");
      }

      const root = await openWorkspace(config, ctx);
      const resolved = await resolveInsideWorkspace(root, userPath);
      let info;
      try {
        info = await lstat(resolved.absolute);
      } catch {
        throw new ToolError(ToolErrorCode.notFound, "path not found");
      }
      // Resolution already followed in-jail symlinks. A symlink here is a race
      // or an unfollowed link — do not readdir through it.
      if (info.isSymbolicLink()) {
        throw new ToolError(ToolErrorCode.symlinkEscape, "refusing to list through a symlink");
      }
      if (!info.isDirectory()) {
        throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
      }

      const entries: FileListEntry[] = [];
      const state = { truncated: false };
      await walkDirectory(
        root,
        resolved.absolute,
        resolved.relative === "." ? "" : resolved.relative,
        { recursive, includeHidden, maxEntries, entries, state },
      );

      const data: FileListData = {
        path: resolved.relative,
        entries,
        truncated: state.truncated,
      };
      return { ok: true, content: formatList(data), data };
    },
  });
}

interface WalkOptions {
  recursive: boolean;
  includeHidden: boolean;
  maxEntries: number;
  entries: FileListEntry[];
  state: { truncated: boolean };
}

async function walkDirectory(
  root: string,
  directory: string,
  relativeDirectory: string,
  options: WalkOptions,
): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(directory)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    throw new ToolError(ToolErrorCode.ioError, "failed to list directory");
  }

  for (const name of names) {
    if (options.entries.length >= options.maxEntries) {
      options.state.truncated = true;
      return;
    }
    if (!options.includeHidden && name.startsWith(".")) continue;
    const absolute = path.join(directory, name);
    if (!isInsideWorkspace(root, absolute)) {
      throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
    }
    let listed;
    try {
      listed = await lstat(absolute);
    } catch {
      throw new ToolError(ToolErrorCode.ioError, "failed to stat path");
    }
    const relative = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
    const entry = await describeEntry(root, absolute, name, relative, listed);
    options.entries.push(entry);
    if (options.recursive && entry.type === "directory") {
      await walkDirectory(root, absolute, relative, options);
    }
  }
}

async function describeEntry(
  root: string,
  absolute: string,
  name: string,
  relative: string,
  listed: Awaited<ReturnType<typeof lstat>>,
): Promise<FileListEntry> {
  const base = {
    name,
    path: relative,
    size: Number(listed.size),
    modifiedAt: new Date(Number(listed.mtimeMs)).toISOString(),
  };
  if (listed.isSymbolicLink()) {
    const link = await describeSymlink(root, absolute);
    return { ...base, type: "symlink", ...link };
  }
  if (listed.isDirectory()) return { ...base, type: "directory" };
  if (listed.isFile()) return { ...base, type: "file" };
  return { ...base, type: "other" };
}

async function describeSymlink(
  root: string,
  absolute: string,
): Promise<Pick<FileListEntry, "linkTarget" | "linkEscapesWorkspace" | "linkDangling">> {
  let linkText: string;
  try {
    linkText = await readlink(absolute);
  } catch {
    return { linkEscapesWorkspace: true };
  }
  if (linkText.includes("\0")) return { linkEscapesWorkspace: true };

  const lexical = path.resolve(path.dirname(absolute), linkText);
  if (!isInsideWorkspace(root, lexical)) {
    return { linkEscapesWorkspace: true };
  }

  try {
    const followed = await resolveInsideWorkspace(root, absolute);
    let targetStat;
    try {
      targetStat = await stat(followed.absolute);
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
      if (code === "ENOENT") {
        return { linkTarget: toPosixRelative(root, lexical), linkDangling: true };
      }
      return { linkEscapesWorkspace: true };
    }
    if (!targetStat) return { linkEscapesWorkspace: true };
    return { linkTarget: followed.relative };
  } catch (err) {
    if (err instanceof ToolError && err.code === ToolErrorCode.symlinkEscape) {
      if (err.message.includes("too many")) return {};
      return { linkEscapesWorkspace: true };
    }
    if (err instanceof ToolError && err.code === ToolErrorCode.pathEscape) {
      return { linkEscapesWorkspace: true };
    }
    if (err instanceof ToolError && err.code === ToolErrorCode.notFound) {
      return { linkTarget: toPosixRelative(root, lexical), linkDangling: true };
    }
    return { linkEscapesWorkspace: true };
  }
}

function formatList(data: FileListData): string {
  const header = `${data.path} (${data.entries.length} entries${data.truncated ? ", truncated" : ""})`;
  if (data.entries.length === 0) return header;
  const lines = data.entries.map((entry) => {
    if (entry.type === "symlink") {
      if (entry.linkEscapesWorkspace) return `${entry.path} symlink (outside workspace)`;
      if (entry.linkDangling) return `${entry.path} symlink -> ${entry.linkTarget ?? "?"} (dangling)`;
      if (!entry.linkTarget) return `${entry.path} symlink (unresolved)`;
      return `${entry.path} symlink -> ${entry.linkTarget}`;
    }
    return `${entry.path} ${entry.type} ${entry.size}`;
  });
  return `${header}\n${lines.join("\n")}`;
}
