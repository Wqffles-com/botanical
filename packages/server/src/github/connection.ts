import { GITHUB_ACCOUNT_SETTING_KEY, GITHUB_SECRET_NAME, type GithubAccount } from "@botanical/core";
import { currentUserId } from "@botanical/db";

import type { GithubHosts } from "../config.ts";
import type { Store } from "../types.ts";
import { GithubApiError, githubRequest } from "./api.ts";

/**
 * A user's GitHub connection: an access token in the encrypted `secrets` table (user scope,
 * name `github`) and the account it belongs to in `user_settings` (`github.account`).
 * There is no instance-wide token. Agents act with the token of the user who owns them.
 */

export interface GithubCredentials {
  token: string;
  account: GithubAccount | null;
}

export const NOT_CONNECTED =
  "GitHub is not connected for this user. Ask the user to connect GitHub in Settings → GitHub.";

export async function githubAccount(store: Store, userId: string): Promise<GithubAccount | null> {
  const stored = await store.prefs.getUser(userId, GITHUB_ACCOUNT_SETTING_KEY);
  return readAccount(stored);
}

/** The acting user's token, or null when they have not connected GitHub. */
export async function githubCredentials(store: Store, userId: string | null = currentUserId()): Promise<GithubCredentials | null> {
  if (!userId) return null;
  const token = await store.secrets.revealUser(userId, GITHUB_SECRET_NAME);
  if (!token) return null;
  return { token, account: await githubAccount(store, userId) };
}

export async function requireGithubCredentials(store: Store): Promise<GithubCredentials> {
  const credentials = await githubCredentials(store);
  if (!credentials) throw new Error(NOT_CONNECTED);
  return credentials;
}

interface GithubUserResponse {
  login?: unknown;
  id?: unknown;
  name?: unknown;
  avatar_url?: unknown;
  html_url?: unknown;
}

/** Ask GitHub who the token belongs to. Throws `GithubApiError` when GitHub refuses it. */
export async function verifyGithubToken(hosts: GithubHosts, token: string): Promise<Omit<GithubAccount, "connectedAt">> {
  const { data, headers } = await githubRequest<GithubUserResponse>(hosts, token, "GET", "/user");
  if (typeof data?.login !== "string" || typeof data.id !== "number") {
    throw new GithubApiError(502, "GitHub returned an unexpected response for /user");
  }
  const scopes = (headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    login: data.login,
    id: data.id,
    name: typeof data.name === "string" && data.name ? data.name : null,
    avatarUrl: typeof data.avatar_url === "string" ? data.avatar_url : null,
    htmlUrl: typeof data.html_url === "string" ? data.html_url : null,
    scopes,
  };
}

export async function saveGithubConnection(
  store: Store,
  userId: string,
  token: string,
  account: Omit<GithubAccount, "connectedAt">,
  now: Date,
): Promise<GithubAccount> {
  const saved: GithubAccount = { ...account, connectedAt: now.toISOString() };
  await store.secrets.putUser(userId, GITHUB_SECRET_NAME, token);
  await store.prefs.setUser(userId, GITHUB_ACCOUNT_SETTING_KEY, saved);
  return saved;
}

export async function deleteGithubConnection(store: Store, userId: string): Promise<void> {
  await store.secrets.deleteUser(userId, GITHUB_SECRET_NAME);
  await store.prefs.deleteUser(userId, GITHUB_ACCOUNT_SETTING_KEY);
}

/**
 * Commit identity for an agent. The name is the agent's; the email is the account's
 * GitHub noreply address when connected, so GitHub links the commit to that account.
 */
export function commitIdentity(agentName: string, account: GithubAccount | null): { name: string; email: string } {
  const name = agentName.trim() || "Botanical agent";
  if (account) return { name, email: `${account.id}+${account.login}@users.noreply.github.com` };
  return { name, email: "agent@botanical.invalid" };
}

function readAccount(value: unknown): GithubAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.login !== "string" || typeof row.id !== "number") return null;
  return {
    login: row.login,
    id: row.id,
    name: typeof row.name === "string" ? row.name : null,
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null,
    htmlUrl: typeof row.htmlUrl === "string" ? row.htmlUrl : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
    connectedAt: typeof row.connectedAt === "string" ? row.connectedAt : "",
  };
}
