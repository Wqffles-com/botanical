import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { agents } from '../src/schema/agents.ts';
import * as schema from '../src/schema/index.ts';
import { listenerDeliveries, listeners } from '../src/schema/listeners.ts';
import { users } from '../src/schema/users.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';

describe('0010 github', () => {
  test('gives listeners events, allows ignored deliveries, and grants git and github to Coder and Orchestrator', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    await finishMigrations((script) => client.exec(script));

    const roles = await client.query<{ name: string; caps: string[] }>(
      `select name, array(select jsonb_array_elements_text(permissions->'capabilities')) as caps from roles where builtin order by name`,
    );
    const caps = Object.fromEntries(roles.rows.map((row) => [row.name, row.caps]));
    expect(caps.Coder).toEqual(expect.arrayContaining(['git', 'github']));
    expect(caps.Orchestrator).toEqual(expect.arrayContaining(['git', 'github']));
    expect(caps.Reviewer).not.toContain('git');
    expect(caps.Coder?.filter((cap) => cap === 'git')).toHaveLength(1);

    const [user] = await db.insert(users).values({ displayName: 'Operator' }).returning();
    if (!user) throw new Error('expected user');
    const [agent] = await db.insert(agents).values({ userId: user.id, name: 'Ada', prompt: 'Ada.' }).returning();
    if (!agent) throw new Error('expected agent');
    const [webhook] = await db
      .insert(listeners)
      .values({ userId: user.id, agentId: agent.id, name: 'Hook', kind: 'webhook', profileId: 'grok', secret: 's'.repeat(32) })
      .returning();
    expect(webhook?.events).toEqual([]);
    const [github] = await db
      .insert(listeners)
      .values({
        userId: user.id,
        agentId: agent.id,
        name: 'Issues',
        kind: 'github',
        events: ['issues.opened'],
        profileId: 'grok',
        secret: 's'.repeat(32),
      })
      .returning();
    if (!github) throw new Error('expected listener');
    expect(github.events).toEqual(['issues.opened']);
    const [ignored] = await db
      .insert(listenerDeliveries)
      .values({ listenerId: github.id, status: 'ignored', httpStatus: 202, payloadBytes: 2, error: 'Ignored: ping' })
      .returning();
    expect(ignored?.status).toBe('ignored');
  });
});
