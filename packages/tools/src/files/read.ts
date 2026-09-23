import { constants } from "node:fs";
import { defineTool } from "../registry.ts";
import { ToolError, ToolErrorCode } from "../errors.ts";
import type { ToolDefinition } from "../types.ts";
import { asInteger, asString } from "../validate.ts";
import { openWorkspace, type ResolvedFileLimits } from "./config.ts";
import { decodeUtf8, openNoFollow, truncateUtf8 } from "./io.ts";
import { resolveInsideWorkspace } from "../path-jail.ts";

export interface FileReadData {
  path: string;
  bytes: number;
  truncated: boolean;
  startLine: number;
  endLine: number;
  totalLines: number;
}

const parameters = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description:
        "File path relative to the workspace root. Absolute paths are accepted only when they stay inside the workspace.",
    },
    offset: {
      type: "integer",
      minimum: 1,
      description: "1-based line number to start at. Defaults to 1.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100_000,
      description: "Maximum number of lines to return. Defaults to the rest of the file.",
    },
  },
} as const;

export function createFileReadTool(config: ResolvedFileLimits): ToolDefinition<FileReadData> {
  return defineTool({
    name: "file_read",
    description:
      "Read a UTF-8 text file inside the workspace. Paths stay inside the configured workspace root, including through symlinks. Use offset (1-based line) and limit to window a large file. Refuses binary files and directories.",
    parameters,
    risk: "read",
    requiresApproval: false,
    async run(params, ctx) {
      const userPath = asString(params, "path");
      const offset = asInteger(params, "offset");
      const limit = asInteger(params, "limit");
      const root = await openWorkspace(config, ctx);
      const resolved = await resolveInsideWorkspace(root, userPath);

      const handle = await openNoFollow(resolved.absolute, constants.O_RDONLY);
      try {
        const info = await handle.stat();
        if (info.isDirectory()) {
          throw new ToolError(ToolErrorCode.isDirectory, "path is a directory");
        }
        if (!info.isFile()) {
          throw new ToolError(ToolErrorCode.ioError, "path is not a regular file");
        }
        if (info.size > config.maxFileBytes) {
          throw new ToolError(
            ToolErrorCode.tooLarge,
            `file is ${info.size} bytes; max file size is ${config.maxFileBytes} bytes`,
          );
        }
        const windowed = offset !== undefined || limit !== undefined;
        if (!windowed && info.size > config.maxReadBytes) {
          throw new ToolError(
            ToolErrorCode.tooLarge,
            `file is ${info.size} bytes; max read is ${config.maxReadBytes} bytes. Pass offset and limit to read a line window.`,
          );
        }

        const buf = Buffer.from(await handle.readFile());
        if (buf.length > config.maxFileBytes) {
          throw new ToolError(
            ToolErrorCode.tooLarge,
            `file exceeds the max file size of ${config.maxFileBytes} bytes`,
          );
        }
        const text = decodeUtf8(buf);
        const lines = splitLines(text);
        const startLine = offset ?? 1;
        const startIndex = startLine - 1;
        const sliced =
          startIndex >= lines.length
            ? []
            : lines.slice(startIndex, limit === undefined ? undefined : startIndex + limit);
        let body = sliced.join("\n");
        let truncated = false;
        if (Buffer.byteLength(body, "utf8") > config.maxReadBytes) {
          body = truncateUtf8(body, config.maxReadBytes);
          truncated = true;
        }
        const endLine = sliced.length === 0 ? startLine - 1 : startLine + sliced.length - 1;
        const fullFile = !truncated && startLine === 1 && endLine === lines.length;
        const returned = fullFile ? text : body;
        const data: FileReadData = {
          path: resolved.relative,
          bytes: Buffer.byteLength(returned, "utf8"),
          truncated,
          startLine,
          endLine,
          totalLines: lines.length,
        };
        return { ok: true, content: fullFile ? text : formatWindow(data, body), data };
      } finally {
        await handle.close();
      }
    },
  });
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function formatWindow(data: FileReadData, body: string): string {
  if (data.endLine < data.startLine) {
    return `[${data.path} no lines in range; file has ${data.totalLines} lines]\n`;
  }
  const note = data.truncated ? "truncated " : "";
  return `[${data.path} ${note}lines ${data.startLine}-${data.endLine} of ${data.totalLines}]\n${body}`;
}
