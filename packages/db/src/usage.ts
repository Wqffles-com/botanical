import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';

import { currentUserId } from './actor.ts';
import type { BotanicalDb } from './client.ts';
import { usageEvents } from './schema/usage-events.ts';

export type UsageSource = 'chat' | 'routine' | 'listener' | 'agent_mail';

export interface UsageEventRecord {
  id: string;
  userId: string;
  chatId: string | null;
  agentId: string | null;
  profileId: string | null;
  provider: string;
  model: string;
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface NewUsageEvent {
  chatId?: string | null;
  agentId?: string | null;
  profileId?: string | null;
  provider: string;
  model: string;
  source: UsageSource;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageQuery {
  /** Inclusive lower bound on `createdAt` (ISO). */
  since?: string;
  /** Exclusive upper bound on `createdAt` (ISO). */
  until?: string;
  /** Every user's events. Callers check admin first. Default: the acting user. */
  allUsers?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 100_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Postgres repository for per-call token usage. Daily and per-agent totals are computed by the caller. */
export function createUsage(db: BotanicalDb, legacyUserId: string) {
  return {
    async record(input: NewUsageEvent): Promise<void> {
      await db.insert(usageEvents).values({
        userId: currentUserId() ?? legacyUserId,
        chatId: input.chatId && isUuid(input.chatId) ? input.chatId : null,
        agentId: input.agentId && isUuid(input.agentId) ? input.agentId : null,
        profileRef: input.profileId ?? null,
        source: input.source,
        provider: input.provider,
        model: input.model,
        inputTokens: Math.max(0, Math.floor(input.inputTokens)),
        outputTokens: Math.max(0, Math.floor(input.outputTokens)),
      });
    },
    async list(query: UsageQuery = {}): Promise<UsageEventRecord[]> {
      const filters: Array<SQL | undefined> = [
        query.allUsers ? undefined : eq(usageEvents.userId, currentUserId() ?? legacyUserId),
        query.since ? gte(usageEvents.createdAt, new Date(query.since)) : undefined,
        query.until ? lt(usageEvents.createdAt, new Date(query.until)) : undefined,
      ];
      const rows = await db
        .select()
        .from(usageEvents)
        .where(and(...filters))
        .orderBy(desc(usageEvents.createdAt), desc(usageEvents.id))
        .limit(Math.max(1, Math.min(query.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT)));
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        chatId: row.chatId,
        agentId: row.agentId,
        profileId: row.profileRef,
        provider: row.provider,
        model: row.model,
        source: row.source as UsageSource,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  };
}

export type Usage = ReturnType<typeof createUsage>;
