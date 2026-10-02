import { randomUUID } from "node:crypto";

import { currentUserId } from "@botanical/db";

import type { UsageEvent, UsageRepository } from "../types.ts";

/** In-memory usage log. Without a user scope, rows belong to the single memory operator. */
export function createMemoryUsage(operatorId: string, now: () => Date = () => new Date()): UsageRepository {
  const events: UsageEvent[] = [];
  return {
    async record(input) {
      events.push({
        id: randomUUID(),
        userId: currentUserId() ?? operatorId,
        chatId: input.chatId ?? null,
        agentId: input.agentId ?? null,
        profileId: input.profileId ?? null,
        provider: input.provider,
        model: input.model,
        source: input.source,
        inputTokens: Math.max(0, Math.floor(input.inputTokens)),
        outputTokens: Math.max(0, Math.floor(input.outputTokens)),
        createdAt: now().toISOString(),
      });
    },
    async list(query = {}) {
      const actor = currentUserId() ?? operatorId;
      return events
        .filter((event) => query.allUsers || event.userId === actor)
        .filter((event) => (query.since ? event.createdAt >= query.since : true))
        .filter((event) => (query.until ? event.createdAt < query.until : true))
        .map((event) => ({ ...event }));
    },
  };
}
