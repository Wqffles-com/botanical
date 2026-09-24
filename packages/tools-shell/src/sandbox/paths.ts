import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { ToolInputError } from "../errors.ts";

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function assertNoNul(label: string, value: string): void {
  if (value.includes("\0")) {
    throw new ToolInputError("invalid_path", `${label} contains NUL`);
  }
}

/**
 * Resolve `requested` cwd against the workspace and return both the host
 * directory (for the bind mount) and the path the command will see (`/workspace/...`).
 *
 * Symlinks are resolved with `realpath`. A link that points outside the
 * workspace is rejected before the jail starts. The jail is still what
 * enforces the boundary at runtime.
 */
export function resolveWorkspaceCwd(
  workspaceRoot: string,
  requested: string | undefined,
): { workspaceReal: string; jailCwd: string } {
  assertNoNul("workspace", workspaceRoot);
  if (requested != null) assertNoNul("cwd", requested);

  let workspaceReal: string;
  try {
    workspaceReal = realpathSync(workspaceRoot);
  } catch {
    throw new ToolInputError("invalid_workspace", "workspace does not exist");
  }

  let info;
  try {
    info = statSync(workspaceReal);
  } catch {
    throw new ToolInputError("invalid_workspace", "workspace does not exist");
  }
  if (!info.isDirectory()) {
    throw new ToolInputError("invalid_workspace", "workspace is not a directory");
  }
  if (workspaceReal === path.parse(workspaceReal).root) {
    throw new ToolInputError(
      "invalid_workspace",
      "workspace must be a dedicated directory, not the filesystem root",
    );
  }

  if (requested == null || requested === "" || requested === ".") {
    return { workspaceReal, jailCwd: "/workspace" };
  }

  const lexical = path.resolve(workspaceReal, requested);
  if (!isInside(workspaceReal, lexical)) {
    throw new ToolInputError("cwd_escape", "cwd escapes the workspace");
  }

  let realCwd: string;
  try {
    realCwd = realpathSync(lexical);
  } catch {
    throw new ToolInputError("invalid_cwd", "cwd does not exist");
  }
  if (!isInside(workspaceReal, realCwd)) {
    throw new ToolInputError("cwd_escape", "cwd escapes the workspace");
  }
  let cwdInfo;
  try {
    cwdInfo = statSync(realCwd);
  } catch {
    throw new ToolInputError("invalid_cwd", "cwd does not exist");
  }
  if (!cwdInfo.isDirectory()) {
    throw new ToolInputError("invalid_cwd", "cwd is not a directory");
  }

  const rel = path.relative(workspaceReal, realCwd);
  const jailCwd = rel === "" ? "/workspace" : `/workspace/${rel.split(path.sep).join("/")}`;
  if (!(jailCwd === "/workspace" || jailCwd.startsWith("/workspace/"))) {
    throw new ToolInputError("cwd_escape", "cwd escapes the workspace");
  }
  return { workspaceReal, jailCwd };
}

/** Locate a binary on {@link FIXED_PATH} only. */
export function whichOnFixedPath(name: string, fixedPath: string): string | null {
  if (name.includes("/") || name.includes("\0") || name === "" || name === "." || name === "..") {
    return null;
  }
  for (const dir of fixedPath.split(":")) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}
