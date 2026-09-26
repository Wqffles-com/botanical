import { constants, type PathLike } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { ToolError, ToolErrorCode } from "../errors.ts";

export function noFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (typeof flag !== "number") {
    throw new ToolError(ToolErrorCode.ioError, "this platform cannot refuse symlink opens");
  }
  return flag;
}

/** Open `abs` without following a symlink at the final component. */
export async function openNoFollow(abs: PathLike, flags: number, mode = 0o644): Promise<FileHandle> {
  try {
    return await open(abs, flags | noFollowFlag(), mode);
  } catch (err) {
    throw mapOpenError(err);
  }
}

export function mapOpenError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  const code = errno(err);
  if (code === "ELOOP" || code === "EMLINK") {
    return new ToolError(ToolErrorCode.symlinkEscape, "refusing to follow a symlink");
  }
  if (code === "EEXIST") {
    return new ToolError(ToolErrorCode.alreadyExists, "file already exists");
  }
  if (code === "ENOENT") {
    return new ToolError(ToolErrorCode.notFound, "path not found");
  }
  if (code === "EISDIR") {
    return new ToolError(ToolErrorCode.isDirectory, "path is a directory");
  }
  if (code === "ENOTDIR") {
    return new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
  }
  return new ToolError(ToolErrorCode.ioError, "failed to open path");
}

export function decodeUtf8(buf: Buffer): string {
  if (buf.includes(0)) {
    throw new ToolError(ToolErrorCode.binaryFile, "file is binary; file_read only returns utf-8 text");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new ToolError(ToolErrorCode.binaryFile, "file is not valid utf-8 text");
  }
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buf.subarray(0, end).toString("utf8");
}

function errno(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
