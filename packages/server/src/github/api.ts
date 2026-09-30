import type { GithubHosts } from "../config.ts";

const API_VERSION = "2022-11-28";
const USER_AGENT = "Botanical";
const DEFAULT_TIMEOUT_MS = 30_000;

/** A GitHub REST call that did not return 2xx. `message` is GitHub's own text when it sent one. */
export class GithubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export interface GithubResponse<T> {
  data: T;
  headers: Headers;
}

/**
 * One call to the GitHub REST API with the user's token. The token goes only to
 * `hosts.apiUrl`, never into a URL, and is not logged.
 */
export async function githubRequest<T>(
  hosts: GithubHosts,
  token: string,
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | undefined>; signal?: AbortSignal } = {},
): Promise<GithubResponse<T>> {
  const url = new URL(`${hosts.apiUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": USER_AGENT,
        "x-github-api-version": API_VERSION,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new GithubApiError(502, `GitHub ${reason}`);
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) throw new GithubApiError(response.status, errorText(response.status, data));
  return { data: data as T, headers: response.headers };
}

function errorText(status: number, data: unknown): string {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const message = typeof record.message === "string" ? record.message : `HTTP ${status}`;
  const details = Array.isArray(record.errors)
    ? record.errors
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const entry = item as Record<string, unknown>;
            if (typeof entry.message === "string") return entry.message;
            if (typeof entry.code === "string") return [entry.field, entry.code].filter(Boolean).join(" ");
          }
          return "";
        })
        .filter(Boolean)
    : [];
  const text = details.length > 0 ? `${message}: ${details.join("; ")}` : message;
  if (status === 401) return `GitHub rejected the token (${text}). Reconnect GitHub in Settings.`;
  if (status === 403 || status === 404) {
    return `GitHub ${status}: ${text}. The token may lack access to this repository or the scope for this action.`;
  }
  return `GitHub ${status}: ${text}`;
}

/** `owner/name` from `owner/name`, `owner/name.git`, or a URL on the configured web host. */
export function parseRepo(value: unknown, webUrl: string): { owner: string; name: string } {
  if (typeof value !== "string" || value.trim() === "") throw new Error("repo is required, for example owner/name");
  let text = value.trim();
  const base = `${webUrl}/`;
  if (text.startsWith(base)) text = text.slice(base.length);
  text = text.replace(/\.git$/, "").replace(/\/+$/, "");
  const parts = text.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !owner || !name || !REPO_PART.test(owner) || !REPO_PART.test(name) || /^\.+$/.test(owner) || /^\.+$/.test(name)) {
    throw new Error(`repo must look like owner/name (got ${JSON.stringify(value.trim().slice(0, 120))})`);
  }
  return { owner, name };
}

const REPO_PART = /^[A-Za-z0-9_.-]{1,100}$/;

export function repoPath(repo: { owner: string; name: string }): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}
