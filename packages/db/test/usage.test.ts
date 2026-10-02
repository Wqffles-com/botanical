import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { runAsUser } from '../src/actor.ts';
import type { BotanicalDb } from '../src/client.ts';
import { agents } from '../src/schema/agents.ts';
import * as schema from '../src/schema/index.ts';
import { users } from '../src/schema/users.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';
import { createUsage } from '../src/usage.ts';

async function openDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await finishMigrations((script) => client.exec(script));
  return db;
}

describe('usage repository', () => {
  test('records calls per user and lists them by window', async () => {
    const db = await openDb();
    const [ann] = await db.insert(users).values({ displayName: 'Ann', email: 'ann@example.com' }).returning();
    const [bob] = await db.insert(users).values({ displayName: 'Bob', email: 'bob@example.com' }).returning();
    if (!ann || !bob) throw new Error('expected users');
    const [agent] = await db
      .insert(agents)
      .values({ userId: ann.id, name: 'Gardener', description: 'x', prompt: 'x', tools: [] })
      .returning();
    if (!agent) throw new Error('expected agent');

    const usage = createUsage(db as unknown as BotanicalDb, ann.id);
    await runAsUser(ann.id, () =>
      usage.record({
        agentId: agent.id,
        profileId: 'grok',
        provider: 'xai',
        model: 'grok-4',
        source: 'routine',
        inputTokens: 120,
        outputTokens: 30,
      }),
    );
    await runAsUser(bob.id, () =>
      usage.record({ chatId: 'not-a-uuid', provider: 'xai', model: 'grok-4', source: 'chat', inputTokens: 5, outputTokens: 1 }),
    );

    const mine = await runAsUser(ann.id, () => usage.list());
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      userId: ann.id,
      agentId: agent.id,
      profileId: 'grok',
      source: 'routine',
      inputTokens: 120,
      outputTokens: 30,
    });

    const everyone = await runAsUser(ann.id, () => usage.list({ allUsers: true }));
    expect(everyone).toHaveLength(2);
    expect(everyone.find((row) => row.userId === bob.id)?.chatId).toBeNull();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await runAsUser(ann.id, () => usage.list({ allUsers: true, since: future }))).toHaveLength(0);
    expect(await runAsUser(ann.id, () => usage.list({ allUsers: true, until: future }))).toHaveLength(2);
  });

  test('rejects an unknown source', async () => {
    const db = await openDb();
    const [ann] = await db.insert(users).values({ displayName: 'Ann', email: 'ann@example.com' }).returning();
    if (!ann) throw new Error('expected user');
    const usage = createUsage(db as unknown as BotanicalDb, ann.id);
    await expect(
      runAsUser(ann.id, () =>
        usage.record({ provider: 'xai', model: 'm', source: 'bogus' as never, inputTokens: 1, outputTokens: 1 }),
      ),
    ).rejects.toThrow();
  });
});
