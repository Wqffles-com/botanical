import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { eq } from 'drizzle-orm';

import { AGENT_COLORS, EXAMPLE_AGENTS, PLATFORM_TOOLS } from '../../core/src/agents.ts';
import { agentColorEnum } from '../src/schema/enums.ts';
import { agents } from '../src/schema/agents.ts';
import * as schema from '../src/schema/index.ts';
import { finishMigrations, migrationsFolder } from '../src/sql.ts';

function toolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string') return item.name;
    return '';
  });
}

describe('example agents', () => {
  test('agent_color matches the shared palette', () => {
    expect([...agentColorEnum.enumValues]).toEqual([...AGENT_COLORS]);
  });

  test('seeds Gardener, Builder, and Scout once', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    await finishMigrations((script) => client.exec(script));

    const rows = await db.select().from(agents);
    expect(rows).toHaveLength(EXAMPLE_AGENTS.length);
    for (const example of EXAMPLE_AGENTS) {
      const row = rows.find((item) => item.id === example.id);
      expect(row?.name).toBe(example.name);
      expect(row?.icon).toBe(example.icon);
      expect(row?.color).toBe(example.color);
      expect(row?.description).toBe(example.description);
      expect(row?.prompt).toBe(example.prompt);
      expect(row?.defaultProfileId).toBeNull();
      expect(toolNames(row?.tools)).toEqual([...example.tools]);
    }

    await finishMigrations((script) => client.exec(script));
    const again = await db.select().from(agents);
    expect(again).toHaveLength(EXAMPLE_AGENTS.length);

    await client.close();
  });

  test('0008 adds platform tools only to example agents still on the original seed', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    await finishMigrations((script) => client.exec(script));

    const [gardener, builder, scout] = EXAMPLE_AGENTS.map((example) => example.id);
    const entries = (names: string[]) => names.map((name) => ({ name, enabled: true }));
    // An install from before 0007: Builder is untouched, Scout was edited.
    await db
      .update(agents)
      .set({ tools: entries(['shell', 'code_exec', 'file_read', 'file_write', 'file_list']) })
      .where(eq(agents.id, builder as string));
    await db.update(agents).set({ tools: entries(['web_search']) }).where(eq(agents.id, scout as string));

    await client.exec(readFileSync(join(migrationsFolder(), '0008_platform_tools.sql'), 'utf8'));

    const rows = await db.select().from(agents);
    const tools = (id: string | undefined) => toolNames(rows.find((row) => row.id === id)?.tools);
    expect(tools(builder)).toEqual(['shell', 'code_exec', 'file_read', 'file_write', 'file_list', ...PLATFORM_TOOLS]);
    expect(tools(scout)).toEqual(['web_search']);
    expect(tools(gardener)).toEqual([...(EXAMPLE_AGENTS[0]?.tools ?? [])]);

    await client.close();
  });
});
