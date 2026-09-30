import { GITHUB_LISTENER_KIND } from "@botanical/core";

import { decideGithubDelivery, GITHUB_DEFAULT_TEMPLATE, verifyGithubSignature } from "../github/webhook.ts";
import { renderListenerPrompt } from "./prompt.ts";
import { verifyWebhook, type WebhookVerification } from "./verify.ts";

/**
 * `kind` selects how an inbound request is authenticated and turned into a prompt:
 * `webhook` (any sender, raw body) or `github` (GitHub-signed, filtered by event, summarized).
 */
export interface ListenerKindHandler {
  kind: string;
  /** Word in the `[<label> · …]` line that opens the turn's user message. */
  label: string;
  verify(input: WebhookVerification): boolean;
  /**
   * Whether a verified delivery starts a turn, and the text the turn sees as its payload.
   * A delivery that does not run is stored as `ignored` with the reason.
   */
  accept(input: {
    headers: Headers;
    body: string;
    events: readonly string[];
  }): { run: true; payload: string } | { run: false; reason: string };
  buildPrompt(input: {
    template: string;
    listenerName: string;
    receivedAt: string;
    payload: string;
  }): string;
}

const webhookHandler: ListenerKindHandler = {
  kind: "webhook",
  label: "Webhook",
  verify: verifyWebhook,
  accept: ({ body }) => ({ run: true, payload: body }),
  buildPrompt: renderListenerPrompt,
};

const githubHandler: ListenerKindHandler = {
  kind: GITHUB_LISTENER_KIND,
  label: "GitHub",
  verify: verifyGithubSignature,
  accept: decideGithubDelivery,
  buildPrompt: (input) => renderListenerPrompt({ ...input, template: input.template.trim() || GITHUB_DEFAULT_TEMPLATE }),
};

const HANDLERS: Record<string, ListenerKindHandler> = {
  webhook: webhookHandler,
  [GITHUB_LISTENER_KIND]: githubHandler,
};

export const LISTENER_KINDS = Object.keys(HANDLERS);

export function listenerHandler(kind: string): ListenerKindHandler | null {
  return HANDLERS[kind] ?? null;
}

export function isListenerKind(kind: string): boolean {
  return kind in HANDLERS;
}
