import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileTools, createToolRegistry, type ToolRegistry } from "../src/index.ts";

const cleanups: string[] = [];

afterEach(async () => {
  delete process.env.BOTANICAL_WORKSPACE_ROOT;
  delete process.env.BOTANICAL_WORKSPACE;
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeParent(): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), "botanical-files-"));
  cleanups.push(parent);
  return parent;
}

async function makeWorkspace(): Promise<{ parent: string; root: string }> {
  const parent = await makeParent();
  const root = path.join(parent, "ws");
  await mkdir(root);
  return { parent, root };
}

function registryFor(root: string, limits: Record<string, number> = {}): ToolRegistry {
  return createToolRegistry(createFileTools({ workspaceRoot: root, ...limits }));
}

describe("file tools", () => {
  test("writes, reads, lists, and deletes inside the workspace", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);

    const wrote = await registry.execute("file_write", {
      path: "notes/a.txt",
      content: "hello\n",
    });
    expect(wrote.ok).toBe(true);
    expect(wrote.data).toMatchObject({
      path: "notes/a.txt",
      bytesWritten: 6,
      mode: "overwrite",
      createdDirectories: true,
    });
    expect(await readFile(path.join(root, "notes/a.txt"), "utf8")).toBe("hello\n");

    const read = await registry.execute("file_read", { path: "notes/a.txt" });
    expect(read.ok).toBe(true);
    expect(read.content).toBe("hello\n");

    const appended = await registry.execute("file_write", {
      path: "notes/a.txt",
      content: "there",
      mode: "append",
    });
    expect(appended.ok).toBe(true);
    expect(await readFile(path.join(root, "notes/a.txt"), "utf8")).toBe("hello\nthere");

    await registry.execute("file_write", { path: "notes/b.txt", content: "b" });
    const listed = await registry.execute("file_list", { path: "notes" });
    expect(listed.ok).toBe(true);
    const entries = (listed.data as { entries: { path: string }[] }).entries.map((entry) => entry.path);
    expect(entries).toEqual(["notes/a.txt", "notes/b.txt"]);

    const removed = await registry.execute("file_delete", {
      path: "notes/b.txt",
      confirm: true,
    });
    expect(removed.ok).toBe(true);
    await expect(lstat(path.join(root, "notes/b.txt"))).rejects.toThrow();
  });

  test("reads a line window and keeps the full file text when unwindowed", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);
    await writeFile(path.join(root, "lines.txt"), "one\ntwo\nthree\n");
    const windowed = await registry.execute("file_read", { path: "lines.txt", offset: 2, limit: 1 });
    expect(windowed.ok).toBe(true);
    expect(windowed.content).toContain("two");
    expect(windowed.content).not.toContain("three");
    expect(windowed.data).toMatchObject({ startLine: 2, endLine: 2, totalLines: 3, truncated: false });

    const past = await registry.execute("file_read", { path: "lines.txt", offset: 9, limit: 1 });
    expect(past.ok).toBe(true);
    expect(past.content).toContain("no lines in range");
  });

  test("refuses binary files and files over the read cap unless a window is requested", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root, { maxReadBytes: 4, maxFileBytes: 100 });
    await writeFile(path.join(root, "big.txt"), "hello world");
    const capped = await registry.execute("file_read", { path: "big.txt" });
    expect(capped.ok).toBe(false);
    expect(capped.error?.code).toBe("too_large");

    const windowed = await registry.execute("file_read", { path: "big.txt", offset: 1, limit: 1 });
    expect(windowed.ok).toBe(true);
    expect(windowed.data).toMatchObject({ truncated: true });
    expect(windowed.content).toContain("hell");

    await writeFile(path.join(root, "bin.dat"), Buffer.from([0x68, 0x00, 0x69]));
    const binary = await registry.execute("file_read", { path: "bin.dat" });
    expect(binary.ok).toBe(false);
    expect(binary.error?.code).toBe("binary_file");
  });

  test("create mode fails when the file exists and refuses to replace a directory", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);
    const created = await registry.execute("file_write", {
      path: "fresh.txt",
      content: "a",
      mode: "create",
    });
    expect(created.ok).toBe(true);
    const again = await registry.execute("file_write", {
      path: "fresh.txt",
      content: "b",
      mode: "create",
    });
    expect(again.error?.code).toBe("already_exists");
    expect(await readFile(path.join(root, "fresh.txt"), "utf8")).toBe("a");

    await mkdir(path.join(root, "dir"));
    const asDir = await registry.execute("file_write", { path: "dir", content: "nope" });
    expect(asDir.error?.code).toBe("is_directory");
    const readDir = await registry.execute("file_read", { path: "dir" });
    expect(readDir.error?.code).toBe("is_directory");
    const listFile = await registry.execute("file_list", { path: "fresh.txt" });
    expect(listFile.error?.code).toBe("not_directory");
  });

  test("does not create missing parents when createDirectories is false", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);
    const result = await registry.execute("file_write", {
      path: "missing/a.txt",
      content: "x",
      createDirectories: false,
    });
    expect(result.error?.code).toBe("not_found");
  });

  test("rejects traversal, absolute paths outside, null bytes, and prefix siblings", async () => {
    const { parent, root } = await makeWorkspace();
    const evil = path.join(parent, "ws-evil");
    await mkdir(evil);
    await writeFile(path.join(evil, "secret.txt"), "secret");
    const registry = registryFor(root);

    for (const userPath of ["../ws-evil/secret.txt", path.join(evil, "secret.txt"), `${root}/../ws-evil/secret.txt`]) {
      const result = await registry.execute("file_read", { path: userPath });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("path_escape");
      expect(result.content).not.toContain("secret");
      expect(result.content).not.toContain(evil);
    }

    const nul = await registry.execute("file_read", { path: "bad\0.txt" });
    expect(nul.error?.code).toBe("invalid_params");

    const wrote = await registry.execute("file_write", {
      path: "new/../../ws-evil/pwned.txt",
      content: "nope",
    });
    expect(wrote.ok).toBe(false);
    await expect(lstat(path.join(evil, "pwned.txt"))).rejects.toThrow();
  });

  test("refuses symlinks that resolve outside the workspace", async () => {
    const { parent, root } = await makeWorkspace();
    const outsideFile = path.join(parent, "outside.txt");
    const outsideDir = path.join(parent, "secret-dir");
    await writeFile(outsideFile, "original");
    await mkdir(outsideDir);
    await writeFile(path.join(outsideDir, "secret.txt"), "top-secret");
    await symlink(outsideFile, path.join(root, "evil"));
    await symlink(parent, path.join(root, "up"));
    const registry = registryFor(root);

    const readFileLink = await registry.execute("file_read", { path: "evil" });
    expect(readFileLink.ok).toBe(false);
    expect(readFileLink.error?.code === "path_escape" || readFileLink.error?.code === "symlink_escape").toBe(
      true,
    );
    expect(readFileLink.content).not.toContain("original");
    expect(readFileLink.content).not.toContain(outsideFile);

    const readThroughDir = await registry.execute("file_read", { path: "up/secret-dir/secret.txt" });
    expect(readThroughDir.ok).toBe(false);
    expect(readThroughDir.content).not.toContain("top-secret");
    expect(readThroughDir.content).not.toContain(outsideDir);

    const writeLink = await registry.execute("file_write", { path: "evil", content: "pwned" });
    expect(writeLink.ok).toBe(false);
    expect(await readFile(outsideFile, "utf8")).toBe("original");

    const writeThrough = await registry.execute("file_write", {
      path: "up/secret-dir/secret.txt",
      content: "pwned",
    });
    expect(writeThrough.ok).toBe(false);
    expect(await readFile(path.join(outsideDir, "secret.txt"), "utf8")).toBe("top-secret");
  });

  test("follows symlinks that stay inside the workspace", async () => {
    const { root } = await makeWorkspace();
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/a.txt"), "inside");
    await symlink("sub", path.join(root, "linkdir"));
    await symlink("sub/a.txt", path.join(root, "link.txt"));
    const registry = registryFor(root);

    const read = await registry.execute("file_read", { path: "link.txt" });
    expect(read.ok).toBe(true);
    expect(read.content).toBe("inside");

    const nested = await registry.execute("file_read", { path: "linkdir/a.txt" });
    expect(nested.content).toBe("inside");

    const wrote = await registry.execute("file_write", { path: "linkdir/b.txt", content: "new" });
    expect(wrote.ok).toBe(true);
    expect(await readFile(path.join(root, "sub/b.txt"), "utf8")).toBe("new");
  });

  test("rejects a symlink loop", async () => {
    const { root } = await makeWorkspace();
    await symlink("loop", path.join(root, "loop"));
    const registry = registryFor(root);
    const result = await registry.execute("file_read", { path: "loop" });
    expect(result.error?.code).toBe("symlink_escape");
  });

  test("lists symlink targets inside the workspace and hides targets that leave it", async () => {
    const { parent, root } = await makeWorkspace();
    const outside = path.join(parent, "hidden-outside-name");
    await mkdir(outside);
    await mkdir(path.join(root, "real"));
    await writeFile(path.join(root, "real/nested.txt"), "x");
    await symlink("real/nested.txt", path.join(root, "inside-link"));
    await symlink("missing.txt", path.join(root, "dangling"));
    await symlink(outside, path.join(root, "outside-link"));
    await symlink("real", path.join(root, "dir-link"));
    const registry = registryFor(root);

    const listed = await registry.execute("file_list", { path: ".", recursive: true });
    expect(listed.ok).toBe(true);
    const data = listed.data as {
      entries: { path: string; type: string; linkTarget?: string; linkEscapesWorkspace?: boolean; linkDangling?: boolean }[];
    };
    const byPath = new Map(data.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("inside-link")?.linkTarget).toBe("real/nested.txt");
    expect(byPath.get("dangling")?.linkDangling).toBe(true);
    expect(byPath.get("outside-link")?.linkEscapesWorkspace).toBe(true);
    expect(byPath.get("outside-link")?.linkTarget).toBeUndefined();
    expect(listed.content).not.toContain("hidden-outside-name");
    expect(byPath.has("dir-link/nested.txt")).toBe(false);
    expect(byPath.has("real/nested.txt")).toBe(true);

    const hidden = await registry.execute("file_list", { path: ".", includeHidden: false });
    await writeFile(path.join(root, ".secret"), "s");
    const withHidden = await registry.execute("file_list", { path: "." });
    const withoutHidden = await registry.execute("file_list", { path: ".", includeHidden: false });
    const hiddenNames = (withHidden.data as { entries: { name: string }[] }).entries.map((entry) => entry.name);
    const visibleNames = (withoutHidden.data as { entries: { name: string }[] }).entries.map((entry) => entry.name);
    expect(hiddenNames).toContain(".secret");
    expect(visibleNames).not.toContain(".secret");
    expect(hidden.ok).toBe(true);
  });

  test("truncates listings at the configured cap", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root, { maxListEntries: 2 });
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "b.txt"), "b");
    await writeFile(path.join(root, "c.txt"), "c");
    const listed = await registry.execute("file_list", { path: "." });
    const data = listed.data as { entries: unknown[]; truncated: boolean };
    expect(data.entries).toHaveLength(2);
    expect(data.truncated).toBe(true);
  });

  test("delete requires confirm, protects the root, and refuses a non-empty directory", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);
    await writeFile(path.join(root, "keep.txt"), "keep");
    await mkdir(path.join(root, "box"));
    await writeFile(path.join(root, "box/a.txt"), "a");

    const missing = await registry.execute("file_delete", { path: "keep.txt" });
    expect(missing.error?.code).toBe("invalid_params");
    const unconfirmed = await registry.execute("file_delete", { path: "keep.txt", confirm: false });
    expect(unconfirmed.error?.code).toBe("confirmation_required");
    expect(await readFile(path.join(root, "keep.txt"), "utf8")).toBe("keep");

    const stringConfirm = await registry.execute("file_delete", { path: "keep.txt", confirm: "true" });
    expect(stringConfirm.error?.code).toBe("invalid_params");

    const rootDelete = await registry.execute("file_delete", { path: ".", confirm: true, recursive: true });
    expect(rootDelete.error?.code).toBe("workspace_root_protected");
    const absRoot = await registry.execute("file_delete", { path: root, confirm: true, recursive: true });
    expect(absRoot.error?.code).toBe("workspace_root_protected");

    const nonempty = await registry.execute("file_delete", { path: "box", confirm: true });
    expect(nonempty.error?.code).toBe("not_empty");
    expect(await readFile(path.join(root, "box/a.txt"), "utf8")).toBe("a");

    await mkdir(path.join(root, "empty"));
    const empty = await registry.execute("file_delete", { path: "empty", confirm: true });
    expect(empty.ok).toBe(true);
  });

  test("recursive delete removes the tree and does not follow symlinks out of the workspace", async () => {
    const { parent, root } = await makeWorkspace();
    const outside = path.join(parent, "outside-dir");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await mkdir(path.join(root, "box"));
    await writeFile(path.join(root, "box/local.txt"), "local");
    await symlink(outside, path.join(root, "box/leak"));
    await symlink(path.join(outside, "secret.txt"), path.join(root, "file-link"));
    const registry = registryFor(root);

    const link = await registry.execute("file_delete", { path: "file-link", confirm: true });
    expect(link.ok).toBe(true);
    expect(link.data).toMatchObject({ symlinks: 1, files: 0 });
    expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("secret");

    const tree = await registry.execute("file_delete", { path: "box", confirm: true, recursive: true });
    expect(tree.ok).toBe(true);
    await expect(lstat(path.join(root, "box"))).rejects.toThrow();
    expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("secret");
  });

  test("refuses an oversized delete without removing anything", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root, { maxDeleteEntries: 2 });
    await mkdir(path.join(root, "box"));
    await writeFile(path.join(root, "box/a.txt"), "a");
    await writeFile(path.join(root, "box/b.txt"), "b");
    const result = await registry.execute("file_delete", {
      path: "box",
      confirm: true,
      recursive: true,
    });
    expect(result.error?.code).toBe("too_many_entries");
    expect(await readFile(path.join(root, "box/a.txt"), "utf8")).toBe("a");
    expect(await readFile(path.join(root, "box/b.txt"), "utf8")).toBe("b");
  });

  test("fails closed without a workspace and lets the call override the configured root", async () => {
    const parent = await makeParent();
    const alpha = path.join(parent, "alpha");
    const beta = path.join(parent, "beta");
    await mkdir(alpha);
    await mkdir(beta);
    await writeFile(path.join(alpha, "only-a.txt"), "A");
    await writeFile(path.join(beta, "only-b.txt"), "B");

    const unbound = createToolRegistry(createFileTools());
    const missing = await unbound.execute("file_read", { path: "only-a.txt" });
    expect(missing.error?.code).toBe("invalid_workspace");

    process.env.BOTANICAL_WORKSPACE_ROOT = alpha;
    const fromEnv = createToolRegistry(createFileTools());
    const viaEnv = await fromEnv.execute("file_read", { path: "only-a.txt" });
    expect(viaEnv.content).toBe("A");
    delete process.env.BOTANICAL_WORKSPACE_ROOT;

    const bound = createToolRegistry(createFileTools({ workspaceRoot: alpha }));
    const overridden = await bound.execute("file_read", { path: "only-b.txt" }, { workspaceRoot: beta });
    expect(overridden.content).toBe("B");
    const escaped = await bound.execute(
      "file_read",
      { path: "../alpha/only-a.txt" },
      { workspaceRoot: beta },
    );
    expect(escaped.error?.code).toBe("path_escape");
    expect(escaped.content).not.toContain("A");
  });

  test("uses BOTANICAL_WORKSPACE when the root-specific variable is unset", async () => {
    const { root } = await makeWorkspace();
    await writeFile(path.join(root, "env.txt"), "env");
    process.env.BOTANICAL_WORKSPACE = root;
    const registry = createToolRegistry(createFileTools());
    const result = await registry.execute("file_read", { path: "env.txt" });
    expect(result.content).toBe("env");
  });

  test("accepts JSON object strings and rejects unknown parameters", async () => {
    const { root } = await makeWorkspace();
    await writeFile(path.join(root, "a.txt"), "a");
    const registry = registryFor(root);
    const parsed = await registry.execute("file_read", JSON.stringify({ path: "a.txt" }));
    expect(parsed.content).toBe("a");
    const extra = await registry.execute("file_read", { path: "a.txt", extra: true });
    expect(extra.error?.code).toBe("invalid_params");
  });

  test("stops when the abort signal is already aborted", async () => {
    const { root } = await makeWorkspace();
    const registry = registryFor(root);
    const signal = AbortSignal.abort();
    const result = await registry.execute("file_read", { path: "missing.txt" }, { signal, workspaceRoot: root });
    expect(result.error?.code).toBe("aborted");
  });

  test("rejects a workspace root that is missing or not a directory", async () => {
    const { root } = await makeWorkspace();
    const file = path.join(root, "not-a-dir");
    await writeFile(file, "x");
    const missing = createToolRegistry(createFileTools({ workspaceRoot: path.join(root, "nope") }));
    expect((await missing.execute("file_list", { path: "." })).error?.code).toBe("invalid_workspace");
    const notDir = createToolRegistry(createFileTools({ workspaceRoot: file }));
    expect((await notDir.execute("file_list", { path: "." })).error?.code).toBe("invalid_workspace");
    expect(() => createFileTools({ maxListEntries: 0 })).toThrow(/maxListEntries/);
  });
});
