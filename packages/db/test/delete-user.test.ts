import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { createAccountServices } from '../src/accounts.ts';
import type { BotanicalDb } from '../src/client.ts';
import * as schema from '../src/schema/index.ts';
import { agents } from '../src/schema/agents.ts';
import { chats } from '../src/schema/chats.ts';
import { messages } from '../src/schema/messages.ts';
import { modelProfiles } from '../src/schema/model-profiles.ts';
import { toolAudit } from '../src/schema/tool-audit.ts';
import { users } from '../src/schema/users.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';

async function openDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await finishMigrations((script) => client.exec(script));
  const { accounts } = createAccountServices(db as unknown as BotanicalDb, {
    legacyUserId: '00000000-0000-0000-0000-000000000000',
  });
  return { db, accounts };
}

async function seedUser(db: Awaited<ReturnType<typeof openDb>>['db'], email: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: email, email, passwordHash: 'hash' })
    .returning();
  const [agent] = await db.insert(agents).values({ userId: user!.id, name: 'Gardener', prompt: 'Tend.' }).returning();
  const [profile] = await db
    .insert(modelProfiles)
    .values({ userId: user!.id, name: 'grok', provider: 'xai', model: 'grok-4', config: { apiKeyEnv: 'XAI_API_KEY' } })
    .returning();
  const [chat] = await db
    .insert(chats)
    .values({ userId: user!.id, agentId: agent!.id, profileId: profile!.id, title: 'Tomatoes' })
    .returning();
  const [message] = await db.insert(messages).values({ chatId: chat!.id, role: 'user', content: 'hi' }).returning();
  return { user: user!, agent: agent!, chat: chat!, message: message! };
}

describe('deleteUser', () => {
  test('removes the account with its agents, chats, and messages', async () => {
    const { db, accounts } = await openDb();
    const gone = await seedUser(db, 'gone@example.com');
    const kept = await seedUser(db, 'kept@example.com');

    expect(await accounts.deleteUser(gone.user.id)).toBe('deleted');
    expect(await db.select().from(users).where(eq(users.id, gone.user.id))).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.userId, gone.user.id))).toHaveLength(0);
    expect(await db.select().from(chats).where(eq(chats.userId, gone.user.id))).toHaveLength(0);
    expect(await db.select().from(messages).where(eq(messages.chatId, gone.chat.id))).toHaveLength(0);
    expect(await db.select().from(agents).where(eq(agents.userId, kept.user.id))).toHaveLength(1);
    expect(await accounts.deleteUser(gone.user.id)).toBe('missing');
  });

  test('refuses and changes nothing when the tool log references the account', async () => {
    const { db, accounts } = await openDb();
    const seeded = await seedUser(db, 'pinned@example.com');
    await db.insert(toolAudit).values({
      userId: seeded.user.id,
      chatId: seeded.chat.id,
      messageId: seeded.message.id,
      agentId: seeded.agent.id,
      toolName: 'read_file',
      status: 'ok',
    });

    expect(await accounts.deleteUser(seeded.user.id)).toBe('pinned');
    expect(await db.select().from(users).where(eq(users.id, seeded.user.id))).toHaveLength(1);
    expect(await db.select().from(chats).where(eq(chats.userId, seeded.user.id))).toHaveLength(1);
    expect(await db.select().from(agents).where(eq(agents.userId, seeded.user.id))).toHaveLength(1);
  });
});
