import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "../registry.ts";
import { ToolError, ToolErrorCode } from "../errors.ts";
import type { ToolDefinition } from "../types.ts";
import { asBoolean, asString } from "../validate.ts";
import { assertInsideWorkspace, mkdirAllInside, resolveInsideWorkspace } from "../path-jail.ts";
import { openWorkspace, type ResolvedFileLimits } from "./config.ts";
import { openNoFollow } from "./io.ts";

export interface FileWriteData {
  path: string;
  bytesWritten: number;
  mode: "overwrite" | "append" | "create";
  createdDirectories: boolean;
}

const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["path", "content"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description: "File path relative to the workspace root, or an absolute path inside it.",
    },
    content: {
      type: "string",
      description: "UTF-8 text to write.",
    },
    mode: {
      type: "string",
      enum: ["overwrite", "append", "create"],
      default: "overwrite",
      description:
        "overwrite replaces the file, append adds to the end, create fails if the file already exists.",
    },
    createDirectories: {
      type: "boolean",
      default: true,
      description: "Create missing parent directories inside the workspace.",
    },
  },
} as const;

export function createFileWriteTool(config: ResolvedFileLimits): ToolDefinition<FileWriteData> {
  return defineTool({
    name: "file_write",
    description:
      "Write a UTF-8 text file inside the workspace. mode is overwrite (default), append, or create (fail if the file exists). Parent directories are created inside the workspace unless createDirectories is false. Refuses paths that escape the workspace, including via symlinks. Requires approval.",
    parameters,
    risk: "write",
    requiresApproval: true,
    async run(params, ctx) {
      const userPath = asString(params, "path");
      const content = asString(params, "content");
      const modeValue = params.mode;
      const mode = modeValue === undefined ? "overwrite" : modeValue;
      if (mode !== "overwrite" && mode !== "append" && mode !== "create") {
        throw new ToolError(ToolErrorCode.invalidParams, "mode must be overwrite, append, or create");
      }
      const createDirectories = asBoolean(params, "createDirectories", true);
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > config.maxWriteBytes) {
        throw new ToolError(
          ToolErrorCode.tooLarge,
          `content is ${bytes} bytes; max write is ${config.maxWriteBytes} bytes`,
        );
      }

      const root = await openWorkspace(config, ctx);
      const resolved = await resolveInsideWorkspace(root, userPath, {
        allowMissing: true,
        allowMissingParents: createDirectories,
      });
      if (resolved.relative === ".") {
        throw new ToolError(ToolErrorCode.isDirectory, "path is a directory");
      }
      await assertNotDirectory(resolved.absolute);

      const parent = path.dirname(resolved.absolute);
      assertInsideWorkspace(root, parent);
      let createdDirectories = false;
      if (createDirectories) {
        createdDirectories = await mkdirAllInside(root, parent);
      }

      if (mode === "append") {
        const handle = await openNoFollow(
          resolved.absolute,
          constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
        );
        try {
          await handle.appendFile(content, "utf8");
        } finally {
          await handle.close();
        }
      } else if (mode === "create") {
        const handle = await openNoFollow(
          resolved.absolute,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        );
        try {
          await handle.writeFile(content, "utf8");
        } finally {
          await handle.close();
        }
      } else {
        await writeAtomic(root, resolved.absolute, content);
      }

      const data: FileWriteData = {
        path: resolved.relative,
        bytesWritten: bytes,
        mode,
        createdDirectories,
      };
      return {
        ok: true,
        content: `wrote ${data.path} (${data.bytesWritten} bytes, ${data.mode})`,
        data,
      };
    },
  });
}

async function assertNotDirectory(absolute: string): Promise<void> {
  try {
    const listed = await lstat(absolute);
    if (listed.isDirectory()) {
      throw new ToolError(ToolErrorCode.isDirectory, "path is a directory");
    }
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (code === "ENOENT") return;
    throw new ToolError(ToolErrorCode.ioError, "failed to stat path");
  }
}

async function writeAtomic(root: string, absolute: string, content: string): Promise<void> {
  const directory = path.dirname(absolute);
  const tmp = path.join(
    directory,
    `.${path.basename(absolute)}.${randomBytes(8).toString("hex")}.botanical-tmp`,
  );
  assertInsideWorkspace(root, tmp);
  const handle = await openNoFollow(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  try {
    await handle.writeFile(content, "utf8");
  } catch (err) {
    await handle.close();
    await unlink(tmp).catch(() => undefined);
    if (err instanceof ToolError) throw err;
    throw new ToolError(ToolErrorCode.ioError, "failed to write file");
  }
  await handle.close();
  try {
    await rename(tmp, absolute);
  } catch {
    await unlink(tmp).catch(() => undefined);
    throw new ToolError(ToolErrorCode.ioError, "failed to write file");
  }
}
