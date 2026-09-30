/**
 * GitHub connection and GitHub listener constants shared by the server and the web app.
 */

/** User secret that holds the GitHub access token. Never returned to the browser. */
export const GITHUB_SECRET_NAME = "github";

/** `user_settings` key with the connected account (login, id, name, avatar, scopes). */
export const GITHUB_ACCOUNT_SETTING_KEY = "github.account";

/** Listener kind for GitHub webhooks. */
export const GITHUB_LISTENER_KIND = "github";

/**
 * Events a GitHub listener can wake its agent on. The id is `<X-GitHub-Event>.<action>`.
 * Anything else GitHub sends is recorded as an ignored delivery.
 */
export const GITHUB_LISTENER_EVENTS = [
  { id: "issues.opened", event: "issues", label: "Issue opened" },
  { id: "issue_comment.created", event: "issue_comment", label: "Comment on an issue or pull request" },
  { id: "pull_request.opened", event: "pull_request", label: "Pull request opened" },
] as const;

export type GithubListenerEvent = (typeof GITHUB_LISTENER_EVENTS)[number]["id"];

export const DEFAULT_GITHUB_LISTENER_EVENTS: readonly GithubListenerEvent[] = ["issues.opened"];

export function isGithubListenerEvent(value: unknown): value is GithubListenerEvent {
  return typeof value === "string" && GITHUB_LISTENER_EVENTS.some((item) => item.id === value);
}

/** GitHub webhook `events` for a set of listener event ids, without duplicates. */
export function githubHookEvents(ids: readonly string[]): string[] {
  const events = new Set<string>();
  for (const item of GITHUB_LISTENER_EVENTS) {
    if (ids.includes(item.id)) events.add(item.event);
  }
  return [...events];
}

/**
 * Hidden marker appended to issues, comments, and pull requests an agent writes through
 * the GitHub tools. A GitHub listener ignores events that carry it, so an agent that
 * comments on an issue does not wake itself again.
 */
export const GITHUB_AGENT_MARKER = "<!-- botanical:agent -->";
