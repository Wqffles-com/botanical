import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from './schema/index.ts';
import { finishMigrations, migrationsFolder } from './sql.ts';

/** Apply Drizzle SQL migrations, then guards and idempotent metadata seeds. */
export async function migrateDatabase(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    await finishMigrations((script) => client.unsafe(script));
  } finally {
    await client.end({ timeout: 5 });
  }
}
