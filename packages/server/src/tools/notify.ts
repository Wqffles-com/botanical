import { contributorFromBuiltins, type ToolContributor } from "@botanical/agent-runtime";

import type { Store } from "../types.ts";

const OBJECT = { type: "object", additionalProperties: false } as const;

/**
 * `notify_user` is a built-in. It is offered only when the agent's allowlist
 * includes it, and when the agent has roles the `notify` capability is required.
 * Dispatch enforces both, the same way as the other built-ins.
 */
export function createNotifyContributor(store: Store): ToolContributor {
  return contributorFromBuiltins(
    [
      {
        name: "notify_user",
        description:
          "Ask the operator for attention. Use this when a person should look at the chat. title is a short label. message is the note they will read.",
        parameters: {
          ...OBJECT,
          properties: {
            title: { type: "string", description: "Short label, up to 200 characters." },
            message: { type: "string", description: "What the operator should know." },
          },
          required: ["title", "message"],
        },
        async execute(args, ctx) {
          const record = asRecord(args);
          if (typeof record.title !== "string" || record.title.trim() === "") return failure("title is required");
          if (typeof record.message !== "string" || record.message.trim() === "") return failure("message is required");
          const title = record.title.trim();
          const message = record.message.trim();
          if (title.length > 200) return failure("title must be at most 200 characters");
          if (message.length > 4_000) return failure("message must be at most 4000 characters");
          try {
            const notification = await store.notifications.create({
              kind: "attention",
              title,
              body: message,
              agentId: ctx?.agentId ?? null,
              chatId: ctx?.chatId ?? null,
            });
            return { id: notification.id, title: notification.title };
          } catch (cause) {
            return failure(cause instanceof Error ? cause.message : "notify_user failed");
          }
        },
      },
    ],
    { id: "builtin.notify" },
  );
}

function failure(message: string): { output: { error: string }; isError: true } {
  return { output: { error: message }, isError: true };
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
