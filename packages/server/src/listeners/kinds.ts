import { renderListenerPrompt } from "./prompt.ts";
import { verifyWebhook, type WebhookVerification } from "./verify.ts";

/**
 * `kind` selects how an inbound request is authenticated and turned into a prompt.
 * Only `webhook` is implemented. Typed forge listeners can register another handler later.
 */
export interface ListenerKindHandler {
  kind: string;
  verify(input: WebhookVerification): boolean;
  buildPrompt(input: {
    template: string;
    listenerName: string;
    receivedAt: string;
    payload: string;
  }): string;
}

const webhookHandler: ListenerKindHandler = {
  kind: "webhook",
  verify: verifyWebhook,
  buildPrompt: renderListenerPrompt,
};

const HANDLERS: Record<string, ListenerKindHandler> = {
  webhook: webhookHandler,
};

export function listenerHandler(kind: string): ListenerKindHandler | null {
  return HANDLERS[kind] ?? null;
}

export function isListenerKind(kind: string): boolean {
  return kind in HANDLERS;
}
