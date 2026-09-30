import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { contributorFromBuiltins, type ToolContributor } from "@botanical/agent-runtime";
import { canonicalizeWorkspaceRoot, ensureAgentWorkspace, resolveInsideWorkspace, sanitizeAgentId } from "@botanical/tools";

import type { Store } from "../types.ts";
import { parseRepo } from "./api.ts";
import { commitIdentity, githubCredentials } from "./connection.ts";

/**
 * Git tools (capability `git`) for repositories inside an agent's workspace.
 *
 * Git runs on the server, outside the shell jail, so the repository's git directory is kept
 * out of the agent's reach: `<user root>/git/<agent>/<key>.git`, next to `<user root>/agents`,
 * never inside the agent directory. The worktree gets a `.git` file pointing there, which a
 * coding CLI or a person can use as usual. The tools never read that file: they derive the git
 * directory from the worktree path, so an agent that writes `.git`, hooks, or config through the
 * file tools cannot make these tools run its commands. Hooks, fsmonitor, external diff and
 * textconv are off, system and global config are ignored, and only the configured GitHub host's
 * protocol is allowed. The token is passed as an HTTP header in the child's environment, scoped
 * to that host, and is never written to the repository config.
 */

export const GIT_TOOL_NAMES = [
  "git_clone",
  "git_init",
  "git_status",
  "git_diff",
  "git_log",
  "git_checkout",
  "git_commit",
  "git_pull",
  "git_push",
] as const;

const LOCAL_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 180_000;
const OUTPUT_MAX = 40_000;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)(?!.*\/$)[A-Za-z0-9._\/-]{1,200}$/;

const OBJECT = { type: "object", additionalProperties: false } as const;
const DIR = {
  type: "string",
  description: "Repository folder, relative to the agent's workspace (for example `botanical`).",
} as const;

export interface GitToolOptions {
  /** Web and git host, for example `https://github.com`. Tests pass a `file://` root. */
  webUrl: string;
}

interface GitContext {
  agentId: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}

interface Repo {
  /** Absolute worktree path. */
  workTree: string;
  /** Worktree path relative to the agent directory, as the agent names it. */
  relative: string;
  gitDir: string;
}

export function createGitContributor(store: Store, options: GitToolOptions): ToolContributor {
  const webUrl = options.webUrl.replace(/\/+$/, "");

  async function env(agentId: string, withToken: boolean): Promise<Record<string, string>> {
    const credentials = await githubCredentials(store);
    const agent = await store.agents.get(agentId);
    const identity = commitIdentity(agent?.name ?? "", credentials?.account ?? null);
    const config: Array<[string, string]> = [
      ["core.hooksPath", "/dev/null"],
      ["core.fsmonitor", "false"],
      ["core.askPass", ""],
      ["credential.helper", ""],
      ["commit.gpgSign", "false"],
      ["tag.gpgSign", "false"],
      ["protocol.allow", "never"],
      [`protocol.${new URL(webUrl).protocol.replace(/:$/, "")}.allow`, "always"],
      ["user.name", identity.name],
      ["user.email", identity.email],
      ["init.defaultBranch", "main"],
      ["advice.detachedHead", "false"],
    ];
    if (withToken && credentials) {
      const basic = Buffer.from(`x-access-token:${credentials.token}`).toString("base64");
      config.push([`http.${webUrl}/.extraHeader`, `Authorization: Basic ${basic}`]);
    }
    const out: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.TMPDIR ?? "/tmp",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: String(config.length),
    };
    config.forEach(([key, value], index) => {
      out[`GIT_CONFIG_KEY_${index}`] = key;
      out[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    return out;
  }

  async function git(
    ctx: GitContext,
    repo: Repo | null,
    args: string[],
    opts: { network?: boolean; allowFailure?: boolean } = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const base = repo ? ["--git-dir", repo.gitDir, "--work-tree", repo.workTree] : [];
    const result = await run(
      [...base, ...args],
      await env(ctx.agentId, opts.network === true),
      repo?.workTree ?? ctx.workspaceRoot,
      opts.network ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
      ctx.signal,
    );
    if (result.code !== 0 && !opts.allowFailure) {
      const detail = (result.stderr || result.stdout).trim() || `git exited with ${result.code}`;
      throw new Error(hint(detail, opts.network === true, await githubCredentials(store)));
    }
    return result;
  }

  async function agentDir(ctx: GitContext): Promise<string> {
    return ensureAgentWorkspace(ctx.workspaceRoot, ctx.agentId);
  }

  async function locate(ctx: GitContext, dir: unknown, create: boolean): Promise<Repo> {
    if (typeof dir !== "string" || dir.trim() === "") throw new Error("dir is required");
    const root = await agentDir(ctx);
    const resolved = await resolveInsideWorkspace(root, dir.trim(), {
      agentScope: true,
      allowMissing: create,
      allowMissingParents: create,
    });
    const userRoot = await canonicalizeWorkspaceRoot(ctx.workspaceRoot);
    return {
      workTree: resolved.absolute,
      relative: resolved.relative,
      gitDir: gitDirFor(userRoot, ctx.agentId, resolved.relative),
    };
  }

  async function openRepo(ctx: GitContext, dir: unknown): Promise<Repo> {
    const repo = await locate(ctx, dir, false);
    if (!(await isDirectory(repo.gitDir))) {
      throw new Error(
        `${JSON.stringify(repo.relative)} is not a repository these tools manage. Use git_clone or git_init first.`,
      );
    }
    return repo;
  }

  async function currentBranch(ctx: GitContext, repo: Repo): Promise<string> {
    const result = await git(ctx, repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
    const branch = result.stdout.trim();
    if (result.code !== 0 || !branch) throw new Error("HEAD is detached. Use git_checkout to switch to a branch first.");
    return branch;
  }

  async function remoteUrl(ctx: GitContext, repo: Repo): Promise<string | null> {
    const result = await git(ctx, repo, ["remote", "get-url", "origin"], { allowFailure: true });
    return result.code === 0 ? result.stdout.trim() : null;
  }

  async function requireGithubOrigin(ctx: GitContext, repo: Repo): Promise<void> {
    const url = await remoteUrl(ctx, repo);
    if (!url) throw new Error("This repository has no origin. Pass repo to git_init to connect it to GitHub.");
    if (!url.startsWith(`${webUrl}/`)) throw new Error(`origin ${url} is not on ${webUrl}`);
  }

  return contributorFromBuiltins(
    [
      {
        name: "git_clone",
        description:
          "Clone a GitHub repository into the agent's workspace. Uses the connected GitHub account, so private repositories work too. Then edit files with the file tools and use git_commit and git_push.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: { type: "string", description: "owner/name, or its GitHub URL." },
            dir: { type: "string", description: "Target folder in the workspace. Defaults to the repository name." },
            branch: { type: "string", description: "Branch to check out. Defaults to the repository's default branch." },
          },
          required: ["repo"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const source = parseRepo(args.repo, webUrl);
          const dir = typeof args.dir === "string" && args.dir.trim() ? args.dir.trim() : source.name;
          const repo = await locate(ctx, dir, true);
          if (repo.relative === ".") throw new Error("Clone into a folder, not the workspace root.");
          if (!(await isEmptyOrMissing(repo.workTree))) {
            throw new Error(`${JSON.stringify(repo.relative)} already exists and is not empty. Pick another dir.`);
          }
          const branch = optionalBranch(args.branch);
          await rm(repo.gitDir, { recursive: true, force: true });
          await mkdir(path.dirname(repo.gitDir), { recursive: true });
          await git(
            ctx,
            null,
            [
              "clone",
              "--no-recurse-submodules",
              "--separate-git-dir",
              repo.gitDir,
              ...(branch ? ["--branch", branch] : []),
              "--",
              `${webUrl}/${source.owner}/${source.name}.git`,
              repo.workTree,
            ],
            { network: true },
          );
          const head = await git(ctx, repo, ["log", "-1", "--format=%h %s"], { allowFailure: true });
          return {
            dir: repo.relative,
            repo: `${source.owner}/${source.name}`,
            branch: await currentBranch(ctx, repo).catch(() => null),
            head: head.stdout.trim() || null,
          };
        },
      },
      {
        name: "git_init",
        description:
          "Start tracking a workspace folder with git (created if missing), for files the agent made itself. Pass repo (owner/name, an existing GitHub repository) to set it as origin so git_push can publish the files. On a folder that is already a repository, repo sets or replaces origin.",
        parameters: {
          ...OBJECT,
          properties: {
            dir: DIR,
            repo: { type: "string", description: "Optional GitHub repository (owner/name) to use as origin." },
            branch: { type: "string", default: "main" },
          },
          required: ["dir"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await locate(ctx, args.dir, true);
          const origin = args.repo === undefined ? null : parseRepo(args.repo, webUrl);
          const existing = await isDirectory(repo.gitDir);
          if (existing && !origin) throw new Error(`${JSON.stringify(repo.relative)} is already a repository.`);
          if (!existing) {
            const branch = optionalBranch(args.branch) ?? "main";
            await dropStaleGitFile(repo.workTree);
            await mkdir(repo.workTree, { recursive: true });
            await mkdir(path.dirname(repo.gitDir), { recursive: true });
            await git(ctx, null, ["init", "--quiet", "--initial-branch", branch, "--separate-git-dir", repo.gitDir, repo.workTree]);
          }
          if (origin) {
            const url = `${webUrl}/${origin.owner}/${origin.name}.git`;
            const current = await remoteUrl(ctx, repo);
            await git(ctx, repo, current === null ? ["remote", "add", "origin", url] : ["remote", "set-url", "origin", url]);
          }
          return {
            dir: repo.relative,
            created: !existing,
            origin: origin ? `${origin.owner}/${origin.name}` : null,
          };
        },
      },
      {
        name: "git_status",
        description: "Show the branch, its upstream, and changed or untracked files in a repository.",
        parameters: { ...OBJECT, properties: { dir: DIR }, required: ["dir"] },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const repo = await openRepo(ctx, asRecord(raw).dir);
          const status = await git(ctx, repo, ["status", "--short", "--branch", "--untracked-files=all"]);
          const origin = await remoteUrl(ctx, repo);
          return clip(`${status.stdout.trimEnd() || "(clean)"}\norigin: ${origin ?? "(none)"}`);
        },
      },
      {
        name: "git_diff",
        description: "Show uncommitted changes. staged shows what the next commit already holds. path limits it to one file or folder.",
        parameters: {
          ...OBJECT,
          properties: {
            dir: DIR,
            staged: { type: "boolean", default: false },
            path: { type: "string", description: "File or folder inside the repository." },
          },
          required: ["dir"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await openRepo(ctx, args.dir);
          const scope = typeof args.path === "string" && args.path.trim() ? ["--", args.path.trim()] : [];
          const flags = ["--no-color", "--no-ext-diff", "--no-textconv", ...(args.staged === true ? ["--cached"] : [])];
          const stat = await git(ctx, repo, ["diff", ...flags, "--stat", ...scope]);
          const patch = await git(ctx, repo, ["diff", ...flags, ...scope]);
          const body = `${stat.stdout.trimEnd()}\n\n${patch.stdout.trimEnd()}`.trim();
          return clip(body || "No changes. Untracked files do not show here; see git_status.");
        },
      },
      {
        name: "git_log",
        description: "List recent commits on the current branch.",
        parameters: {
          ...OBJECT,
          properties: { dir: DIR, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          required: ["dir"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await openRepo(ctx, args.dir);
          const limit = typeof args.limit === "number" ? Math.min(100, Math.max(1, Math.trunc(args.limit))) : 20;
          const log = await git(
            ctx,
            repo,
            ["log", "--no-color", `--max-count=${limit}`, "--date=short", "--format=%h %ad %an: %s"],
            { allowFailure: true },
          );
          return clip(log.code === 0 ? log.stdout.trimEnd() || "(no commits)" : "(no commits)");
        },
      },
      {
        name: "git_checkout",
        description: "Switch to a branch. create makes a new branch from the current commit.",
        parameters: {
          ...OBJECT,
          properties: { dir: DIR, branch: { type: "string" }, create: { type: "boolean", default: false } },
          required: ["dir", "branch"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await openRepo(ctx, args.dir);
          const branch = requireBranch(args.branch);
          await git(ctx, repo, ["switch", ...(args.create === true ? ["--create"] : []), branch]);
          return { dir: repo.relative, branch };
        },
      },
      {
        name: "git_commit",
        description:
          "Stage changes and commit them. paths limits the commit to those files or folders; by default every change and new file in the repository is committed.",
        parameters: {
          ...OBJECT,
          properties: {
            dir: DIR,
            message: { type: "string" },
            paths: { type: "array", items: { type: "string" }, description: "Files or folders inside the repository." },
          },
          required: ["dir", "message"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await openRepo(ctx, args.dir);
          if (typeof args.message !== "string" || args.message.trim() === "") throw new Error("message is required");
          if (args.message.length > 10_000) throw new Error("message must be at most 10000 characters");
          const paths = Array.isArray(args.paths)
            ? args.paths.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
            : [];
          await git(ctx, repo, ["add", "--all", "--", ...(paths.length > 0 ? paths : ["."])]);
          const staged = await git(ctx, repo, ["diff", "--cached", "--quiet"], { allowFailure: true });
          if (staged.code === 0) return "Nothing to commit.";
          await git(ctx, repo, ["commit", "--quiet", "--no-verify", "--message", args.message.trim()]);
          const summary = await git(ctx, repo, [
            "show",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--stat",
            "--format=%h %s",
            "HEAD",
          ]);
          return clip(summary.stdout.trimEnd());
        },
      },
      {
        name: "git_pull",
        description: "Fetch origin and fast-forward the current branch. It never merges or rebases; a diverged branch is an error.",
        parameters: { ...OBJECT, properties: { dir: DIR }, required: ["dir"] },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const repo = await openRepo(ctx, asRecord(raw).dir);
          await requireGithubOrigin(ctx, repo);
          const branch = await currentBranch(ctx, repo);
          const result = await git(ctx, repo, ["pull", "--ff-only", "--no-rebase", "origin", branch], { network: true });
          return clip((result.stdout + result.stderr).trim() || "Up to date.");
        },
      },
      {
        name: "git_push",
        description:
          "Push a branch (default: the current one) to origin on GitHub and set it as upstream. Never forces. Open a pull request with github_pr_create afterwards.",
        parameters: {
          ...OBJECT,
          properties: { dir: DIR, branch: { type: "string" } },
          required: ["dir"],
        },
        async execute(raw, ctxIn) {
          const ctx = context(ctxIn);
          const args = asRecord(raw);
          const repo = await openRepo(ctx, args.dir);
          await requireGithubOrigin(ctx, repo);
          const branch = args.branch === undefined ? await currentBranch(ctx, repo) : requireBranch(args.branch);
          const result = await git(
            ctx,
            repo,
            ["push", "--set-upstream", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
            { network: true },
          );
          return clip((result.stdout + result.stderr).trim() || `Pushed ${branch}.`);
        },
      },
    ],
    { id: "builtin.git" },
  );
}

/**
 * Git directory for a worktree: `<user root>/git/<agent>/<name>-<hash>.git`. It is derived from
 * the worktree path, never read from the worktree, and is outside the agent directory.
 */
export function gitDirFor(userRoot: string, agentId: string, relative: string): string {
  const name = relative === "." ? "_root" : relative.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  const hash = createHash("sha256").update(relative).digest("hex").slice(0, 12);
  return path.join(userRoot, "git", sanitizeAgentId(agentId), `${name}-${hash}.git`);
}

function context(ctx: { workspaceRoot?: string; agentId?: string; signal?: AbortSignal } | undefined): GitContext {
  if (!ctx?.agentId) throw new Error("git tools run on an agent turn");
  if (!ctx.workspaceRoot) throw new Error("git tools need a workspace");
  return { agentId: ctx.agentId, workspaceRoot: ctx.workspaceRoot, ...(ctx.signal ? { signal: ctx.signal } : {}) };
}

function run(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  timeout: number,
  signal: AbortSignal | undefined,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", ...(signal ? { signal } : {}) },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: unknown }).code !== "number") {
          const code = (error as { code?: unknown }).code;
          if (code === "ENOENT") return reject(new Error("git is not installed on the server"));
          if (error.name === "AbortError") return reject(new Error("git was stopped"));
          if ((error as { killed?: boolean }).killed) return reject(new Error(`git timed out after ${timeout / 1000}s`));
          return reject(error);
        }
        resolve({ code: error ? Number((error as { code?: unknown }).code) : 0, stdout, stderr });
      },
    );
  });
}

function hint(detail: string, network: boolean, credentials: unknown): string {
  const text = redact(detail);
  if (!network) return clip(text);
  if (!credentials && /authentication|could not read username|repository not found|403|401/i.test(text)) {
    return clip(`${text}\nGitHub is not connected for this user. Ask the user to connect GitHub in Settings → GitHub.`);
  }
  return clip(text);
}

/** Never echo an auth header back to the model, even if git prints one. */
function redact(value: string): string {
  return value.replace(/Authorization:\s*\S+\s+\S+/gi, "Authorization: [redacted]").replace(/x-access-token:[^@\s]+/g, "x-access-token:[redacted]");
}

function clip(value: string): string {
  return value.length <= OUTPUT_MAX ? value : `${value.slice(0, OUTPUT_MAX)}\n…[truncated]`;
}

function optionalBranch(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireBranch(value);
}

function requireBranch(value: unknown): string {
  if (typeof value !== "string" || !BRANCH.test(value.trim())) {
    throw new Error("branch must be a plain branch name, for example fix/login-error");
  }
  return value.trim();
}

/**
 * A `.git` file left behind when a managed git directory is gone is removed so `git init` can
 * start over. A real `.git` directory (made by `git init` in a shell or a coding CLI) is refused:
 * `git init --separate-git-dir` would move it, config and hooks included, to where these tools run.
 */
async function dropStaleGitFile(workTree: string): Promise<void> {
  const marker = path.join(workTree, ".git");
  let info;
  try {
    info = await lstat(marker);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    throw new Error(
      "This folder already has its own .git directory from another git. Remove it, or clone or init into a new folder.",
    );
  }
  await rm(marker, { force: true });
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isEmptyOrMissing(target: string): Promise<boolean> {
  try {
    return (await readdir(target)).length === 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
