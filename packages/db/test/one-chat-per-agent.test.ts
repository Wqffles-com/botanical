import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { agents } from '../src/schema/agents.ts';
import { chats } from '../src/schema/chats.ts';
import * as schema from '../src/schema/index.ts';
import { messages } from '../src/schema/messages.ts';
import { modelProfiles } from '../src/schema/model-profiles.ts';
import { notifications } from '../src/schema/notifications.ts';
import { users } from '../src/schema/users.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';

/** Drizzle builders are thenable but not Promises, so `expect().rejects` never awaits them. */
async function rejects(query: PromiseLike<unknown>, pattern: RegExp) {
  try {
    await query;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    expect(`${message}\n${cause}`).toMatch(pattern);
    return;
  }
  throw new Error(`expected query to fail matching ${pattern}`);
}

describe('one chat per agent', () => {
  test('0009 keeps the most recently active chat of each agent and then enforces one', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    await finishMigrations((script) => client.exec(script));

    const [user] = await db.insert(users).values({ displayName: 'Operator' }).returning();
    if (!user) throw new Error('expected user');
    const [profile] = await db
      .insert(modelProfiles)
      .values({ userId: user.id, name: 'grok', provider: 'xai', model: 'grok-4', config: {} })
      .returning();
    const [ada, bo] = await db
      .insert(agents)
      .values([
        { userId: user.id, name: 'Ada', prompt: 'Ada.' },
        { userId: user.id, name: 'Bo', prompt: 'Bo.' },
      ])
      .returning();
    if (!profile || !ada || !bo) throw new Error('expected rows');

    // An install from before 0009: several one-agent chats per agent.
    await client.exec('DROP INDEX chats_agent_direct_uidx');
    const at = (iso: string) => new Date(iso);
    const base = { userId: user.id, profileId: profile.id };
    const [older, newest, oldest, group] = await db
      .insert(chats)
      .values([
        { ...base, agentId: ada.id, title: 'Older', updatedAt: at('2026-09-02T00:00:00Z') },
        { ...base, agentId: ada.id, title: 'Newest', updatedAt: at('2026-09-03T00:00:00Z') },
        { ...base, agentId: ada.id, title: 'Oldest', updatedAt: at('2026-09-01T00:00:00Z') },
        { ...base, agentId: ada.id, memberIds: [bo.id], title: 'Group', updatedAt: at('2026-08-01T00:00:00Z') },
      ])
      .returning();
    if (!older || !newest || !oldest || !group) throw new Error('expected chats');
    await db.insert(messages).values({ chatId: older.id, role: 'user', content: 'Gone soon' });
    const [note] = await db
      .insert(notifications)
      .values({ userId: user.id, kind: 'run_succeeded', title: 'Done', body: '', chatId: older.id })
      .returning();
    if (!note) throw new Error('expected notification');

    await client.exec(readFileSync(join(migrationsFolder(), '0009_one_chat_per_agent.sql'), 'utf8'));

    const left = await db.select({ id: chats.id }).from(chats);
    expect(left.map((row) => row.id).sort()).toEqual([newest.id, group.id].sort());
    expect(await db.select().from(messages).where(eq(messages.chatId, older.id))).toEqual([]);
    const [kept] = await db.select().from(notifications).where(eq(notifications.id, note.id));
    expect(kept?.chatId).toBeNull();

    // From now on: one own chat per agent, any number of group chats, and no switching kinds.
    await rejects(db.insert(chats).values({ ...base, agentId: ada.id, title: 'Another' }), /chats_agent_direct_uidx|duplicate key/);
    await db.insert(chats).values({ ...base, agentId: ada.id, memberIds: [bo.id], title: 'Second group' });
    await rejects(
      db.update(chats).set({ memberIds: [bo.id] }).where(eq(chats.id, newest.id)),
      /cannot switch/,
    );
    await rejects(db.update(chats).set({ memberIds: [] }).where(eq(chats.id, group.id)), /cannot switch/);

    await client.close();
  });
});
