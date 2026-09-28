/**
 * Check that docs/index covers every workspace package and that backticked
 * repo paths and relative links in the index (and AGENTS.md) exist.
 *
 * No dependencies. Run from the repo root: bun scripts/check-index.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "..");

/**
 * packages/<directory> -> docs/index file.
 * Every other package directory maps to <name>.md.
 */
const PACKAGE_INDEX: Record<string, string> = {
  tools: "tools.md",
  "tools-shell": "tools.md",
  "tools-web": "tools.md",
};

const TOP_LEVEL_PREFIXES = ["packages/", "docs/", "scripts/", "deploy/", "config/", ".github/"];

type Problem = { file: string; line: number; message: string };

const problems: Problem[] = [];
let pathRefs = 0;
let linkRefs = 0;

function repoPath(abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

function insideRoot(abs: string): boolean {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(".."));
}

function existsInRepo(span: string): boolean {
  const abs = resolve(root, span);
  if (!insideRoot(abs)) return false;
  return existsSync(abs);
}

/** Drop a trailing slash, a trailing :line, and a trailing #anchor. */
function normalizeSpan(raw: string): string | null {
  let span = raw.trim();
  if (span.endsWith("/")) span = span.slice(0, -1);
  span = span.replace(/:\d+$/, "");
  span = span.replace(/#[^#]*$/, "");
  if (span.endsWith("/")) span = span.slice(0, -1);
  if (!span) return null;
  if (/[\s*<{$:]/.test(span)) return null;
  return span;
}

function isRepoPath(span: string): boolean {
  if (TOP_LEVEL_PREFIXES.some((prefix) => span.startsWith(prefix))) return true;
  if (span.includes("/")) return false;
  const abs = join(root, span);
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function checkPackages(): number {
  const packagesDir = join(root, "packages");
  const names = readdirSync(packagesDir).filter((name) => {
    try {
      return statSync(join(packagesDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
  for (const name of names) {
    const file = PACKAGE_INDEX[name] ?? `${name}.md`;
    const indexFile = join(root, "docs", "index", file);
    if (!existsSync(indexFile)) {
      problems.push({
        file: "packages/" + name,
        line: 1,
        message: `missing docs/index/${file}`,
      });
    }
  }
  return names.length;
}

function markdownFiles(): string[] {
  const dir = join(root, "docs", "index");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(dir, name));
  files.push(join(root, "AGENTS.md"));
  return files;
}

function checkFile(abs: string): void {
  const text = readFileSync(abs, "utf8");
  const lines = text.split(/\n/);
  const display = repoPath(abs);
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const span = normalizeSpan(match[1] ?? "");
      if (!span || !isRepoPath(span)) continue;
      pathRefs += 1;
      if (!existsInRepo(span)) {
        problems.push({
          file: display,
          line: lineNo,
          message: `missing path ${span}`,
        });
      }
    }
    for (const match of line.matchAll(/\[(?:[^\]\\]|\\.)*\]\((<[^>]+>|[^)\s]+)\)/g)) {
      const raw = match[1] ?? "";
      const target = linkTarget(raw);
      if (target === null) continue;
      linkRefs += 1;
      const resolved = resolve(dirname(abs), target);
      if (!insideRoot(resolved) || !existsSync(resolved)) {
        problems.push({
          file: display,
          line: lineNo,
          message: `broken link ${raw}`,
        });
      }
    }
  });
}

/** Ignore http(s) and pure anchors. Return a path relative to the markdown file. */
function linkTarget(raw: string): string | null {
  let url = raw.trim();
  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
  if (!url || url.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  const cut = url.split("#")[0]?.split("?")[0] ?? "";
  if (!cut) return null;
  try {
    return decodeURIComponent(cut);
  } catch {
    return cut;
  }
}

function main(): void {
  const indexDir = join(root, "docs", "index");
  if (!existsSync(indexDir)) {
    console.error("missing directory docs/index");
    process.exit(1);
  }
  const packageCount = checkPackages();
  for (const file of markdownFiles()) {
    if (!existsSync(file)) {
      problems.push({ file: repoPath(file), line: 1, message: "missing file" });
      continue;
    }
    checkFile(file);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`${problem.file}:${problem.line}: ${problem.message}`);
    }
  }
  const status = problems.length === 0 ? "ok" : `${problems.length} problem(s)`;
  console.log(
    `check-index: ${packageCount} packages, ${pathRefs} paths, ${linkRefs} links, ${status}`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

main();
