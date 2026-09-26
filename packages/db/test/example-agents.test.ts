import { describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { AGENT_COLORS, EXAMPLE_AGENTS } from '../../core/src/agents.ts';
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
});
