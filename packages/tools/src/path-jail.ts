import { lstat, mkdir, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ToolError, ToolErrorCode } from "./errors.ts";

const MAX_SYMLINK_DEPTH = 40;

export interface ResolvedPath {
  root: string;
  absolute: string;
  /** POSIX-style path relative to the workspace. `"."` is the workspace root. */
  relative: string;
  /** True when the final component is a symlink that was intentionally not followed. */
  symlink: boolean;
}

export interface ResolveInsideOptions {
  /** Final component may be absent (create/write). */
  allowMissing?: boolean;
  /** Missing intermediate directories are allowed; `..` after a gap is rejected. */
  allowMissingParents?: boolean;
  /** Leave a final symlink unfollowed. Delete uses this so the link, not its target, is removed. */
  noFollowFinal?: boolean;
}

/**
 * `root` must already be canonical (see {@link canonicalizeWorkspaceRoot}).
 * Every path component is walked. `..` is applied after symlink resolution,
 * so a lexical `path.normalize` cannot hide a symlink that steps outside.
 */
export async function resolveInsideWorkspace(
  rootReal: string,
  userPath: string,
  options: ResolveInsideOptions = {},
): Promise<ResolvedPath> {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new ToolError(ToolErrorCode.invalidParams, "path must be a non-empty string");
  }
  if (userPath.includes("\0")) {
    throw new ToolError(ToolErrorCode.invalidParams, "path contains a null byte");
  }

  const absoluteInput = path.isAbsolute(userPath);
  let start = rootReal;
  let segments: string[];
  if (absoluteInput) {
    const rest = stripRootPrefix(rootReal, userPath);
    if (rest === null) {
      throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
    }
    segments = rawSegments(rest);
  } else {
    segments = rawSegments(userPath);
  }

  const resolved = await walk(rootReal, start, segments, 0, options);
  assertInsideWorkspace(rootReal, resolved.absolute);
  return {
    root: rootReal,
    absolute: resolved.absolute,
    relative: toPosixRelative(rootReal, resolved.absolute),
    symlink: resolved.symlink,
  };
}

export async function canonicalizeWorkspaceRoot(root: string): Promise<string> {
  if (typeof root !== "string" || root.trim() === "") {
    throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root is empty");
  }
  let real: string;
  try {
    real = await realpath(root);
  } catch (err) {
    const code = errno(err);
    if (code === "ENOENT") {
      throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root does not exist");
    }
    throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root is not accessible");
  }
  let info;
  try {
    info = await stat(real);
  } catch {
    throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root is not accessible");
  }
  if (!info.isDirectory()) {
    throw new ToolError(ToolErrorCode.invalidWorkspace, "workspace root is not a directory");
  }
  return real;
}

export function isInsideWorkspace(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function assertInsideWorkspace(root: string, candidate: string): void {
  if (!isInsideWorkspace(root, candidate)) {
    throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
  }
}

export function toPosixRelative(root: string, absolute: string): string {
  const rel = path.relative(root, absolute);
  if (rel === "") return ".";
  return rel.split(path.sep).join("/");
}

/** Create `directory` and any missing parents. Every created component stays inside `root`. */
export async function mkdirAllInside(root: string, directory: string): Promise<boolean> {
  assertInsideWorkspace(root, directory);
  if (directory === root) return false;
  const relative = path.relative(root, directory);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  let current = root;
  let created = false;

  for (const segment of segments) {
    if (segment === "..") {
      throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
    }
    const next = path.join(current, segment);
    assertInsideWorkspace(root, next);
    let listed;
    try {
      listed = await lstat(next);
    } catch (err) {
      if (errno(err) !== "ENOENT") {
        throw new ToolError(ToolErrorCode.ioError, "failed to create directory");
      }
      try {
        await mkdir(next);
      } catch (mkdirErr) {
        if (errno(mkdirErr) === "EEXIST") {
          listed = await lstat(next);
        } else {
          throw new ToolError(ToolErrorCode.ioError, "failed to create directory");
        }
      }
      if (!listed) {
        created = true;
        current = next;
        continue;
      }
    }

    if (listed.isSymbolicLink()) {
      const followed = await resolveInsideWorkspace(root, next);
      let targetStat;
      try {
        targetStat = await stat(followed.absolute);
      } catch {
        throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
      }
      if (!targetStat.isDirectory()) {
        throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
      }
      current = followed.absolute;
      continue;
    }
    if (!listed.isDirectory()) {
      throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
    }
    current = next;
  }

  return created;
}

async function walk(
  root: string,
  current: string,
  segments: readonly string[],
  depth: number,
  options: ResolveInsideOptions,
): Promise<{ absolute: string; symlink: boolean }> {
  let cursor = current;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === undefined || segment.length === 0 || segment === ".") continue;

    if (segment === "..") {
      const parent = path.dirname(cursor);
      if (parent === cursor || !isInsideWorkspace(root, parent)) {
        throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
      }
      cursor = parent;
      continue;
    }

    const next = path.join(cursor, segment);
    assertInsideWorkspace(root, next);
    const isLast = index === segments.length - 1;

    let listed;
    try {
      listed = await lstat(next);
    } catch (err) {
      const code = errno(err);
      if (code === "ENOENT") {
        if (isLast && options.allowMissing) {
          return { absolute: next, symlink: false };
        }
        if (!isLast && options.allowMissingParents) {
          return { absolute: joinMissing(root, cursor, segments.slice(index)), symlink: false };
        }
        throw new ToolError(ToolErrorCode.notFound, "path not found");
      }
      if (code === "ENOTDIR") {
        throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
      }
      throw new ToolError(ToolErrorCode.ioError, "failed to stat path");
    }

    if (listed.isSymbolicLink()) {
      if (isLast && options.noFollowFinal) {
        return { absolute: next, symlink: true };
      }
      if (depth >= MAX_SYMLINK_DEPTH) {
        throw new ToolError(ToolErrorCode.symlinkEscape, "too many symlinks");
      }
      const followed = await followSymlink(root, next, depth);
      if (!isLast) {
        if (!(await isDirectory(followed.absolute))) {
          throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
        }
        return walk(root, followed.absolute, segments.slice(index + 1), depth + 1, options);
      }
      return followed;
    }

    if (!isLast && !listed.isDirectory()) {
      throw new ToolError(ToolErrorCode.notDirectory, "path is not a directory");
    }
    cursor = next;
  }
  return { absolute: cursor, symlink: false };
}

async function followSymlink(
  root: string,
  linkPath: string,
  depth: number,
): Promise<{ absolute: string; symlink: boolean }> {
  let linkText: string;
  try {
    linkText = await readlink(linkPath);
  } catch {
    throw new ToolError(ToolErrorCode.ioError, "failed to read symlink");
  }
  if (linkText.includes("\0")) {
    throw new ToolError(ToolErrorCode.symlinkEscape, "symlink target escapes the workspace root");
  }

  if (path.isAbsolute(linkText)) {
    const rest = stripRootPrefix(root, linkText);
    if (rest === null) {
      throw new ToolError(ToolErrorCode.symlinkEscape, "symlink target escapes the workspace root");
    }
    return walk(root, root, rawSegments(rest), depth + 1, {});
  }

  return walk(root, path.dirname(linkPath), rawSegments(linkText), depth + 1, {});
}

function joinMissing(root: string, current: string, rest: readonly string[]): string {
  if (rest.some((part) => part === ".." || part.includes("\0"))) {
    throw new ToolError(ToolErrorCode.pathEscape, "path escapes the workspace root");
  }
  let created = current;
  for (const part of rest) {
    if (part === undefined || part.length === 0 || part === ".") continue;
    created = path.join(created, part);
    assertInsideWorkspace(root, created);
  }
  return created;
}

async function isDirectory(absolute: string): Promise<boolean> {
  try {
    const info = await lstat(absolute);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function rawSegments(value: string): string[] {
  return value.split(path.sep).filter((segment) => segment.length > 0 && segment !== ".");
}

/** Return the path relative to `root`, or null when `absolutePath` is not under it. */
function stripRootPrefix(root: string, absolutePath: string): string | null {
  if (root === path.sep) {
    if (!absolutePath.startsWith(path.sep)) return null;
    return absolutePath === path.sep ? "" : absolutePath.slice(1);
  }
  if (absolutePath === root) return "";
  const prefix = `${root}${path.sep}`;
  if (!absolutePath.startsWith(prefix)) return null;
  return absolutePath.slice(prefix.length);
}

function errno(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
