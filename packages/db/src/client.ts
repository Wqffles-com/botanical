import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from './schema/index.ts';

export type BotanicalDb = ReturnType<typeof createDb>['db'];

export type CreateDbOptions = {
  databaseUrl?: string;
  max?: number;
};

/**
 * Open a Drizzle client. Pass a URL or set DATABASE_URL.
 * The connection is not opened at import time.
 */
export function createDb(databaseUrlOrOptions?: string | CreateDbOptions) {
  const options: CreateDbOptions =
    typeof databaseUrlOrOptions === 'string'
      ? { databaseUrl: databaseUrlOrOptions }
      : (databaseUrlOrOptions ?? {});
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create a Botanical database client');
  }

  const client = postgres(databaseUrl, { max: options.max ?? 10 });
  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: (timeout = 5) => client.end({ timeout }),
  };
}

export async function pingDb(db: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }) {
  await db.execute(sql`select 1`);
}
