import { fileURLToPath } from 'node:url';

const guardsUrl = new URL('../sql/guards.sql', import.meta.url);
const bootstrapUrl = new URL('../sql/bootstrap.sql', import.meta.url);

async function readSql(url: URL): Promise<string> {
  return Bun.file(url).text();
}

/** Idempotent triggers and checks that Drizzle Kit does not model. */
export async function applyGuards(exec: (script: string) => Promise<unknown>): Promise<void> {
  await exec(await readSql(guardsUrl));
}

/** Idempotent instance settings and provider env-var names. Does not overwrite existing keys. */
export async function applyBootstrap(exec: (script: string) => Promise<unknown>): Promise<void> {
  await exec(await readSql(bootstrapUrl));
}

export async function finishMigrations(exec: (script: string) => Promise<unknown>): Promise<void> {
  await applyGuards(exec);
  await applyBootstrap(exec);
}

export function migrationsFolder(): string {
  return fileURLToPath(new URL('../migrations', import.meta.url));
}
