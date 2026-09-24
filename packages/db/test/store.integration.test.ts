import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { createDb } from '../src/client.ts';
import { modelProfiles } from '../src/schema/model-profiles.ts';
import { createStore } from '../src/store.ts';

const baseUrl = process.env.BOTANICAL_TEST_DATABASE_URL;
const integration = baseUrl ? test : test.skip;

function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Migrate, then drop operator rows so a rerun does not see the previous test's agents. */
async function emptyOperatorData(connectionString: string): Promise<void> {
  const ready = await createStore({ connectionString });
  await ready.close();
  const handle = createDb(connectionString);
  try {
    await handle.client.unsafe('truncate table users, sessions restart identity cascade');
  } finally {
    await handle.close();
  }
}

describe('postgres store', () => {
  integration(
    'migrates on open and round-trips agents, chats, tool calls, profiles, agent messages, and sessions',
    async () => {
      if (!baseUrl) throw new Error('BOTANICAL_TEST_DATABASE_URL is required');
      const connectionString = withDatabase(baseUrl, 'botanical_m11_store');
      await emptyOperatorData(connectionString);
      const store = await createStore({ connectionString });
      try {
        const profile = await store.profiles.upsert({
          id: 'grok',
          name: 'Grok',
          provider: 'xai',
          model: 'grok-4',
          baseUrl: 'https://api.x.ai/v1',
        });
        expect(profile).toEqual({
          id: 'grok',
          name: 'Grok',
          provider: 'xai',
          model: 'grok-4',
          baseUrl: 'https://api.x.ai/v1',
        });

        await store.profiles.upsert({
          id: 'leaky',
          name: 'Leaky',
          provider: 'openai',
          model: 'gpt-4.1',
          ...({ apiKey: 'sk-secret' } as object),
        } as never);
        const handle = createDb(connectionString);
        try {
          const rows = await handle.db.select().from(modelProfiles).where(eq(modelProfiles.publicId, 'leaky'));
          expect(JSON.stringify(rows[0]?.config ?? {})).not.toMatch(/sk-secret|apiKey/);
        } finally {
          await handle.close();
        }

        const gardener = await store.agents.create({
          name: 'Gardener',
          icon: 'Sprout',
          color: 'teal',
          description: 'Tends the plots',
          systemPrompt: 'You keep the garden.',
          toolIds: ['web_search'],
          defaultProfileId: 'grok',
        });
        expect(gardener).toMatchObject({
          icon: 'Sprout',
          color: 'teal',
          defaultProfileId: 'grok',
          toolIds: ['web_search'],
          systemPrompt: 'You keep the garden.',
        });

        const archivist = await store.agents.create({
          name: 'Archivist',
          description: '',
          systemPrompt: 'You file notes.',
          toolIds: [],
        });
        expect(archivist.icon).toBe('Bot');
        expect(archivist.color).toBe('green');

        const chat = await store.chats.create({
          agentId: gardener.id,
          profileId: 'grok',
          title: 'Tomatoes',
        });
        expect(chat.profileId).toBe('grok');
        expect(await store.chats.countByAgent(gardener.id)).toBe(1);

        const assistant = await store.messages.create({
          chatId: chat.id,
          role: 'assistant',
          content: '',
          profileId: 'grok',
          toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { q: 'tomato watering' } }],
        });
        const tool = await store.messages.create({
          chatId: chat.id,
          role: 'tool',
          content: 'Water when the top inch is dry.',
          toolCallId: 'call_1',
          name: 'web_search',
        });
        expect(assistant.toolCalls?.[0]?.arguments).toEqual({ q: 'tomato watering' });
        expect(tool.toolCallId).toBe('call_1');
        await expect(
          store.messages.create({ chatId: chat.id, role: 'tool', content: 'no id' }),
        ).rejects.toThrow(/toolCallId/);

        const mail = await store.agentMessages.create({
          fromAgentId: gardener.id,
          toAgentId: archivist.id,
          body: 'Please file the watering note.',
        });
        expect(mail.status).toBe('pending');
        const read = await store.agentMessages.update(mail.id, { status: 'read' });
        expect(read?.status).toBe('read');
        expect((await store.agentMessages.list({ agentId: archivist.id, status: 'read' })).map((row) => row.id)).toEqual([
          mail.id,
        ]);
        await expect(
          store.agentMessages.create({ fromAgentId: gardener.id, toAgentId: gardener.id, body: 'nope' }),
        ).rejects.toThrow(/different/);

        const session = await store.sessions.create({
          id: '11111111-1111-4111-8111-111111111111',
          tokenHash: 'hash-one',
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-10-08T00:00:00.000Z',
        });
        expect((await store.sessions.getByTokenHash('hash-one'))?.id).toBe(session.id);

        await expect(store.agents.delete(gardener.id)).rejects.toThrow(/owns chats/);
        await expect(store.profiles.delete('grok')).rejects.toThrow(/used by a chat/);
        expect(await store.messages.deleteByChat(chat.id)).toBe(2);
        expect(await store.chats.delete(chat.id)).toBe(true);
        expect(await store.messages.listByChat(chat.id)).toEqual([]);
        expect(await store.profiles.delete('grok')).toBe(true);
        expect(await store.sessions.delete(session.id)).toBe(true);
      } finally {
        await store.close();
      }

      const reopened = await createStore({ connectionString });
      try {
        const names = (await reopened.agents.list()).map((agent) => agent.name).sort();
        expect(names).toEqual(['Archivist', 'Gardener']);
        const sprout = (await reopened.agents.list()).find((agent) => agent.name === 'Gardener');
        expect(sprout).toMatchObject({ icon: 'Sprout', color: 'teal', defaultProfileId: 'grok' });
        expect(await reopened.chats.list()).toEqual([]);
        expect(await reopened.sessions.getByTokenHash('hash-one')).toBeNull();
        const inbox = await reopened.agentMessages.list({ agentId: sprout?.id });
        expect(inbox).toHaveLength(1);
        expect(inbox[0]?.status).toBe('read');
        expect(await reopened.profiles.get('leaky')).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
      } finally {
        await reopened.close();
      }
    },
    30_000,
  );
});
