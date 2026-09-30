import { contributorFromBuiltins, type ToolContributor } from "@botanical/agent-runtime";
import { GITHUB_AGENT_MARKER } from "@botanical/core";

import type { GithubHosts } from "../config.ts";
import type { Store } from "../types.ts";
import { githubRequest, parseRepo, repoPath } from "./api.ts";
import { requireGithubCredentials } from "./connection.ts";

const OBJECT = { type: "object", additionalProperties: false } as const;
const REPO = { type: "string", description: "Repository as owner/name." } as const;
const NUMBER = { type: "integer", minimum: 1, description: "Issue or pull request number." } as const;
const BODY_MAX = 60_000;
const READ_BODY_MAX = 20_000;
const COMMENTS_MAX = 30;

export const GITHUB_TOOL_NAMES = [
  "github_repo_list",
  "github_issue_list",
  "github_issue_read",
  "github_issue_create",
  "github_issue_update",
  "github_issue_comment",
  "github_pr_list",
  "github_pr_read",
  "github_pr_create",
] as const;

type Json = Record<string, unknown>;

/**
 * GitHub issues and pull requests through the REST API, as the user who owns the agent
 * (capability `github`). Text an agent writes to GitHub carries a hidden marker so a
 * GitHub listener does not wake the agent on its own comment.
 */
export function createGithubContributor(store: Store, hosts: GithubHosts): ToolContributor {
  async function call<T>(method: string, path: string, options: Parameters<typeof githubRequest>[4] = {}): Promise<T> {
    const { token } = await requireGithubCredentials(store);
    return (await githubRequest<T>(hosts, token, method, path, options)).data;
  }
  const repoOf = (args: Json) => parseRepo(args.repo, hosts.webUrl);

  return contributorFromBuiltins(
    [
      {
        name: "github_repo_list",
        description:
          "List GitHub repositories the connected account can access, most recently updated first. Optional query filters by name.",
        parameters: {
          ...OBJECT,
          properties: {
            query: { type: "string", description: "Case-insensitive filter on owner/name." },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
          },
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const limit = clampInt(args.limit, 30, 1, 100);
          const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
          const repos = await call<Json[]>("GET", "/user/repos", {
            query: { sort: "updated", per_page: 100 },
            signal: ctx?.signal,
          });
          return repos
            .map(presentRepo)
            .filter((repo) => !query || repo.fullName.toLowerCase().includes(query))
            .slice(0, limit);
        },
      },
      {
        name: "github_issue_list",
        description:
          "List issues in a GitHub repository. Pull requests are left out unless includePullRequests is true.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: REPO,
            state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
            labels: { type: "array", items: { type: "string" }, description: "Only issues with all of these labels." },
            assignee: { type: "string", description: "A login, `none`, or `*`." },
            includePullRequests: { type: "boolean", default: false },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
          },
          required: ["repo"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const limit = clampInt(args.limit, 30, 1, 100);
          const issues = await call<Json[]>("GET", `${repoPath(repo)}/issues`, {
            query: {
              state: oneOf(args.state, ["open", "closed", "all"], "open"),
              labels: stringList(args.labels).join(",") || undefined,
              assignee: typeof args.assignee === "string" ? args.assignee : undefined,
              per_page: 100,
            },
            signal: ctx?.signal,
          });
          return issues
            .filter((issue) => args.includePullRequests === true || !issue.pull_request)
            .slice(0, limit)
            .map(presentIssueSummary);
        },
      },
      {
        name: "github_issue_read",
        description: "Read one issue or pull request conversation: title, body, labels, state, and the latest comments.",
        parameters: { ...OBJECT, properties: { repo: REPO, number: NUMBER }, required: ["repo", "number"] },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const number = requireNumber(args.number);
          const issue = await call<Json>("GET", `${repoPath(repo)}/issues/${number}`, { signal: ctx?.signal });
          const comments = await call<Json[]>("GET", `${repoPath(repo)}/issues/${number}/comments`, {
            query: { per_page: 100 },
            signal: ctx?.signal,
          });
          return {
            ...presentIssueSummary(issue),
            body: clip(text(issue.body), READ_BODY_MAX),
            comments: comments.slice(-COMMENTS_MAX).map((comment) => ({
              id: comment.id,
              author: login(comment.user),
              createdAt: comment.created_at,
              body: clip(text(comment.body), READ_BODY_MAX),
              url: comment.html_url,
            })),
            commentCount: comments.length,
          };
        },
      },
      {
        name: "github_issue_create",
        description: "Open an issue in a GitHub repository.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: REPO,
            title: { type: "string" },
            body: { type: "string", description: "Markdown." },
            labels: { type: "array", items: { type: "string" } },
            assignees: { type: "array", items: { type: "string" } },
          },
          required: ["repo", "title"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const title = requireText(args.title, "title", 256);
          const issue = await call<Json>("POST", `${repoPath(repo)}/issues`, {
            body: {
              title,
              body: withMarker(optionalText(args.body, "body")),
              ...(Array.isArray(args.labels) ? { labels: stringList(args.labels) } : {}),
              ...(Array.isArray(args.assignees) ? { assignees: stringList(args.assignees) } : {}),
            },
            signal: ctx?.signal,
          });
          return presentIssueSummary(issue);
        },
      },
      {
        name: "github_issue_update",
        description:
          "Change an issue or pull request: title, body, state (open or closed, with a reason), labels, or assignees. Fields you leave out stay as they are. labels and assignees replace the current lists.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: REPO,
            number: NUMBER,
            title: { type: "string" },
            body: { type: "string" },
            state: { type: "string", enum: ["open", "closed"] },
            stateReason: { type: "string", enum: ["completed", "not_planned", "reopened"] },
            labels: { type: "array", items: { type: "string" } },
            assignees: { type: "array", items: { type: "string" } },
          },
          required: ["repo", "number"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const number = requireNumber(args.number);
          const patch: Json = {};
          if (args.title !== undefined) patch.title = requireText(args.title, "title", 256);
          if (args.body !== undefined) patch.body = withMarker(optionalText(args.body, "body"));
          if (args.state !== undefined) patch.state = oneOf(args.state, ["open", "closed"], "open");
          if (args.stateReason !== undefined) {
            patch.state_reason = oneOf(args.stateReason, ["completed", "not_planned", "reopened"], "completed");
          }
          if (Array.isArray(args.labels)) patch.labels = stringList(args.labels);
          if (Array.isArray(args.assignees)) patch.assignees = stringList(args.assignees);
          if (Object.keys(patch).length === 0) throw new Error("Nothing to change. Pass title, body, state, labels, or assignees.");
          const issue = await call<Json>("PATCH", `${repoPath(repo)}/issues/${number}`, { body: patch, signal: ctx?.signal });
          return presentIssueSummary(issue);
        },
      },
      {
        name: "github_issue_comment",
        description: "Comment on an issue or pull request conversation.",
        parameters: {
          ...OBJECT,
          properties: { repo: REPO, number: NUMBER, body: { type: "string", description: "Markdown." } },
          required: ["repo", "number", "body"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const number = requireNumber(args.number);
          const body = requireText(args.body, "body", BODY_MAX);
          const comment = await call<Json>("POST", `${repoPath(repo)}/issues/${number}/comments`, {
            body: { body: withMarker(body) },
            signal: ctx?.signal,
          });
          return { id: comment.id, url: comment.html_url };
        },
      },
      {
        name: "github_pr_list",
        description: "List pull requests in a GitHub repository.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: REPO,
            state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
          },
          required: ["repo"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const pulls = await call<Json[]>("GET", `${repoPath(repo)}/pulls`, {
            query: { state: oneOf(args.state, ["open", "closed", "all"], "open"), per_page: clampInt(args.limit, 30, 1, 100) },
            signal: ctx?.signal,
          });
          return pulls.map(presentPullSummary);
        },
      },
      {
        name: "github_pr_read",
        description:
          "Read a pull request: title, body, branches, merge state, and the files it changes. Use github_issue_read for its comments.",
        parameters: { ...OBJECT, properties: { repo: REPO, number: NUMBER }, required: ["repo", "number"] },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const number = requireNumber(args.number);
          const pull = await call<Json>("GET", `${repoPath(repo)}/pulls/${number}`, { signal: ctx?.signal });
          const files = await call<Json[]>("GET", `${repoPath(repo)}/pulls/${number}/files`, {
            query: { per_page: 100 },
            signal: ctx?.signal,
          });
          return {
            ...presentPullSummary(pull),
            body: clip(text(pull.body), READ_BODY_MAX),
            mergeable: pull.mergeable ?? null,
            mergeableState: pull.mergeable_state ?? null,
            additions: pull.additions,
            deletions: pull.deletions,
            files: files.map((file) => ({
              path: file.filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
            })),
          };
        },
      },
      {
        name: "github_pr_create",
        description:
          "Open a pull request from a pushed branch (head) into base, which defaults to the repository's default branch. Push the branch with git_push first.",
        parameters: {
          ...OBJECT,
          properties: {
            repo: REPO,
            title: { type: "string" },
            head: { type: "string", description: "Branch with the changes. `owner:branch` for a fork." },
            base: { type: "string", description: "Target branch. Defaults to the repository's default branch." },
            body: { type: "string", description: "Markdown. Say `Fixes #123` to close an issue on merge." },
            draft: { type: "boolean", default: false },
          },
          required: ["repo", "title", "head"],
        },
        async execute(raw, ctx) {
          const args = asRecord(raw);
          const repo = repoOf(args);
          const title = requireText(args.title, "title", 256);
          const head = requireText(args.head, "head", 255);
          let base = typeof args.base === "string" ? args.base.trim() : "";
          if (!base) {
            const info = await call<Json>("GET", repoPath(repo), { signal: ctx?.signal });
            base = text(info.default_branch) || "main";
          }
          const pull = await call<Json>("POST", `${repoPath(repo)}/pulls`, {
            body: { title, head, base, body: withMarker(optionalText(args.body, "body")), draft: args.draft === true },
            signal: ctx?.signal,
          });
          return presentPullSummary(pull);
        },
      },
    ],
    { id: "builtin.github" },
  );
}

/** Adds the hidden marker so GitHub listeners skip what an agent wrote. */
export function withMarker(body: string): string {
  if (body.includes(GITHUB_AGENT_MARKER)) return body;
  return body ? `${body}\n\n${GITHUB_AGENT_MARKER}` : GITHUB_AGENT_MARKER;
}

function presentRepo(repo: Json) {
  const permissions = asRecord(repo.permissions);
  return {
    fullName: text(repo.full_name),
    private: repo.private === true,
    defaultBranch: text(repo.default_branch) || "main",
    description: typeof repo.description === "string" ? repo.description : null,
    htmlUrl: text(repo.html_url),
    canPush: permissions.push === true,
    canAdmin: permissions.admin === true,
  };
}

function presentIssueSummary(issue: Json) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
    author: login(issue.user),
    labels: Array.isArray(issue.labels) ? issue.labels.map((label) => text(asRecord(label).name) || text(label)) : [],
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map(login) : [],
    comments: issue.comments,
    isPullRequest: Boolean(issue.pull_request),
    url: issue.html_url,
    updatedAt: issue.updated_at,
  };
}

function presentPullSummary(pull: Json) {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.merged_at ? "merged" : pull.state,
    draft: pull.draft === true,
    author: login(pull.user),
    head: text(asRecord(pull.head).ref),
    base: text(asRecord(pull.base).ref),
    url: pull.html_url,
    updatedAt: pull.updated_at,
  };
}

function login(user: unknown): string | null {
  const record = asRecord(user);
  return typeof record.login === "string" ? record.login : null;
}

function asRecord(value: unknown): Json {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated]`;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  if (value.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > BODY_MAX) throw new Error(`${field} must be at most ${BODY_MAX} characters`);
  return value;
}

function requireNumber(value: unknown): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) {
    throw new Error("number must be a positive integer");
  }
  return number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(`expected one of ${options.join(", ")}`);
  }
  return value as T;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}
