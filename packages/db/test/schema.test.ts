import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { agentMessages } from '../src/schema/agent-messages.ts';
import { agents } from '../src/schema/agents.ts';
import { chats } from '../src/schema/chats.ts';
import { messages } from '../src/schema/messages.ts';
import { modelProfiles } from '../src/schema/model-profiles.ts';
import { secretRefs } from '../src/schema/secret-refs.ts';
import { settings } from '../src/schema/settings.ts';
import { toolAudit } from '../src/schema/tool-audit.ts';
import { usageEvents } from '../src/schema/usage-events.ts';
import { users } from '../src/schema/users.ts';
import * as schema from '../src/schema/index.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';

async function openDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await finishMigrations((script) => client.exec(script));
  return { client, db };
}

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

describe('v0 postgres schema', () => {
  test('stores chats, agents, profiles, and metadata without raw keys', async () => {
    const { client, db } = await openDb();

    const tables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tableNames = tables.rows.map((row) => row.table_name).sort();
    expect(tableNames).toEqual([
      'agent_messages',
      'agents',
      'chats',
      'messages',
      'model_profiles',
      'secret_refs',
      'sessions',
      'settings',
      'tenants',
      'tool_audit',
      'usage_events',
      'users',
    ]);

    const sensitive = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
         and column_name ~* '(secret|api_key|apikey|passcode|token|password)$'`,
    );
    expect(sensitive.rows).toEqual([]);

    const secretColumns = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'secret_refs'`,
    );
    const secretColumnNames = secretColumns.rows.map((row) => row.column_name);
    expect(secretColumnNames).toContain('env_var');
    expect(secretColumnNames).not.toContain('value');

    const [owner] = await db
      .insert(users)
      .values({ displayName: 'Charlie' })
      .returning();
    if (!owner) throw new Error('expected owner');

    const [other] = await db
      .insert(users)
      .values({ displayName: 'Someone else', email: 'other@example.com' })
      .returning();
    if (!other) throw new Error('expected other user');

    const [profile] = await db
      .insert(modelProfiles)
      .values({
        userId: owner.id,
        name: 'grok',
        provider: 'xai',
        model: 'grok-4',
        config: { apiKeyEnv: 'XAI_API_KEY', temperature: 0.2 },
      })
      .returning();
    if (!profile) throw new Error('expected profile');

    await rejects(
      db.insert(modelProfiles).values({
        userId: owner.id,
        name: 'leaky',
        provider: 'openai',
        model: 'gpt-4.1',
        config: { apiKey: 'sk-secret' } as never,
      }),
      /apiKey|raw key|check constraint|model_profiles_config_has_no_raw_key/i,
    );

    const [agent] = await db
      .insert(agents)
      .values({
        userId: owner.id,
        name: 'Gardener',
        description: 'Tends the plots',
        prompt: 'You are a careful gardening agent.',
        tools: [{ name: 'web_search', enabled: true }, { name: 'mcp.fs.read', enabled: true }],
      })
      .returning();
    const [otherAgent] = await db
      .insert(agents)
      .values({
        userId: owner.id,
        name: 'Archivist',
        description: 'Files notes',
        prompt: 'You keep records.',
        tools: [],
      })
      .returning();
    const [foreignAgent] = await db
      .insert(agents)
      .values({
        userId: other.id,
        name: 'Outsider',
        prompt: 'Not this user.',
      })
      .returning();
    if (!agent || !otherAgent || !foreignAgent) throw new Error('expected agents');
    expect(agent.icon).toBe('Bot');
    expect(agent.color).toBe('green');
    expect(agent.defaultProfileId).toBeNull();

    await rejects(
      db.insert(agents).values({ userId: owner.id, name: 'x'.repeat(41), prompt: 'too long' }),
      /agents_name_length|check constraint/i,
    );
    await rejects(
      db.insert(agents).values({ userId: owner.id, name: 'Bad Icon', icon: 'sprout' }),
      /agents_icon_lucide_name|check constraint/i,
    );
    await rejects(
      db.insert(agents).values({
        userId: owner.id,
        name: 'Bad Color',
        color: 'lime' as never,
      }),
      /agent_color|invalid input value|check constraint/i,
    );

    const [chat] = await db
      .insert(chats)
      .values({
        userId: owner.id,
        agentId: agent.id,
        profileId: profile.id,
        title: 'Tomatoes',
      })
      .returning();
    if (!chat) throw new Error('expected chat');

    await rejects(
      db.insert(chats).values({
        userId: owner.id,
        agentId: foreignAgent.id,
        profileId: profile.id,
        title: 'Cross user',
      }),
      /same user/,
    );

    await rejects(
      db.update(chats).set({ agentId: otherAgent.id }).where(eq(chats.id, chat.id)),
      /immutable/,
    );

    const [userMessage] = await db
      .insert(messages)
      .values({ chatId: chat.id, role: 'user', content: 'When do I water?' })
      .returning();
    const [assistantMessage] = await db
      .insert(messages)
      .values({
        chatId: chat.id,
        role: 'assistant',
        content: '',
        profileId: profile.id,
        toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { q: 'tomato watering' } }],
      })
      .returning();
    if (!userMessage || !assistantMessage) throw new Error('expected messages');
    expect(assistantMessage.seq).toBeGreaterThan(userMessage.seq);

    await rejects(
      db.insert(messages).values({ chatId: chat.id, role: 'tool', content: 'no id' }),
      /tool_call_id|messages_tool_role_has_call_id|check constraint/i,
    );

    const [toolMessage] = await db
      .insert(messages)
      .values({
        chatId: chat.id,
        role: 'tool',
        content: 'Water when the top inch is dry.',
        toolCallId: 'call_1',
        name: 'web_search',
      })
      .returning();
    if (!toolMessage) throw new Error('expected tool message');

    const [a2a] = await db
      .insert(agentMessages)
      .values({
        fromAgent: agent.id,
        toAgent: otherAgent.id,
        body: 'Please file the watering note.',
      })
      .returning();
    if (!a2a) throw new Error('expected a2a message');
    expect(a2a.status).toBe('pending');

    await rejects(
      db.insert(agentMessages).values({
        fromAgent: agent.id,
        toAgent: agent.id,
        body: 'Note to self',
      }),
      /check constraint|agent_messages_distinct_ends/i,
    );

    await rejects(
      db.insert(agentMessages).values({
        fromAgent: agent.id,
        toAgent: foreignAgent.id,
        body: 'Cross the fence',
      }),
      /within one user/,
    );

    const [usage] = await db
      .insert(usageEvents)
      .values({
        userId: owner.id,
        chatId: chat.id,
        messageId: assistantMessage.id,
        profileId: profile.id,
        provider: 'xai',
        model: 'grok-4',
        inputTokens: 20,
        outputTokens: 5,
        estimatedCostUsd: '0.000100',
        latencyMs: 40,
      })
      .returning();
    expect(usage?.inputTokens).toBe(20);

    const [audit] = await db
      .insert(toolAudit)
      .values({
        userId: owner.id,
        chatId: chat.id,
        messageId: toolMessage.id,
        agentId: agent.id,
        toolName: 'web_search',
        argsRedacted: { q: 'tomato watering' },
        status: 'ok',
      })
      .returning();
    if (!audit) throw new Error('expected audit row');

    await rejects(
      db.update(toolAudit).set({ status: 'error' }).where(eq(toolAudit.id, audit.id)),
      /append-only/,
    );
    await rejects(db.delete(toolAudit).where(eq(toolAudit.id, audit.id)), /append-only/);

    const settingRows = await db.select().from(settings);
    const mode = settingRows.find((row) => row.key === 'deployment.mode');
    expect(mode?.value).toBe('self_host');
    const passcodeEnv = settingRows.find((row) => row.key === 'auth.passcode_env');
    const passcodeAlias = settingRows.find((row) => row.key === 'auth.passcode_alias_env');
    expect(passcodeEnv?.value).toBe('BOTANICAL_PASSWORD');
    expect(passcodeAlias?.value).toBe('BOTANICAL_PASSCODE');

    await rejects(
      db.insert(settings).values({ key: 'deployment.mode', value: 'hosted' }),
      /self_host or saas/,
    );

    const refs = await db.select().from(secretRefs);
    expect(refs.map((row) => row.envVar).sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'XAI_API_KEY',
    ]);

    const updatedTriggers = await client.query<{ table_name: string }>(
      `select c.table_name
       from information_schema.columns c
       where c.table_schema = 'public'
         and c.column_name = 'updated_at'
         and not exists (
           select 1
           from pg_trigger t
           join pg_class rel on rel.oid = t.tgrelid
           join pg_namespace n on n.oid = rel.relnamespace
           where n.nspname = 'public'
             and rel.relname = c.table_name
             and not t.tgisinternal
             and t.tgname = c.table_name || '_set_updated_at'
         )`,
    );
    expect(updatedTriggers.rows).toEqual([]);

    await finishMigrations((script) => client.exec(script));
    const modes = await db.select().from(settings).where(eq(settings.key, 'deployment.mode'));
    expect(modes).toHaveLength(1);

    await client.close();
  });
});
