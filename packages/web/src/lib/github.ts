import { GITHUB_LISTENER_EVENTS, GITHUB_LISTENER_KIND, type Listener } from "@botanical/core";

/** Where a person makes a token on this GitHub host. */
export function tokenSettingsUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, "")}/settings/tokens`;
}

export function githubEventLabel(id: string): string {
  return GITHUB_LISTENER_EVENTS.find((event) => event.id === id)?.label ?? id;
}

/** `GitHub · Issue opened, Pull request opened`, or `Webhook`. */
export function listenerKindLabel(listener: Pick<Listener, "kind" | "events">): string {
  if (listener.kind !== GITHUB_LISTENER_KIND) return "Webhook";
  const events = listener.events.map(githubEventLabel);
  return events.length > 0 ? `GitHub · ${events.join(", ")}` : "GitHub";
}

/** Adds or removes one event and keeps the order of `GITHUB_LISTENER_EVENTS`. */
export function toggleGithubEvent(events: readonly string[], id: string): string[] {
  const next = new Set(events);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return GITHUB_LISTENER_EVENTS.map((event) => event.id).filter((item) => next.has(item));
}
