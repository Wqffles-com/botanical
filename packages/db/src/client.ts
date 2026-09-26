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

  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    onnotice() {},
  });
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

/**
 * Create the URL's database when the server is pointed at a name that does not exist yet.
 * A database that already accepts connections is left alone, including managed Postgres
 * where the app role cannot connect to the maintenance database.
 */
export async function ensureDatabase(connectionString: string): Promise<void> {
  const target = new URL(connectionString);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbName)) {
    throw new Error('DATABASE_URL database name must be a plain identifier');
  }

  let missing = false;
  const probe = postgres(connectionString, { max: 1, connect_timeout: 10, onnotice() {} });
  try {
    await probe`select 1`;
  } catch (error) {
    if (!isMissingDatabase(error)) throw error;
    missing = true;
  } finally {
    await probe.end({ timeout: 5 }).catch(() => undefined);
  }
  if (!missing) return;

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 10, onnotice() {} });
  try {
    const existing = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (existing.length === 0) {
      await admin.unsafe(`create database "${dbName}"`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

function isMissingDatabase(error: unknown): boolean {
  if (pgCode(error) === '3D000') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /database ".+" does not exist/i.test(message);
}

function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return pgCode(error.cause);
  return undefined;
}
