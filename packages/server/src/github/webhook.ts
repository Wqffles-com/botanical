import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { GITHUB_AGENT_MARKER } from "@botanical/core";

/**
 * GitHub webhook deliveries for `kind: "github"` listeners. GitHub signs every delivery with
 * the listener secret (`X-Hub-Signature-256`); nothing else authenticates. A delivery becomes a
 * turn only when its `<event>.<action>` is one of the listener's events and it was not written
 * by an agent through the GitHub tools (the hidden marker). The turn gets a short summary, not
 * the raw payload.
 */

const BODY_MAX = 8_000;

export type GithubDecision = { run: true; payload: string } | { run: false; reason: string };

export function verifyGithubSignature(input: { headers: Headers; rawBody: Uint8Array; secret: string }): boolean {
  const header = input.headers.get("x-hub-signature-256")?.trim() ?? "";
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header);
  if (!match?.[1]) return false;
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  const a = createHash("sha256").update(match[1].toLowerCase()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function decideGithubDelivery(input: { headers: Headers; body: string; events: readonly string[] }): GithubDecision {
  const event = input.headers.get("x-github-event")?.trim() ?? "";
  if (!event) return { run: false, reason: "Ignored: no X-GitHub-Event header" };
  if (event === "ping") return { run: false, reason: "Ignored: ping" };
  const payload = parsePayload(input.body);
  if (!payload) return { run: false, reason: `Ignored: ${event} body is not JSON` };
  const action = typeof payload.action === "string" ? payload.action : "";
  const id = action ? `${event}.${action}` : event;
  if (!input.events.includes(id)) return { run: false, reason: `Ignored: ${id} is not one of this listener's events` };
  // The body this event is about: a comment on an issue an agent opened still wakes the agent.
  const subject = event === "issue_comment" ? payload.comment : event === "pull_request" ? payload.pull_request : payload.issue;
  const authored = record(subject).body;
  if (typeof authored === "string" && authored.includes(GITHUB_AGENT_MARKER)) {
    return { run: false, reason: `Ignored: ${id} was written by a Botanical agent` };
  }
  return { run: true, payload: summarize(id, payload) };
}

export const GITHUB_DEFAULT_TEMPLATE = `A GitHub event arrived for listener "{{listener}}" at {{received_at}}. Use your GitHub and git tools to look into it and act on it if you have them.

{{payload}}`;

/** Text summary of the event. It goes inside the untrusted-data frame. */
export function summarize(id: string, payload: Record<string, unknown>): string {
  const repo = text(record(payload.repository).full_name) || "(unknown repository)";
  const sender = text(record(payload.sender).login);
  const lines = [`Event: ${id}`, `Repository: ${repo}`];
  if (sender) lines.push(`Sender: ${sender}`);
  const issue = record(payload.issue);
  const pull = record(payload.pull_request);
  const comment = record(payload.comment);
  if (id.startsWith("pull_request.")) {
    lines.push(
      `Pull request #${text(pull.number)}: ${text(pull.title)}`,
      `URL: ${text(pull.html_url)}`,
      `Author: ${text(record(pull.user).login)}`,
      `Branches: ${text(record(pull.head).ref)} → ${text(record(pull.base).ref)}`,
    );
    pushLabels(lines, pull.labels);
    lines.push("", "Body:", clip(text(pull.body)) || "(empty)");
  } else if (Object.keys(issue).length > 0) {
    const kind = issue.pull_request ? "Pull request" : "Issue";
    lines.push(
      `${kind} #${text(issue.number)}: ${text(issue.title)}`,
      `URL: ${text(issue.html_url)}`,
      `Author: ${text(record(issue.user).login)}`,
    );
    pushLabels(lines, issue.labels);
    if (Object.keys(comment).length > 0) {
      lines.push(
        "",
        `Comment by ${text(record(comment.user).login)}: ${text(comment.html_url)}`,
        clip(text(comment.body)) || "(empty)",
      );
    } else {
      lines.push("", "Body:", clip(text(issue.body)) || "(empty)");
    }
  }
  return lines.join("\n");
}

function pushLabels(lines: string[], labels: unknown): void {
  if (!Array.isArray(labels) || labels.length === 0) return;
  lines.push(`Labels: ${labels.map((label) => text(record(label).name)).filter(Boolean).join(", ")}`);
}

/** GitHub sends JSON, or `payload=<json>` when the hook's content type is form. */
function parsePayload(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  let source = trimmed;
  if (trimmed.startsWith("payload=")) source = new URLSearchParams(trimmed).get("payload") ?? "";
  try {
    const parsed = JSON.parse(source) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= BODY_MAX ? trimmed : `${trimmed.slice(0, BODY_MAX)}\n…[truncated]`;
}
