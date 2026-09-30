import { describe, expect, test } from "bun:test";

import { listenerKindLabel, tokenSettingsUrl, toggleGithubEvent } from "./github";

describe("github helpers", () => {
  test("labels listeners by kind and events", () => {
    expect(listenerKindLabel({ kind: "webhook", events: [] })).toBe("Webhook");
    expect(listenerKindLabel({ kind: "github", events: ["issues.opened", "pull_request.opened"] })).toBe(
      "GitHub · Issue opened, Pull request opened",
    );
  });

  test("toggles events in a stable order", () => {
    expect(toggleGithubEvent(["pull_request.opened"], "issues.opened")).toEqual(["issues.opened", "pull_request.opened"]);
    expect(toggleGithubEvent(["issues.opened", "pull_request.opened"], "issues.opened")).toEqual(["pull_request.opened"]);
  });

  test("points at the token page of the configured host", () => {
    expect(tokenSettingsUrl("https://github.example.com/")).toBe("https://github.example.com/settings/tokens");
  });
});
